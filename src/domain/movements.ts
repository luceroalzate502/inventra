import { db, nextCode } from '../db/schema';
import { uid } from './format';
import { MOVEMENT_META } from './types';
import type { LocationStock, Movement, MovementType, Product, SessionUser } from './types';

export class BusinessError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'BusinessError';
    this.code = code;
  }
}

export interface MovementInput {
  type: MovementType;
  reason: string;
  productId: string;
  qty: number;
  unitCost?: number;
  lotCode?: string;
  locationId?: string;
  counterparty?: string;
  refDoc?: string;
  orderId?: string;
  notes?: string;
  at?: string;
  /** Autoriza dejar el saldo en negativo (permiso inventory.override). */
  allowNegative?: boolean;
  reversalOf?: string;
  /** Fuerza la dirección (usado por reversiones). */
  direction?: 1 | -1;
  skipAudit?: boolean;
}

const round = (n: number, d = 4) => Math.round(n * 10 ** d) / 10 ** d;

const TX_TABLES = [
  db.products,
  db.movements,
  db.lots,
  db.counters,
  db.audit,
  db.outbox,
  db.settings,
  db.locations,
  db.locationStock,
];

/* ------------------------------------------------------------------ */
/* Stock por ubicación (5S)                                            */
/* ------------------------------------------------------------------ */

export async function addLocationStock(
  productId: string,
  locationId: string,
  qty: number,
  lotCode?: string,
  at?: string,
): Promise<void> {
  const location = await db.locations.get(locationId);
  if (!location) throw new BusinessError('LOCATION', 'La ubicación seleccionada no existe.');
  const rows = await db.locationStock
    .where('[productId+locationId]')
    .equals([productId, locationId])
    .toArray();
  const existing = rows.find((r) => (r.lotCode ?? '') === (lotCode ?? ''));
  const now = at ?? new Date().toISOString();
  if (existing) {
    await db.locationStock.update(existing.id, { qty: round(existing.qty + qty), updatedAt: now });
  } else {
    const row: LocationStock = {
      id: uid(),
      productId,
      locationId,
      lotCode: lotCode || undefined,
      qty: round(qty),
      updatedAt: now,
    };
    await db.locationStock.add(row);
  }
}

export async function consumeLocationStock(
  productId: string,
  locationId: string,
  qty: number,
  lotCode?: string,
): Promise<void> {
  const rows = (await db.locationStock
    .where('[productId+locationId]')
    .equals([productId, locationId])
    .toArray())
    .filter((r) => !lotCode || (r.lotCode ?? '') === lotCode)
    .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));

  const available = round(rows.reduce((acc, r) => acc + r.qty, 0));
  if (available + 0.0001 < qty) {
    throw new BusinessError(
      'LOCATION_STOCK',
      `La ubicación no tiene stock suficiente: disponible ${available}, solicitado ${qty}.`,
    );
  }

  let remaining = qty;
  for (const row of rows) {
    if (remaining <= 0) break;
    const take = Math.min(row.qty, remaining);
    await db.locationStock.update(row.id, {
      qty: round(row.qty - take),
      updatedAt: new Date().toISOString(),
    });
    remaining = round(remaining - take);
  }
}

/** Descuenta de cualquier ubicación con existencias (FIFO por actualización). */
export async function consumeAnyLocationStock(
  productId: string,
  qty: number,
  lotCode?: string,
): Promise<void> {
  const rows = (await db.locationStock.where('productId').equals(productId).toArray())
    .filter((r) => r.qty > 0 && (!lotCode || (r.lotCode ?? '') === lotCode))
    .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
  let remaining = qty;
  for (const row of rows) {
    if (remaining <= 0) break;
    const take = Math.min(row.qty, remaining);
    await db.locationStock.update(row.id, {
      qty: round(row.qty - take),
      updatedAt: new Date().toISOString(),
    });
    remaining = round(remaining - take);
  }
}

export async function locationQty(productId: string, locationId: string): Promise<number> {
  const rows = await db.locationStock
    .where('[productId+locationId]')
    .equals([productId, locationId])
    .toArray();
  return round(rows.reduce((acc, r) => acc + r.qty, 0));
}

/** Aplica un movimiento dentro de una transacción ya abierta. */
export async function applyMovement(input: MovementInput, user: SessionUser): Promise<Movement> {
  if (!Number.isFinite(input.qty) || input.qty <= 0) {
    throw new BusinessError('QTY', 'La cantidad debe ser mayor que cero.');
  }

  const product = await db.products.get(input.productId);
  if (!product) throw new BusinessError('PRODUCT', 'El producto no existe.');
  if (product.status === 'inactivo' && input.reason !== 'Saldo inicial') {
    throw new BusinessError('INACTIVE', `El producto ${product.sku} está inactivo.`);
  }

  const direction = input.direction ?? MOVEMENT_META[input.type].dir;
  const stockBefore = product.stock;
  const stockAfter = round(stockBefore + direction * input.qty);

  if (direction === -1 && stockAfter < -0.0001 && !input.allowNegative) {
    const config = await db.settings.get('global');
    if (!config?.allowNegativeStock) {
      throw new BusinessError(
        'STOCK',
        `Stock insuficiente de ${product.sku}: disponible ${stockBefore} ${product.uom}, solicitado ${input.qty} ${product.uom}.`,
      );
    }
  }

  // Costo: entradas recalculan promedio ponderado; salidas usan el costo vigente.
  let unitCost = input.unitCost ?? product.cost;
  let newCost = product.cost;

  if (direction === 1) {
    const base = Math.max(stockBefore, 0);
    const totalQty = base + input.qty;
    newCost = totalQty > 0 ? round((base * product.cost + input.qty * unitCost) / totalQty, 2) : unitCost;
  } else {
    unitCost = input.unitCost ?? product.cost;
  }

  const code = await nextCode('MOV', 6);
  const createdAt = input.at ?? new Date().toISOString();

  // Lotes
  let lotCode = input.lotCode;
  if (direction === 1 && lotCode) {
    const existing = await db.lots.where('[productId+code]').equals([product.id, lotCode]).first();
    if (existing?.blocked) {
      throw new BusinessError('LOT_BLOCKED', `El lote ${lotCode} está bloqueado por calidad (PNC).`);
    }
    if (existing) {
      const total = existing.qty + input.qty;
      const avg = total > 0 ? round((existing.qty * existing.unitCost + input.qty * unitCost) / total, 2) : unitCost;
      await db.lots.update(existing.id, { qty: round(total), unitCost: avg });
    } else {
      await db.lots.add({
        id: uid(),
        productId: product.id,
        code: lotCode,
        qty: input.qty,
        unitCost,
        receivedAt: createdAt,
      });
    }
  } else if (direction === -1 && product.lotTracked) {
    if (lotCode) {
      const selected = await db.lots.where('[productId+code]').equals([product.id, lotCode]).first();
      if (selected?.blocked) {
        throw new BusinessError('LOT_BLOCKED', `El lote ${lotCode} está bloqueado por calidad (PNC).`);
      }
    }
    const lots = (await db.lots.where('productId').equals(product.id).toArray())
      .filter((l) => l.qty > 0 && !l.blocked)
      .sort((a, b) => a.receivedAt.localeCompare(b.receivedAt)); // FEFO/FIFO
    let remaining = input.qty;
    for (const lot of lots) {
      if (remaining <= 0) break;
      if (lotCode && lot.code !== lotCode) continue;
      const take = Math.min(lot.qty, remaining);
      await db.lots.update(lot.id, { qty: round(lot.qty - take) });
      remaining = round(remaining - take);
      if (!lotCode) lotCode = lot.code;
    }
  }

  // Ubicación física (5S)
  let locationName: string | undefined;
  if (input.locationId) {
    const location = await db.locations.get(input.locationId);
    if (!location) throw new BusinessError('LOCATION', 'La ubicación seleccionada no existe.');
    locationName = location.name;
    if (direction === 1) {
      await addLocationStock(product.id, location.id, input.qty, lotCode, createdAt);
    } else {
      await consumeLocationStock(product.id, location.id, input.qty, lotCode);
    }
  } else if (direction === -1) {
    // Si el producto ya está ubicado, descuenta de sus ubicaciones para no
    // dejar saldos huérfanos al despachar o consumir.
    await consumeAnyLocationStock(product.id, input.qty, lotCode);
  }

  const movement: Movement = {
    id: uid(),
    code,
    type: input.type,
    direction,
    reason: input.reason,
    productId: product.id,
    productSku: product.sku,
    productName: product.name,
    qty: input.qty,
    unitCost: round(unitCost, 2),
    totalCost: round(input.qty * unitCost, 2),
    stockBefore,
    stockAfter,
    lotCode,
    locationId: input.locationId,
    locationName,
    counterparty: input.counterparty?.trim() || undefined,
    refDoc: input.refDoc?.trim() || undefined,
    orderId: input.orderId,
    notes: input.notes?.trim() || undefined,
    userId: user.id,
    userName: user.name,
    createdAt,
    reversalOf: input.reversalOf,
  };

  await db.movements.add(movement);
  await db.products.update(product.id, {
    stock: stockAfter,
    cost: direction === 1 ? newCost : product.cost,
    updatedAt: new Date().toISOString(),
  });

  if (!input.skipAudit) {
    await db.audit.add({
      id: uid(),
      entity: 'movement',
      entityId: movement.id,
      action: 'crear',
      summary: `${MOVEMENT_META[input.type].label} ${movement.code} · ${product.sku} · ${input.qty} ${product.uom}`,
      before: { stock: stockBefore, cost: product.cost },
      after: { stock: stockAfter, cost: direction === 1 ? newCost : product.cost },
      userId: user.id,
      userName: user.name,
      at: createdAt,
    });
  }

  await db.outbox.add({
    entity: 'movement',
    entityId: movement.id,
    action: 'upsert',
    payload: movement,
    at: createdAt,
    synced: 0,
  });

  return movement;
}

/** Registra un movimiento en su propia transacción atómica. */
export function registerMovement(input: MovementInput, user: SessionUser): Promise<Movement> {
  return db.transaction('rw', TX_TABLES, () => applyMovement(input, user));
}

/** Reversión autorizada: crea el movimiento contrario y marca el original. */
export async function reverseMovement(
  movementId: string,
  reason: string,
  user: SessionUser,
): Promise<Movement> {
  return db.transaction('rw', TX_TABLES, async () => {
    const original = await db.movements.get(movementId);
    if (!original) throw new BusinessError('NOT_FOUND', 'El movimiento no existe.');
    if (original.reversedBy) throw new BusinessError('REVERSED', 'Este movimiento ya fue revertido.');
    if (original.type === 'REVERSION') {
      throw new BusinessError('REVERSION', 'No se puede revertir una reversión.');
    }
    if (!reason.trim()) throw new BusinessError('REASON', 'Indique el motivo de la reversión.');

    const reversal = await applyMovement(
      {
        type: 'REVERSION',
        reason: `Reversión de ${original.code}: ${reason.trim()}`,
        productId: original.productId,
        qty: original.qty,
        unitCost: original.unitCost,
        lotCode: original.lotCode,
        counterparty: original.counterparty,
        refDoc: original.code,
        orderId: original.orderId,
        notes: reason.trim(),
        reversalOf: original.id,
        direction: original.direction === 1 ? -1 : 1,
        allowNegative: original.direction === 1,
      },
      user,
    );

    await db.movements.update(original.id, { reversedBy: reversal.id });
    await db.audit.add({
      id: uid(),
      entity: 'movement',
      entityId: original.id,
      action: 'revertir',
      summary: `Reversión ${reversal.code} sobre ${original.code}`,
      before: original,
      after: reversal,
      userId: user.id,
      userName: user.name,
      at: reversal.createdAt,
    });
    return reversal;
  });
}

export function productStockValue(p: Product): number {
  return p.stock * p.cost;
}

export async function recalculateStock(user: SessionUser): Promise<number> {
  return db.transaction('rw', [db.products, db.movements, db.audit], async () => {
    const products = await db.products.toArray();
    const movements = await db.movements.toArray();
    let fixed = 0;
    for (const product of products) {
      const total = movements
        .filter((m) => m.productId === product.id)
        .reduce((acc, m) => acc + m.direction * m.qty, 0);
      if (Math.abs(total - product.stock) > 0.001) {
        await db.products.update(product.id, { stock: round(total) });
        fixed++;
      }
    }
    await db.audit.add({
      id: uid(),
      entity: 'system',
      entityId: 'recalc',
      action: 'actualizar',
      summary: `Recálculo de saldos: ${fixed} producto(s) ajustado(s)`,
      userId: user.id,
      userName: user.name,
      at: new Date().toISOString(),
    });
    return fixed;
  });
}

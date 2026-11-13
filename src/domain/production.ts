import { db, nextCode } from '../db/schema';
import { uid } from './format';
import { applyMovement, BusinessError } from './movements';
import type {
  Bom,
  BomItem,
  Consumption,
  Product,
  ProductionOrder,
  SessionUser,
  Uom,
} from './types';

const TABLES = [
  db.products,
  db.movements,
  db.lots,
  db.counters,
  db.audit,
  db.outbox,
  db.productionOrders,
  db.consumptions,
  db.boms,
  db.bomItems,
  db.settings,
];

const round = (n: number, d = 4) => Math.round(n * 10 ** d) / 10 ** d;

export interface BomRequirement {
  componentId: string;
  sku: string;
  name: string;
  uom: Uom;
  perUnit: number;
  wastePct: number;
  required: number;
  available: number;
  shortage: number;
  unitCost: number;
  cost: number;
  location: string;
}

export interface BomExplosion {
  bom: Bom;
  product: Product | null;
  qty: number;
  items: BomRequirement[];
  materialsCost: number;
  laborCost: number;
  totalCost: number;
  unitCost: number;
  shortages: BomRequirement[];
  available: boolean;
}

export function activeBom(boms: Bom[], productId: string): Bom | undefined {
  return boms.find((b) => b.productId === productId && b.status === 'activo');
}

export function explode(
  bom: Bom,
  items: BomItem[],
  products: Product[],
  qty: number,
): BomExplosion {
  const product = products.find((p) => p.id === bom.productId) ?? null;
  const rows: BomRequirement[] = items
    .filter((i) => i.bomId === bom.id)
    .map((item) => {
      const component = products.find((p) => p.id === item.componentId);
      const perUnit = item.qty * (1 + (item.wastePct || 0) / 100);
      const required = round(perUnit * qty);
      const available = component?.stock ?? 0;
      const unitCost = component?.cost ?? 0;
      return {
        componentId: item.componentId,
        sku: component?.sku ?? '—',
        name: component?.name ?? 'Componente eliminado',
        uom: component?.uom ?? item.uom,
        perUnit: round(perUnit, 4),
        wastePct: item.wastePct,
        required,
        available,
        shortage: round(Math.max(0, required - available)),
        unitCost,
        cost: round(required * unitCost, 2),
        location: component?.location ?? '—',
      };
    });

  const materialsCost = round(rows.reduce((acc, r) => acc + r.cost, 0), 2);
  const laborCost = round(bom.laborCost * qty, 2);
  const totalCost = round(materialsCost + laborCost, 2);
  const shortages = rows.filter((r) => r.shortage > 0.0001);

  return {
    bom,
    product,
    qty,
    items: rows,
    materialsCost,
    laborCost,
    totalCost,
    unitCost: qty > 0 ? round(totalCost / qty, 2) : 0,
    shortages,
    available: shortages.length === 0,
  };
}

export async function loadExplosion(bomId: string, qty: number): Promise<BomExplosion> {
  const bom = await db.boms.get(bomId);
  if (!bom) throw new BusinessError('BOM', 'La lista de materiales no existe.');
  const items = await db.bomItems.where('bomId').equals(bomId).toArray();
  const products = await db.products.toArray();
  return explode(bom, items, products, qty);
}

export async function availabilityForProduct(
  productId: string,
  qty: number,
): Promise<BomExplosion | null> {
  const boms = await db.boms.where('productId').equals(productId).toArray();
  const bom = activeBom(boms, productId);
  if (!bom) return null;
  return loadExplosion(bom.id, qty);
}

export async function createOrder(
  input: {
    productId: string;
    plannedQty: number;
    scheduledDate: string;
    notes?: string;
    laborCost?: number;
  },
  user: SessionUser,
  at?: string,
): Promise<ProductionOrder> {
  return db.transaction('rw', TABLES, async () => {
    if (input.plannedQty <= 0) throw new BusinessError('QTY', 'La cantidad a producir debe ser mayor que cero.');
    const boms = await db.boms.where('productId').equals(input.productId).toArray();
    const bom = activeBom(boms, input.productId);
    if (!bom) throw new BusinessError('BOM', 'El producto no tiene una lista de materiales activa.');

    const code = await nextCode('OP', 4);
    const createdAt = at ?? new Date().toISOString();
    const order: ProductionOrder = {
      id: uid(),
      code,
      productId: input.productId,
      bomId: bom.id,
      bomVersion: bom.version,
      plannedQty: input.plannedQty,
      producedQty: 0,
      rejectedQty: 0,
      status: 'borrador',
      materialsCost: 0,
      laborCost: round((input.laborCost ?? 0) * input.plannedQty, 2),
      totalCost: 0,
      scheduledDate: input.scheduledDate,
      startedAt: null,
      closedAt: null,
      userId: user.id,
      userName: user.name,
      notes: input.notes?.trim() ?? '',
      createdAt,
    };
    await db.productionOrders.add(order);
    await db.audit.add({
      id: uid(),
      entity: 'production_order',
      entityId: order.id,
      action: 'crear',
      summary: `Orden ${order.code} creada para ${input.plannedQty} und`,
      after: order,
      userId: user.id,
      userName: user.name,
      at: createdAt,
    });
    return order;
  });
}

export async function releaseOrder(orderId: string, user: SessionUser): Promise<ProductionOrder> {
  return db.transaction('rw', TABLES, async () => {
    const order = await db.productionOrders.get(orderId);
    if (!order) throw new BusinessError('NOT_FOUND', 'La orden no existe.');
    if (order.status !== 'borrador') throw new BusinessError('STATE', 'Solo se liberan órdenes en borrador.');

    const explosion = await loadExplosion(order.bomId, order.plannedQty);
    if (!explosion.available) {
      const list = explosion.shortages
        .map((s) => `${s.sku} (faltan ${s.shortage} ${s.uom})`)
        .join(', ');
      throw new BusinessError('SHORTAGE', `Materiales insuficientes: ${list}.`);
    }

    const status = 'liberada' as const;
    await db.productionOrders.update(order.id, { status });
    await db.audit.add({
      id: uid(),
      entity: 'production_order',
      entityId: order.id,
      action: 'actualizar',
      summary: `Orden ${order.code} liberada`,
      userId: user.id,
      userName: user.name,
      at: new Date().toISOString(),
    });
    return { ...order, status };
  });
}

export async function startOrder(orderId: string, user: SessionUser): Promise<ProductionOrder> {
  return db.transaction('rw', TABLES, async () => {
    const order = await db.productionOrders.get(orderId);
    if (!order) throw new BusinessError('NOT_FOUND', 'La orden no existe.');
    if (order.status !== 'liberada') throw new BusinessError('STATE', 'La orden debe estar liberada.');
    const startedAt = new Date().toISOString();
    await db.productionOrders.update(order.id, { status: 'en_proceso', startedAt });
    await db.audit.add({
      id: uid(),
      entity: 'production_order',
      entityId: order.id,
      action: 'actualizar',
      summary: `Orden ${order.code} iniciada en planta`,
      userId: user.id,
      userName: user.name,
      at: startedAt,
    });
    return { ...order, status: 'en_proceso', startedAt };
  });
}

export interface ConsumptionInput {
  productId: string;
  realQty: number;
  wasteQty: number;
  lotCode?: string;
}

/** Registra el consumo real de materiales de una orden (descuenta inventario). */
export async function registerConsumptions(
  orderId: string,
  entries: ConsumptionInput[],
  user: SessionUser,
  at?: string,
): Promise<Consumption[]> {
  return db.transaction('rw', TABLES, async () => {
    const order = await db.productionOrders.get(orderId);
    if (!order) throw new BusinessError('NOT_FOUND', 'La orden no existe.');
    if (order.status !== 'en_proceso' && order.status !== 'liberada') {
      throw new BusinessError('STATE', 'Solo se consumen materiales en órdenes liberadas o en proceso.');
    }

    const result: Consumption[] = [];
    for (const entry of entries) {
      const total = round(entry.realQty + entry.wasteQty);
      if (total <= 0) continue;
      const product = await db.products.get(entry.productId);
      if (!product) throw new BusinessError('PRODUCT', 'Componente no encontrado.');

      const movement = await applyMovement(
        {
          type: 'PROD_CONSUMO',
          reason: 'Consumo de producción',
          productId: entry.productId,
          qty: total,
          unitCost: product.cost,
          orderId: order.id,
          refDoc: order.code,
          lotCode: entry.lotCode,
          notes: `Consumo OP ${order.code}`,
          at,
        },
        user,
      );

      const consumption: Consumption = {
        id: uid(),
        orderId: order.id,
        productId: entry.productId,
        plannedQty: 0,
        realQty: entry.realQty,
        wasteQty: entry.wasteQty,
        unitCost: movement.unitCost,
        totalCost: movement.totalCost,
        lotCode: movement.lotCode,
        createdAt: at ?? new Date().toISOString(),
      };
      await db.consumptions.add(consumption);
      result.push(consumption);
    }

    const materialsCost = round(
      (await db.consumptions.where('orderId').equals(order.id).toArray()).reduce(
        (acc, c) => acc + c.totalCost,
        0,
      ),
      2,
    );
    await db.productionOrders.update(order.id, {
      materialsCost,
      totalCost: round(materialsCost + order.laborCost, 2),
      status: 'en_proceso',
    });

    return result;
  });
}

/** Consume automáticamente las cantidades teóricas del BOM. */
export async function consumeTheoretical(
  orderId: string,
  user: SessionUser,
  at?: string,
): Promise<Consumption[]> {
  const order = await db.productionOrders.get(orderId);
  if (!order) throw new BusinessError('NOT_FOUND', 'La orden no existe.');
  const explosion = await loadExplosion(order.bomId, order.plannedQty);
  const entries: ConsumptionInput[] = explosion.items.map((i) => ({
    productId: i.componentId,
    realQty: i.required,
    wasteQty: 0,
  }));
  return registerConsumptions(orderId, entries, user, at);
}

export async function closeOrder(
  orderId: string,
  input: { producedQty: number; rejectedQty: number; laborCost?: number },
  user: SessionUser,
  at?: string,
): Promise<ProductionOrder> {
  return db.transaction('rw', TABLES, async () => {
    const order = await db.productionOrders.get(orderId);
    if (!order) throw new BusinessError('NOT_FOUND', 'La orden no existe.');
    if (order.status === 'cerrada') throw new BusinessError('STATE', 'La orden ya está cerrada.');
    if (order.status === 'cancelada') throw new BusinessError('STATE', 'La orden está cancelada.');
    if (input.producedQty < 0 || input.rejectedQty < 0) {
      throw new BusinessError('QTY', 'Las cantidades no pueden ser negativas.');
    }
    if (input.producedQty === 0) {
      throw new BusinessError('QTY', 'Registre al menos una unidad fabricada.');
    }

    const existing = await db.consumptions.where('orderId').equals(order.id).toArray();
    if (existing.length === 0) {
      throw new BusinessError('CONSUME', 'Registre el consumo de materiales antes de cerrar la orden.');
    }

    const product = await db.products.get(order.productId);
    if (!product) throw new BusinessError('PRODUCT', 'Producto terminado no encontrado.');

    const materialsCost = round(existing.reduce((acc, c) => acc + c.totalCost, 0), 2);
    const laborCost = input.laborCost ?? order.laborCost;
    const totalCost = round(materialsCost + laborCost, 2);
    const unitCost = round(totalCost / input.producedQty, 2);
    const closedAt = at ?? new Date().toISOString();

    await applyMovement(
      {
        type: 'PROD_IN',
        reason: 'Producción terminada',
        productId: order.productId,
        qty: input.producedQty,
        unitCost,
        refDoc: order.code,
        orderId: order.id,
        lotCode: `L-${order.code}`,
        notes: `Cierre OP ${order.code}`,
        at: closedAt,
      },
      user,
    );

    await db.productionOrders.update(order.id, {
      status: 'cerrada',
      producedQty: input.producedQty,
      rejectedQty: input.rejectedQty,
      materialsCost,
      laborCost,
      totalCost,
      closedAt,
    });

    await db.audit.add({
      id: uid(),
      entity: 'production_order',
      entityId: order.id,
      action: 'cierre',
      summary: `Orden ${order.code} cerrada · ${input.producedQty} und · costo unitario ${unitCost}`,
      after: { producedQty: input.producedQty, rejectedQty: input.rejectedQty, unitCost },
      userId: user.id,
      userName: user.name,
      at: closedAt,
    });

    const updated = await db.productionOrders.get(order.id);
    return updated as ProductionOrder;
  });
}

export async function cancelOrder(orderId: string, user: SessionUser): Promise<void> {
  return db.transaction('rw', TABLES, async () => {
    const order = await db.productionOrders.get(orderId);
    if (!order) throw new BusinessError('NOT_FOUND', 'La orden no existe.');
    if (order.status === 'cerrada') throw new BusinessError('STATE', 'No se puede cancelar una orden cerrada.');
    await db.productionOrders.update(order.id, { status: 'cancelada' });
    await db.audit.add({
      id: uid(),
      entity: 'production_order',
      entityId: order.id,
      action: 'actualizar',
      summary: `Orden ${order.code} cancelada`,
      userId: user.id,
      userName: user.name,
      at: new Date().toISOString(),
    });
  });
}

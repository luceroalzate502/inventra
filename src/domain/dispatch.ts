// Despachos y logística externa: picking list, Poka-Yoke y remisión.

import { db, nextCode } from '../db/schema';
import { uid } from './format';
import { applyMovement, BusinessError } from './movements';
import type { Dispatch, DispatchItem, Product, SessionUser } from './types';

const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

export interface DispatchInput {
  date: string;
  customer: string;
  orderRef: string;
  vehicle: string;
  driver: string;
  destination: string;
  notes?: string;
  items: { productId: string; requestedQty: number; lotCode?: string; locationId?: string }[];
}

const TX = [
  db.dispatches,
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

export async function createDispatch(input: DispatchInput, user: SessionUser): Promise<Dispatch> {
  return db.transaction('rw', [db.dispatches, db.products, db.locations, db.counters, db.audit, db.outbox], async () => {
    if (!input.customer.trim()) throw new BusinessError('CUSTOMER', 'Indique el cliente o destino del despacho.');
    if (!input.date) throw new BusinessError('DATE', 'Indique la fecha del despacho.');
    if (input.items.length === 0) throw new BusinessError('ITEMS', 'Agregue al menos un producto al picking list.');

    const items: DispatchItem[] = [];
    for (const raw of input.items) {
      if (raw.requestedQty <= 0) throw new BusinessError('QTY', 'Las cantidades del picking deben ser mayores que cero.');
      const product = await db.products.get(raw.productId);
      if (!product) throw new BusinessError('PRODUCT', 'Uno de los productos no existe.');
      if (product.status === 'inactivo') throw new BusinessError('INACTIVE', `El producto ${product.sku} está inactivo.`);
      const location = raw.locationId ? await db.locations.get(raw.locationId) : null;
      items.push({
        productId: product.id,
        sku: product.sku,
        name: product.name,
        uom: product.uom,
        requestedQty: round(raw.requestedQty),
        pickedQty: 0,
        lotCode: raw.lotCode?.trim().toUpperCase() || undefined,
        locationId: location?.id,
        locationName: location?.name,
      });
    }

    const code = await nextCode('DSP', 5);
    const createdAt = new Date().toISOString();
    const dispatch: Dispatch = {
      id: uid(),
      code,
      date: input.date,
      customer: input.customer.trim(),
      orderRef: input.orderRef.trim(),
      vehicle: input.vehicle.trim(),
      driver: input.driver.trim(),
      destination: input.destination.trim(),
      notes: input.notes?.trim() ?? '',
      status: 'borrador',
      items,
      remision: '',
      packingList: '',
      userId: user.id,
      userName: user.name,
      createdAt,
    };
    await db.dispatches.add(dispatch);
    await db.audit.add({
      id: uid(),
      entity: 'dispatch',
      entityId: dispatch.id,
      action: 'crear',
      summary: `Despacho ${code} creado para ${dispatch.customer} · ${items.length} línea(s)`,
      after: dispatch,
      userId: user.id,
      userName: user.name,
      at: createdAt,
    });
    await db.outbox.add({
      entity: 'dispatch',
      entityId: dispatch.id,
      action: 'upsert',
      payload: dispatch,
      at: createdAt,
      synced: 0,
    });
    return dispatch;
  });
}

export async function updateDispatch(
  id: string,
  patch: {
    customer?: string;
    orderRef?: string;
    vehicle?: string;
    driver?: string;
    destination?: string;
    notes?: string;
    items?: DispatchItem[];
    status?: Dispatch['status'];
  },
  user: SessionUser,
): Promise<Dispatch> {
  return db.transaction('rw', [db.dispatches, db.audit], async () => {
    const current = await db.dispatches.get(id);
    if (!current) throw new BusinessError('NOT_FOUND', 'El despacho no existe.');
    if (current.status === 'despachado') throw new BusinessError('STATE', 'Un despacho confirmado no se edita.');
    const next: Dispatch = {
      ...current,
      ...patch,
      customer: patch.customer !== undefined ? patch.customer.trim() : current.customer,
      orderRef: patch.orderRef !== undefined ? patch.orderRef.trim() : current.orderRef,
      vehicle: patch.vehicle !== undefined ? patch.vehicle.trim() : current.vehicle,
      driver: patch.driver !== undefined ? patch.driver.trim() : current.driver,
      destination: patch.destination !== undefined ? patch.destination.trim() : current.destination,
      notes: patch.notes !== undefined ? patch.notes.trim() : current.notes,
      items: patch.items ?? current.items,
    };
    await db.dispatches.put(next);
    await db.audit.add({
      id: uid(),
      entity: 'dispatch',
      entityId: id,
      action: 'actualizar',
      summary: `Despacho ${current.code} actualizado`,
      before: current,
      after: next,
      userId: user.id,
      userName: user.name,
      at: new Date().toISOString(),
    });
    return next;
  });
}

/** Valida un escaneo contra el picking list (solo apoyo de búsqueda, sin bloqueo). */
export function matchScan(dispatch: Dispatch, code: string, products: Product[]): { index: number; item: DispatchItem } | null {
  const term = code.trim().toLowerCase();
  if (!term) return null;
  const index = dispatch.items.findIndex((item) => {
    const product = products.find((p) => p.id === item.productId);
    return (
      item.sku.toLowerCase() === term ||
      (product?.barcode ?? '').toLowerCase() === term ||
      (item.lotCode ?? '').toLowerCase() === term
    );
  });
  return index >= 0 ? { index, item: dispatch.items[index] } : null;
}

export async function confirmDispatch(id: string, user: SessionUser): Promise<Dispatch> {
  return db.transaction('rw', TX, async () => {
    const dispatch = await db.dispatches.get(id);
    if (!dispatch) throw new BusinessError('NOT_FOUND', 'El despacho no existe.');
    if (dispatch.status === 'despachado') throw new BusinessError('STATE', 'Este despacho ya fue confirmado.');
    if (dispatch.status === 'anulado') throw new BusinessError('STATE', 'El despacho está anulado.');
    if (dispatch.items.length === 0) throw new BusinessError('ITEMS', 'El picking list está vacío.');

    for (const item of dispatch.items) {
      if (item.pickedQty <= 0) {
        throw new BusinessError('PICKING', `Falta confirmar el picking de ${item.sku}.`);
      }
      if (Math.abs(item.pickedQty - item.requestedQty) > 0.0001) {
        throw new BusinessError(
          'PICKING',
          `La cantidad pickeada de ${item.sku} (${item.pickedQty}) no coincide con la solicitada (${item.requestedQty}).`,
        );
      }
      const product = await db.products.get(item.productId);
      if (!product) throw new BusinessError('PRODUCT', `El producto ${item.sku} no existe.`);
      if (product.stock + 0.0001 < item.pickedQty) {
        throw new BusinessError(
          'STOCK',
          `Stock insuficiente de ${item.sku}: disponible ${product.stock} ${product.uom}, solicitado ${item.pickedQty}.`,
        );
      }
      if (item.lotCode) {
        const lot = await db.lots.where('[productId+code]').equals([item.productId, item.lotCode]).first();
        if (lot?.blocked) throw new BusinessError('LOT_BLOCKED', `El lote ${item.lotCode} está bloqueado por PNC.`);
      }
      if (item.locationId) {
        const rows = await db.locationStock
          .where('[productId+locationId]')
          .equals([item.productId, item.locationId])
          .toArray();
        const available = rows
          .filter((r) => !item.lotCode || (r.lotCode ?? '') === item.lotCode)
          .reduce((a, r) => a + r.qty, 0);
        if (available + 0.0001 < item.pickedQty) {
          throw new BusinessError(
            'LOCATION_STOCK',
            `La ubicación ${item.locationName ?? ''} no tiene stock suficiente de ${item.sku} (disponible ${available}).`,
          );
        }
      }
    }

    const movementIds: string[] = [];
    const dispatchedAt = new Date().toISOString();
    for (const item of dispatch.items) {
      const movement = await applyMovement(
        {
          type: 'SALIDA',
          reason: 'Despacho',
          productId: item.productId,
          qty: item.pickedQty,
          lotCode: item.lotCode,
          locationId: item.locationId,
          counterparty: dispatch.customer,
          refDoc: dispatch.code,
          notes: `Despacho ${dispatch.code}${dispatch.orderRef ? ` · pedido ${dispatch.orderRef}` : ''}`,
          at: dispatchedAt,
        },
        user,
      );
      movementIds.push(movement.id);
    }

    const next: Dispatch = {
      ...dispatch,
      status: 'despachado',
      dispatchedAt,
      remision: dispatch.code,
      packingList: dispatch.code,
      movementIds,
    };
    await db.dispatches.put(next);
    await db.audit.add({
      id: uid(),
      entity: 'dispatch',
      entityId: dispatch.id,
      action: 'cierre',
      summary: `Despacho ${dispatch.code} confirmado · ${dispatch.items.reduce((a, i) => a + i.pickedQty, 0)} und · ${dispatch.customer}`,
      before: { status: dispatch.status },
      after: { status: 'despachado', movementIds, remision: next.remision },
      userId: user.id,
      userName: user.name,
      at: dispatchedAt,
    });
    return next;
  });
}

export async function cancelDispatch(id: string, user: SessionUser, reason: string): Promise<Dispatch> {
  return db.transaction('rw', [db.dispatches, db.audit], async () => {
    const dispatch = await db.dispatches.get(id);
    if (!dispatch) throw new BusinessError('NOT_FOUND', 'El despacho no existe.');
    if (dispatch.status === 'despachado') throw new BusinessError('STATE', 'No se puede anular un despacho confirmado.');
    if (!reason.trim()) throw new BusinessError('REASON', 'Indique el motivo de anulación.');
    const next: Dispatch = { ...dispatch, status: 'anulado', notes: `${dispatch.notes}\nAnulado: ${reason.trim()}`.trim() };
    await db.dispatches.put(next);
    await db.audit.add({
      id: uid(),
      entity: 'dispatch',
      entityId: id,
      action: 'actualizar',
      summary: `Despacho ${dispatch.code} anulado: ${reason.trim()}`,
      before: dispatch,
      after: next,
      userId: user.id,
      userName: user.name,
      at: new Date().toISOString(),
    });
    return next;
  });
}

export function dispatchTotals(dispatch: Dispatch, products: Product[]) {
  const units = dispatch.items.reduce((a, i) => a + i.pickedQty, 0);
  const requested = dispatch.items.reduce((a, i) => a + i.requestedQty, 0);
  const value = dispatch.items.reduce((a, i) => {
    const product = products.find((p) => p.id === i.productId);
    return a + i.pickedQty * (product?.cost ?? 0);
  }, 0);
  return { units: round(units), requested: round(requested), value: round(value) };
}

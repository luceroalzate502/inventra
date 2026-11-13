// Almacén 5S: ubicaciones, stock por ubicación y traslados internos.

import { db, nextCode } from '../db/schema';
import { uid } from './format';
import { addLocationStock, BusinessError } from './movements';
import type {
  LocationStock,
  LocationType,
  Product,
  SessionUser,
  Transfer,
  WarehouseLocation,
} from './types';

const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

export interface LocationInput {
  code: string;
  name: string;
  type: LocationType;
  zone: string;
  capacity: number;
  notes?: string;
}

export async function createLocation(input: LocationInput, user: SessionUser): Promise<WarehouseLocation> {
  return db.transaction('rw', [db.locations, db.audit, db.outbox, db.counters], async () => {
    const code = input.code.trim().toUpperCase();
    if (!code) throw new BusinessError('CODE', 'El código de la ubicación es obligatorio.');
    if (!input.name.trim()) throw new BusinessError('NAME', 'El nombre de la ubicación es obligatorio.');
    const duplicate = await db.locations.where('code').equals(code).first();
    if (duplicate) throw new BusinessError('DUP', `Ya existe la ubicación ${code}.`);

    const now = new Date().toISOString();
    const location: WarehouseLocation = {
      id: uid(),
      code,
      name: input.name.trim(),
      type: input.type,
      zone: input.zone.trim() || 'General',
      capacity: Math.max(0, input.capacity || 0),
      status: 'activa',
      notes: input.notes?.trim() ?? '',
      createdAt: now,
      updatedAt: now,
    };
    await db.locations.add(location);
    await db.audit.add({
      id: uid(),
      entity: 'location',
      entityId: location.id,
      action: 'crear',
      summary: `Ubicación ${location.code} creada (${location.name})`,
      after: location,
      userId: user.id,
      userName: user.name,
      at: now,
    });
    await db.outbox.add({
      entity: 'location',
      entityId: location.id,
      action: 'upsert',
      payload: location,
      at: now,
      synced: 0,
    });
    return location;
  });
}

export async function updateLocation(
  id: string,
  patch: Partial<LocationInput> & { status?: WarehouseLocation['status'] },
  user: SessionUser,
): Promise<WarehouseLocation> {
  return db.transaction('rw', [db.locations, db.audit], async () => {
    const current = await db.locations.get(id);
    if (!current) throw new BusinessError('NOT_FOUND', 'La ubicación no existe.');
    const next: WarehouseLocation = {
      ...current,
      ...patch,
      code: patch.code ? patch.code.trim().toUpperCase() : current.code,
      name: patch.name ? patch.name.trim() : current.name,
      zone: patch.zone ? patch.zone.trim() : current.zone,
      capacity: patch.capacity !== undefined ? Math.max(0, patch.capacity) : current.capacity,
      notes: patch.notes !== undefined ? patch.notes.trim() : current.notes,
      updatedAt: new Date().toISOString(),
    };
    await db.locations.put(next);
    await db.audit.add({
      id: uid(),
      entity: 'location',
      entityId: id,
      action: 'actualizar',
      summary: `Ubicación ${next.code} actualizada`,
      before: current,
      after: next,
      userId: user.id,
      userName: user.name,
      at: next.updatedAt,
    });
    return next;
  });
}

/** Crea el mapa base 5S cuando aún no hay ubicaciones configuradas. */
export async function ensureBaseLocations(user: SessionUser): Promise<number> {
  return db.transaction('rw', [db.locations, db.audit, db.counters], async () => {
    if ((await db.locations.count()) > 0) return 0;
    const now = new Date().toISOString();
    const base: Omit<WarehouseLocation, 'id' | 'createdAt' | 'updatedAt'>[] = [
      { code: 'CUR-01', name: 'Área de curado / enfriamiento', type: 'curado', zone: 'Planta', capacity: 0, status: 'activa', notes: 'Recién producido. Antes de trasladar a PT.' },
      { code: 'PT-01', name: 'Almacén de producto terminado', type: 'pt', zone: 'Almacén', capacity: 0, status: 'activa', notes: 'Producto liberado para despacho.' },
      { code: 'RACK-A1', name: 'Rack A1', type: 'rack', zone: 'Almacén', capacity: 0, status: 'activa', notes: '' },
      { code: 'RACK-A2', name: 'Rack A2', type: 'rack', zone: 'Almacén', capacity: 0, status: 'activa', notes: '' },
      { code: 'DSP-01', name: 'Zona de despacho', type: 'despacho', zone: 'Andén', capacity: 0, status: 'activa', notes: 'Picking y carga de transporte.' },
      { code: 'DEV-01', name: 'Devoluciones', type: 'devolucion', zone: 'Almacén', capacity: 0, status: 'activa', notes: 'Producto devuelto pendiente de inspección.' },
    ];
    for (const item of base) {
      await db.locations.add({ ...item, id: uid(), createdAt: now, updatedAt: now });
    }
    await db.audit.add({
      id: uid(),
      entity: 'location',
      entityId: 'base',
      action: 'crear',
      summary: `Mapa 5S base creado con ${base.length} ubicaciones`,
      userId: user.id,
      userName: user.name,
      at: now,
    });
    return base.length;
  });
}

export interface TransferInput {
  productId: string;
  qty: number;
  fromLocationId: string;
  toLocationId: string;
  lotCode?: string;
  notes?: string;
}

export async function transferStock(input: TransferInput, user: SessionUser): Promise<Transfer> {
  return db.transaction(
    'rw',
    [db.products, db.locations, db.locationStock, db.transfers, db.counters, db.audit, db.outbox],
    async () => {
      if (input.qty <= 0) throw new BusinessError('QTY', 'La cantidad a trasladar debe ser mayor que cero.');
      if (input.fromLocationId === input.toLocationId) {
        throw new BusinessError('LOCATION', 'La ubicación origen y destino deben ser diferentes.');
      }
      const product = await db.products.get(input.productId);
      if (!product) throw new BusinessError('PRODUCT', 'El producto no existe.');
      const from = await db.locations.get(input.fromLocationId);
      const to = await db.locations.get(input.toLocationId);
      if (!from || !to) throw new BusinessError('LOCATION', 'La ubicación origen o destino no existe.');

      const rows = (await db.locationStock
        .where('[productId+locationId]')
        .equals([product.id, from.id])
        .toArray())
        .filter((r) => !input.lotCode || (r.lotCode ?? '') === input.lotCode)
        .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));

      const available = round(rows.reduce((a, r) => a + r.qty, 0));
      if (available + 0.0001 < input.qty) {
        throw new BusinessError(
          'LOCATION_STOCK',
          `Stock insuficiente en ${from.name}: disponible ${available} ${product.uom}, solicitado ${input.qty}.`,
        );
      }

      let remaining = input.qty;
      for (const row of rows) {
        if (remaining <= 0) break;
        const take = Math.min(row.qty, remaining);
        await db.locationStock.update(row.id, {
          qty: round(row.qty - take),
          updatedAt: new Date().toISOString(),
        });
        remaining = round(remaining - take);
      }
      await addLocationStock(product.id, to.id, input.qty, input.lotCode);

      const code = await nextCode('TR', 5);
      const createdAt = new Date().toISOString();
      const transfer: Transfer = {
        id: uid(),
        code,
        productId: product.id,
        productSku: product.sku,
        productName: product.name,
        qty: round(input.qty),
        uom: product.uom,
        fromLocationId: from.id,
        fromLocationName: from.name,
        toLocationId: to.id,
        toLocationName: to.name,
        lotCode: input.lotCode || undefined,
        notes: input.notes?.trim() ?? '',
        userId: user.id,
        userName: user.name,
        createdAt,
      };
      await db.transfers.add(transfer);
      await refreshProductLocationLabel(product.id);

      await db.audit.add({
        id: uid(),
        entity: 'transfer',
        entityId: transfer.id,
        action: 'crear',
        summary: `Traslado ${code} · ${product.sku} · ${input.qty} ${product.uom} · ${from.name} → ${to.name}`,
        after: transfer,
        userId: user.id,
        userName: user.name,
        at: createdAt,
      });
      await db.outbox.add({
        entity: 'transfer',
        entityId: transfer.id,
        action: 'upsert',
        payload: transfer,
        at: createdAt,
        synced: 0,
      });
      return transfer;
    },
  );
}

/** Sincroniza la etiqueta visible del producto con sus ubicaciones reales. */
export async function refreshProductLocationLabel(productId: string): Promise<void> {
  const product = await db.products.get(productId);
  if (!product) return;
  const rows = await db.locationStock.where('productId').equals(productId).toArray();
  const positive = rows.filter((r) => r.qty > 0.0001);
  const locationIds = Array.from(new Set(positive.map((r) => r.locationId)));
  if (locationIds.length === 0) return;
  if (locationIds.length === 1) {
    const location = await db.locations.get(locationIds[0]);
    if (location) {
      await db.products.update(productId, {
        location: location.name,
        locationId: location.id,
        updatedAt: new Date().toISOString(),
      });
    }
  } else {
    await db.products.update(productId, {
      location: `${locationIds.length} ubicaciones`,
      locationId: undefined,
      updatedAt: new Date().toISOString(),
    });
  }
}

export interface LocationOccupancy {
  location: WarehouseLocation;
  used: number;
  pct: number;
  products: { product: Product; qty: number; lotCode?: string }[];
}

export function occupancyRows(
  locations: WarehouseLocation[],
  stock: LocationStock[],
  products: Product[],
): LocationOccupancy[] {
  return locations.map((location) => {
    const rows = stock.filter((s) => s.locationId === location.id && s.qty > 0.0001);
    const used = round(rows.reduce((a, r) => a + r.qty, 0));
    const productRows: { product: Product; qty: number; lotCode?: string }[] = [];
    for (const row of rows) {
      const product = products.find((p) => p.id === row.productId);
      if (product) productRows.push({ product, qty: row.qty, lotCode: row.lotCode });
    }
    return {
      location,
      used,
      pct: location.capacity > 0 ? round((used / location.capacity) * 100, 1) : 0,
      products: productRows,
    };
  });
}

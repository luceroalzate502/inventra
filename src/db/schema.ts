import Dexie from 'dexie';
import type { Table } from 'dexie';
import { deviceSuffix, isCloudConfigured } from '../sync/config';
import type { RolePermission } from '../domain/permissions';
import type {
  AuditEntry,
  Bom,
  BomItem,
  ChatMessage,
  Consumption,
  Counter,
  Dispatch,
  LocationStock,
  Lot,
  Machine,
  Movement,
  NonConformity,
  OutboxEvent,
  PhysicalCount,
  Product,
  ProductionOrder,
  ProductionRecord,
  Settings,
  SyncMeta,
  Transfer,
  User,
  WarehouseLocation,
} from '../domain/types';

export class InvencodiDB extends Dexie {
  users!: Table<User, string>;
  products!: Table<Product, string>;
  movements!: Table<Movement, string>;
  lots!: Table<Lot, string>;
  boms!: Table<Bom, string>;
  bomItems!: Table<BomItem, string>;
  productionOrders!: Table<ProductionOrder, string>;
  consumptions!: Table<Consumption, string>;
  audit!: Table<AuditEntry, string>;
  counts!: Table<PhysicalCount, string>;
  settings!: Table<Settings, string>;
  counters!: Table<Counter, string>;
  outbox!: Table<OutboxEvent, number>;
  machines!: Table<Machine, string>;
  productionRecords!: Table<ProductionRecord, string>;
  pnc!: Table<NonConformity, string>;
  locations!: Table<WarehouseLocation, string>;
  locationStock!: Table<LocationStock, string>;
  transfers!: Table<Transfer, string>;
  dispatches!: Table<Dispatch, string>;
  messages!: Table<ChatMessage, string>;
  permissions!: Table<RolePermission, string>;
  syncMeta!: Table<SyncMeta, string>;

  constructor() {
    super('inventra');
    this.version(1).stores({
      users: 'id, &email, role, active',
      products: 'id, &sku, barcode, type, category, status, name',
      movements: 'id, code, productId, type, createdAt, orderId, [productId+createdAt]',
      lots: 'id, productId, code, [productId+code]',
      boms: 'id, productId, status, [productId+status]',
      bomItems: 'id, bomId, componentId',
      productionOrders: 'id, code, status, productId, createdAt',
      consumptions: 'id, orderId, productId',
      audit: 'id, entity, entityId, at, userId',
      counts: 'id, code, status, createdAt',
      settings: 'key',
      counters: 'prefix',
      outbox: '++id, at, synced',
    });

    this.version(2).stores({
      machines: 'id, &code, type, status',
      productionRecords:
        'id, code, date, shift, machineId, productId, orderId, status, [date+shift], [date+machineId], [machineId+date]',
      pnc: 'id, code, date, productId, lotCode, status, defectType, productionRecordId, [date+status]',
      locations: 'id, &code, type, zone, status',
      locationStock: 'id, productId, locationId, [productId+locationId], [locationId+productId]',
      transfers: 'id, code, productId, fromLocationId, toLocationId, createdAt',
      dispatches: 'id, code, status, customer, date, createdAt',
    });

    // v3: seguimiento local de cambios para sincronización multidispositivo.
    this.version(3).stores({
      syncMeta: 'key, table, dirty, updatedAt',
    });

    // v4: chat interno entre roles (una sola sala general).
    this.version(4).stores({
      messages: 'id, createdAt, authorId',
    });

    // v5: autorizaciones de funciones por rol, configuradas por el administrador.
    this.version(5).stores({
      permissions: 'role',
    });
  }
}

export const db = new InvencodiDB();

/** Genera un consecutivo legible dentro de una transacción abierta. */
export async function nextCode(prefix: string, pad = 5): Promise<string> {
  const current = await db.counters.get(prefix);
  const value = (current?.value ?? 0) + 1;
  await db.counters.put({ prefix, value });
  // Con nube, cada equipo agrega su sufijo para que dos dispositivos offline
  // no generen el mismo código legible.
  const suffix = isCloudConfigured() ? `-${deviceSuffix()}` : '';
  return `${prefix}-${String(value).padStart(pad, '0')}${suffix}`;
}

import type { SupabaseClient } from '@supabase/supabase-js';
import { db } from '../db/schema';
import type { LocationStock, SyncMeta } from '../domain/types';
import {
  clearCloudConfig,
  clearReconciledFlag,
  deviceId,
  getCloudConfig,
  getLastSyncAt,
  getSyncCursor,
  markReconciled,
  normalizeCloudUrl,
  patchCloudConfig,
  saveCloudConfig,
  setLastSyncAt,
  setSyncCursor,
  wasReconciled,
} from './config';
import type { CloudConfig } from './config';

/* ------------------------------------------------------------------ */
/* Tablas y reglas                                                     */
/* ------------------------------------------------------------------ */

/**
 * Tablas que viajan entre dispositivos. Los contadores y el outbox quedan
 * fuera a propósito: los consecutivos se resuelven con el sufijo del equipo
 * y el outbox es una cola local heredada.
 *
 * `locationStock` también queda fuera: es un saldo derivado de los
 * movimientos y se reconstruye en cada equipo al recibir cambios.
 */
export const SYNC_TABLES = [
  'users',
  'settings',
  'products',
  'movements',
  'lots',
  'boms',
  'bomItems',
  'productionOrders',
  'consumptions',
  'audit',
  'counts',
  'machines',
  'productionRecords',
  'pnc',
  'locations',
  'transfers',
  'dispatches',
  'messages',
] as const;

type SyncTable = (typeof SYNC_TABLES)[number];

const SYNC_TABLE_SET = new Set<string>(SYNC_TABLES);

/** Campos con índice único local que pueden chocar al bajar datos. */
const UNIQUE_FIELDS: Partial<Record<SyncTable, string>> = {
  users: 'email',
  products: 'sku',
  locations: 'code',
  machines: 'code',
};

const REMOTE_TABLE = 'inventra_records';
const PAGE_SIZE = 500;
const PUSH_BATCH = 150;
const MAX_PUSH_BATCHES = 30;
const MAX_PULL_PAGES = 60;

/* ------------------------------------------------------------------ */
/* Estado observable                                                  */
/* ------------------------------------------------------------------ */

export type SyncState = 'disabled' | 'offline' | 'idle' | 'syncing' | 'error';

export interface SyncStatus {
  state: SyncState;
  connected: boolean;
  email: string | null;
  pending: number;
  lastSync: string | null;
  lastError: string | null;
}

export interface SyncResult {
  ok: boolean;
  pushed: number;
  pulled: number;
  skipped?: boolean;
  error?: string;
}

export interface ConnectInput {
  url: string;
  anonKey: string;
  email: string;
  password: string;
}

export type InitialMode = 'auto' | 'pull' | 'push' | 'both';

export interface ConnectResult extends SyncResult {
  mode: InitialMode;
  remoteCount: number;
}

let status: SyncStatus = {
  state: 'disabled',
  connected: false,
  email: null,
  pending: 0,
  lastSync: null,
  lastError: null,
};

const listeners = new Set<() => void>();

function setStatus(patch: Partial<SyncStatus>): void {
  status = { ...status, ...patch };
  for (const listener of listeners) listener();
}

export function getSyncStatus(): SyncStatus {
  return status;
}

export function subscribeSync(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

let pendingTimer: number | null = null;

function refreshPendingSoon(): void {
  if (pendingTimer) window.clearTimeout(pendingTimer);
  pendingTimer = window.setTimeout(() => {
    pendingTimer = null;
    void refreshPending();
  }, 250);
}

export async function refreshPending(): Promise<number> {
  try {
    const pending = await db.syncMeta.where('dirty').equals(1).count();
    setStatus({ pending });
    return pending;
  } catch {
    return status.pending;
  }
}

export async function pendingBreakdown(): Promise<{ table: string; count: number }[]> {
  const metas = await db.syncMeta.where('dirty').equals(1).toArray();
  const counts = new Map<string, number>();
  for (const meta of metas) counts.set(meta.table, (counts.get(meta.table) ?? 0) + 1);
  return [...counts.entries()]
    .map(([table, count]) => ({ table, count }))
    .sort((a, b) => b.count - a.count);
}

/* ------------------------------------------------------------------ */
/* Cliente Supabase (carga diferida)                                  */
/* ------------------------------------------------------------------ */

let client: SupabaseClient | null = null;
let clientSignature = '';

async function getSupabase(): Promise<SupabaseClient | null> {
  const config = getCloudConfig();
  if (!config) return null;
  const signature = `${config.url}|${config.anonKey}`;
  if (client && signature === clientSignature) return client;
  const { createClient } = await import('@supabase/supabase-js');
  client = createClient(config.url, config.anonKey, {
    auth: {
      storageKey: 'inventra.cloud.auth',
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  });
  clientSignature = signature;
  return client;
}

async function hasSession(supabase: SupabaseClient): Promise<boolean> {
  const { data } = await supabase.auth.getSession();
  if (data.session) return true;
  const refreshed = await supabase.auth.refreshSession();
  return Boolean(refreshed.data.session);
}

async function ensureRemoteTable(supabase: SupabaseClient): Promise<void> {
  const { error } = await supabase.from(REMOTE_TABLE).select('table_name', { head: true, count: 'exact' });
  if (error) {
    const detail = error.message ?? '';
    if (detail.toLowerCase().includes('does not exist') || detail.toLowerCase().includes('schema cache')) {
      throw new Error(
        'La tabla inventra_records no existe en Supabase. Ejecute el script SQL de configuración en el editor SQL del proyecto.',
      );
    }
    throw new Error(`No fue posible acceder a Supabase: ${detail}`);
  }
}

async function remoteCount(supabase: SupabaseClient): Promise<number> {
  const { count, error } = await supabase
    .from(REMOTE_TABLE)
    .select('table_name', { count: 'exact', head: true });
  if (error) throw new Error(error.message);
  return count ?? 0;
}

/* ------------------------------------------------------------------ */
/* Marcado de cambios locales                                         */
/* ------------------------------------------------------------------ */

const remoteTx = new WeakSet<object>();
let remoteDepth = 0;

const remoteContext = {
  enter(trans: object): void {
    remoteTx.add(trans);
    remoteDepth++;
  },
  exit(trans: object): void {
    remoteTx.delete(trans);
    remoteDepth = Math.max(0, remoteDepth - 1);
  },
  active(trans: object): boolean {
    return remoteDepth > 0 || remoteTx.has(trans);
  },
};

let hooksInstalled = false;

export function installSyncHooks(): void {
  if (hooksInstalled) return;
  hooksInstalled = true;

  for (const name of SYNC_TABLES) {
    const table = db.table(name);

    table.hook('creating', (primKey, _obj, trans) => {
      if (primKey == null) return;
      const fromRemote = remoteContext.active(trans);
      trans.on('complete', () => {
        if (!fromRemote) void markDirty(name, String(primKey), false);
      });
    });

    table.hook('updating', (_mods, primKey, _obj, trans) => {
      if (primKey == null) return;
      const fromRemote = remoteContext.active(trans);
      trans.on('complete', () => {
        if (!fromRemote) void markDirty(name, String(primKey), false);
      });
    });

    table.hook('deleting', (primKey, _obj, trans) => {
      if (primKey == null) return;
      const fromRemote = remoteContext.active(trans);
      trans.on('complete', () => {
        if (!fromRemote) void markDirty(name, String(primKey), true);
      });
    });
  }
}

export async function markDirty(table: string, recordId: string, deleted: boolean): Promise<void> {
  if (!SYNC_TABLE_SET.has(table)) return;
  const key = `${table}|${recordId}`;
  const meta: SyncMeta = {
    key,
    table,
    recordId,
    updatedAt: new Date().toISOString(),
    deleted: deleted ? 1 : 0,
    dirty: 1,
    deviceId: deviceId(),
  };
  try {
    await db.syncMeta.put(meta);
    refreshPendingSoon();
    scheduleSync();
  } catch (error) {
    console.warn('No fue posible registrar el cambio para sincronización.', error);
  }
}

/** Recorre las tablas y crea metadatos para registros que no los tengan. */
export async function reconcileLocalRecords(force = false): Promise<void> {
  // Limpia metadatos de tablas que ya no se sincronizan (p. ej. locationStock).
  const stale = (await db.syncMeta.toArray()).filter((meta) => !SYNC_TABLE_SET.has(meta.table));
  if (stale.length > 0) await db.syncMeta.bulkDelete(stale.map((meta) => meta.key));

  if (!force && wasReconciled()) {
    await refreshPending();
    return;
  }
  const now = new Date().toISOString();

  for (const name of SYNC_TABLES) {
    const table = db.table(name);
    const rows = (await table.toArray()) as Record<string, unknown>[];
    const existing = await db.syncMeta.where('table').equals(name).toArray();
    const metaById = new Map(existing.map((meta) => [meta.recordId, meta]));
    const seen = new Set<string>();
    const missing: SyncMeta[] = [];

    for (const row of rows) {
      const id = String(row.id ?? row.key ?? '');
      if (!id) continue;
      seen.add(id);
      const current = metaById.get(id);
      if (current) continue;
      const stamp =
        (typeof row.updatedAt === 'string' && row.updatedAt) ||
        (typeof row.createdAt === 'string' && row.createdAt) ||
        (typeof row.at === 'string' && row.at) ||
        now;
      missing.push({
        key: `${name}|${id}`,
        table: name,
        recordId: id,
        updatedAt: stamp,
        deleted: 0,
        dirty: 1,
        deviceId: deviceId(),
      });
    }

    if (missing.length > 0) await db.syncMeta.bulkPut(missing);

    // Registros borrados sin metadato (por ejemplo, datos de versiones previas).
    const removed = existing
      .filter((meta) => !seen.has(meta.recordId) && meta.deleted === 0)
      .map((meta) => ({ ...meta, deleted: 1 as const, dirty: 1 as const, updatedAt: now }));
    if (removed.length > 0) await db.syncMeta.bulkPut(removed);
  }

  markReconciled();
  await refreshPending();
}

/** Se usa tras restaurar un respaldo: todo lo restaurado debe subir de nuevo. */
export async function resetSyncTracking(): Promise<void> {
  await db.syncMeta.clear();
  clearReconciledFlag();
  setSyncCursor('');
  await reconcileLocalRecords(true);
}

/* ------------------------------------------------------------------ */
/* Envío y recepción                                                  */
/* ------------------------------------------------------------------ */

interface RemoteRow {
  table_name: string;
  record_id: string;
  data: Record<string, unknown> | null;
  deleted: boolean;
  device_id: string | null;
  client_updated_at: string;
  updated_at: string;
}

type ApplyResult = 'applied' | 'skipped';

function isSyncTable(name: string): name is SyncTable {
  return SYNC_TABLE_SET.has(name);
}

async function applyRemoteRow(row: RemoteRow): Promise<ApplyResult> {
  if (!isSyncTable(row.table_name)) return 'skipped';
  const table = db.table(row.table_name);
  const id = row.record_id;
  const key = `${row.table_name}|${id}`;
  const localMeta = await db.syncMeta.get(key);
  const remoteAt = row.client_updated_at || row.updated_at;
  const remoteDevice = row.device_id ?? '';

  // Última escritura gana. Si empatan, el deviceId sirve de desempate.
  if (localMeta) {
    if (localMeta.updatedAt > remoteAt) return 'skipped';
    if (localMeta.updatedAt === remoteAt && localMeta.deviceId >= remoteDevice) return 'skipped';
  }

  const uniqueField = UNIQUE_FIELDS[row.table_name];
  if (!row.deleted && uniqueField && row.data) {
    const value = row.data[uniqueField];
    if (typeof value === 'string' && value) {
      const conflict = (await table.where(uniqueField).equals(value).first()) as
        | Record<string, unknown>
        | undefined;
      if (conflict) {
        const conflictId = String(conflict.id ?? conflict.key ?? '');
        if (conflictId && conflictId !== id) {
          await db.transaction('rw', [table, db.syncMeta], async (trans) => {
            remoteContext.enter(trans);
            try {
              await table.delete(conflictId);
              await db.syncMeta.delete(`${row.table_name}|${conflictId}`);
            } finally {
              remoteContext.exit(trans);
            }
          });
        }
      }
    }
  }

  await db.transaction('rw', [table, db.syncMeta], async (trans) => {
    remoteContext.enter(trans);
    try {
      if (row.deleted) {
        await table.delete(id);
      } else if (row.data) {
        const data = { ...row.data };
        if (row.table_name === 'users') {
          // Estos campos son propios de cada dispositivo y no deben viajar.
          const existing = (await table.get(id)) as Record<string, unknown> | undefined;
          if (existing) {
            data.lastLoginAt = existing.lastLoginAt ?? null;
            data.failedAttempts = existing.failedAttempts ?? 0;
            data.lockedUntil = existing.lockedUntil ?? null;
          }
        }
        await table.put(data);
      }

      await db.syncMeta.put({
        key,
        table: row.table_name,
        recordId: id,
        updatedAt: remoteAt,
        deleted: row.deleted ? 1 : 0,
        dirty: 0,
        deviceId: remoteDevice,
        serverUpdatedAt: row.updated_at,
      });
    } finally {
      remoteContext.exit(trans);
    }
  });

  return 'applied';
}

interface PullResult {
  applied: number;
  tables: Set<string>;
}

async function pullRemote(supabase: SupabaseClient, full = false): Promise<PullResult> {
  const cursor = full ? null : getSyncCursor();
  let offset = 0;
  let applied = 0;
  const tables = new Set<string>();
  let maxUpdated = cursor;

  for (let page = 0; page < MAX_PULL_PAGES; page++) {
    let query = supabase
      .from(REMOTE_TABLE)
      .select('table_name, record_id, data, deleted, device_id, client_updated_at, updated_at')
      .order('updated_at', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    if (cursor) query = query.gt('updated_at', cursor);

    const { data, error } = await query;
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as RemoteRow[];
    if (rows.length === 0) break;

    for (const row of rows) {
      const result = await applyRemoteRow(row);
      if (result === 'applied') {
        applied++;
        tables.add(row.table_name);
      }
      if (!maxUpdated || row.updated_at > maxUpdated) maxUpdated = row.updated_at;
    }

    if (rows.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  if (maxUpdated && maxUpdated !== cursor) setSyncCursor(maxUpdated);
  if (applied > 0) window.dispatchEvent(new Event('inventra:remote-applied'));
  return { applied, tables };
}

const round4 = (n: number) => Math.round(n * 10000) / 10000;

interface RebuiltLocationRow {
  productId: string;
  locationId: string;
  lotCode?: string;
  qty: number;
  updatedAt: string;
}

/**
 * Reconstruye los saldos derivados (stock del producto y stock por ubicación)
 * a partir del historial de movimientos. Se ejecuta tras recibir cambios de
 * otro equipo para que las existencias no dependan de valores viajados.
 */
export async function rebuildDerivedState(): Promise<void> {
  const [products, movements, locations] = await Promise.all([
    db.products.toArray(),
    db.movements.toArray(),
    db.locations.toArray(),
  ]);
  if (movements.length === 0 && products.length === 0) return;

  const locationIds = new Set(locations.map((location) => location.id));
  const productIds = new Set(products.map((product) => product.id));
  const ordered = movements
    .slice()
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));

  const totals = new Map<string, number>();
  for (const movement of ordered) {
    if (!productIds.has(movement.productId)) continue;
    totals.set(
      movement.productId,
      (totals.get(movement.productId) ?? 0) + movement.direction * movement.qty,
    );
  }

  const rows = new Map<string, RebuiltLocationRow>();
  const keyOf = (productId: string, locationId: string, lotCode?: string) =>
    `${productId}|${locationId}|${lotCode ?? ''}`;

  const takeFrom = (
    productId: string,
    locationId: string | null,
    lotCode: string | undefined,
    qty: number,
    at: string,
  ) => {
    let remaining = qty;
    const candidates = [...rows.values()]
      .filter(
        (row) =>
          row.productId === productId &&
          (locationId === null || row.locationId === locationId) &&
          row.qty > 0 &&
          (!lotCode || (row.lotCode ?? '') === lotCode),
      )
      .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
    for (const row of candidates) {
      if (remaining <= 0) break;
      const take = Math.min(row.qty, remaining);
      row.qty = round4(row.qty - take);
      row.updatedAt = at;
      remaining = round4(remaining - take);
    }
  };

  for (const movement of ordered) {
    if (!Number.isFinite(movement.qty) || movement.qty <= 0) continue;
    if (!productIds.has(movement.productId)) continue;
    if (movement.locationId && locationIds.has(movement.locationId)) {
      if (movement.direction === 1) {
        const key = keyOf(movement.productId, movement.locationId, movement.lotCode);
        const row = rows.get(key) ?? {
          productId: movement.productId,
          locationId: movement.locationId,
          lotCode: movement.lotCode,
          qty: 0,
          updatedAt: movement.createdAt,
        };
        row.qty = round4(row.qty + movement.qty);
        row.updatedAt = movement.createdAt;
        rows.set(key, row);
      } else {
        takeFrom(movement.productId, movement.locationId, movement.lotCode, movement.qty, movement.createdAt);
      }
    } else if (movement.direction === -1) {
      takeFrom(movement.productId, null, movement.lotCode, movement.qty, movement.createdAt);
    }
  }

  const nextRows: LocationStock[] = [...rows.values()]
    .filter((row) => Math.abs(row.qty) > 0.0001)
    .map((row) => ({
      id: `LS|${row.productId}|${row.locationId}|${row.lotCode ?? ''}`,
      productId: row.productId,
      locationId: row.locationId,
      lotCode: row.lotCode,
      qty: round4(row.qty),
      updatedAt: row.updatedAt,
    }));

  await db.transaction('rw', [db.products, db.locationStock], async (trans) => {
    remoteContext.enter(trans);
    try {
      for (const product of products) {
        const total = round4(totals.get(product.id) ?? 0);
        if (Math.abs(total - product.stock) > 0.001) {
          await db.products.update(product.id, { stock: total });
        }
      }
      await db.locationStock.clear();
      if (nextRows.length > 0) await db.locationStock.bulkPut(nextRows);
    } finally {
      remoteContext.exit(trans);
    }
  });
}

async function pushDirty(supabase: SupabaseClient): Promise<number> {
  let pushed = 0;

  for (let batch = 0; batch < MAX_PUSH_BATCHES; batch++) {
    const metas = await db.syncMeta.where('dirty').equals(1).limit(PUSH_BATCH).toArray();
    if (metas.length === 0) break;

    const rows: {
      table_name: string;
      record_id: string;
      data: Record<string, unknown> | null;
      deleted: boolean;
      device_id: string;
      client_updated_at: string;
    }[] = [];

    for (const meta of metas) {
      if (!isSyncTable(meta.table)) {
        await db.syncMeta.delete(meta.key);
        continue;
      }
      const record = meta.deleted ? undefined : ((await db.table(meta.table).get(meta.recordId)) as
        | Record<string, unknown>
        | undefined);

      let data = record ?? null;
      let deleted = meta.deleted === 1;

      // El registro desapareció sin pasar por el hook de borrado.
      if (!deleted && !data) deleted = true;

      if (meta.table === 'users' && data) {
        data = { ...data, lastLoginAt: null, failedAttempts: 0, lockedUntil: null };
      }

      rows.push({
        table_name: meta.table,
        record_id: meta.recordId,
        data: deleted ? null : data,
        deleted,
        device_id: deviceId(),
        client_updated_at: meta.updatedAt,
      });
    }

    if (rows.length === 0) continue;

    const { error } = await supabase
      .from(REMOTE_TABLE)
      .upsert(rows, { onConflict: 'table_name,record_id' });
    if (error) throw new Error(error.message);

    // Limpia solo los metadatos que no cambiaron mientras se enviaban.
    const pushedAt = new Map(metas.map((meta) => [meta.key, meta.updatedAt]));
    const latest = await db.syncMeta.bulkGet(metas.map((meta) => meta.key));
    const cleared: SyncMeta[] = [];
    for (const meta of latest) {
      if (meta && meta.dirty === 1 && meta.updatedAt === pushedAt.get(meta.key)) {
        cleared.push({ ...meta, dirty: 0 });
      }
    }
    if (cleared.length > 0) await db.syncMeta.bulkPut(cleared);
    pushed += rows.length;
  }

  return pushed;
}

/* ------------------------------------------------------------------ */
/* Sincronización                                                     */
/* ------------------------------------------------------------------ */

let running = false;
let rerunRequested = false;
let scheduled: number | null = null;

/**
 * Programa una sincronización automática tras cada interacción.
 * Si ya hay una sincronización en curso, se encola otra al terminar.
 */
function scheduleSync(delay = 500): void {
  const config = getCloudConfig();
  if (!config?.autoSync) return;
  if (scheduled) window.clearTimeout(scheduled);
  scheduled = window.setTimeout(() => {
    scheduled = null;
    void syncNow('cambio local');
  }, delay);
}

export async function syncNow(reason = 'manual'): Promise<SyncResult> {
  const config = getCloudConfig();
  if (!config) {
    setStatus({ state: 'disabled', connected: false, email: null });
    return { ok: false, pushed: 0, pulled: 0, error: 'La nube no está configurada.' };
  }
  if (!navigator.onLine) {
    setStatus({ state: 'offline', connected: true, email: config.email });
    return { ok: false, pushed: 0, pulled: 0, error: 'Sin conexión a internet.' };
  }
  if (running) {
    rerunRequested = true;
    return { ok: true, pushed: 0, pulled: 0, skipped: true };
  }

  running = true;
  setStatus({ state: 'syncing', connected: true, email: config.email, lastError: null });

  try {
    const supabase = await getSupabase();
    if (!supabase) throw new Error('No fue posible inicializar el cliente de Supabase.');
    if (!(await hasSession(supabase))) {
      throw new Error('La sesión de la nube expiró. Vuelva a conectar el dispositivo.');
    }

    const fullPull =
      reason === 'manual' ||
      reason === 'arranque' ||
      reason === 'conexión' ||
      reason === 'conexión restablecida' ||
      reason === 'descargar todo' ||
      reason === 'subir todo';
    const pull = await pullRemote(supabase, fullPull);
    if (pull.tables.has('movements') || pull.tables.has('products') || pull.tables.has('locations')) {
      await rebuildDerivedState();
    }
    const pushed = await pushDirty(supabase);

    const stamp = new Date().toISOString();
    setLastSyncAt(stamp);
    setStatus({ state: 'idle', lastSync: stamp, lastError: null });
    await refreshPending();
    console.info(`Invencodi sync (${reason}): ${pushed} enviados, ${pull.applied} recibidos.`);
    return { ok: true, pushed, pulled: pull.applied };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error desconocido de sincronización.';
    setStatus({ state: 'error', lastError: message });
    return { ok: false, pushed: 0, pulled: 0, error: message };
  } finally {
    running = false;
    if (rerunRequested) {
      rerunRequested = false;
      scheduleSync(250);
    }
  }
}

/* ------------------------------------------------------------------ */
/* Conexión y desconexión                                             */
/* ------------------------------------------------------------------ */

function authErrorMessage(message: string): string {
  const lower = message.toLowerCase();
  if (lower.includes('invalid login credentials')) return 'Correo o contraseña de la nube incorrectos.';
  if (lower.includes('email not confirmed')) {
    return 'La cuenta de la nube aún no confirma el correo. Confírmelo desde el panel de Supabase o desactive la confirmación por correo.';
  }
  if (lower.includes('user already registered')) return 'La cuenta ya existe; revise la contraseña de la nube.';
  if (lower.includes('signups not allowed') || lower.includes('signup is disabled')) {
    return 'La cuenta de nube no existe o la contraseña es incorrecta.';
  }
  if (lower.includes('password')) return 'La contraseña de la nube no cumple los requisitos (mínimo 6 caracteres).';
  return message;
}

async function clearLocalSyncedData(): Promise<void> {
  const tables = SYNC_TABLES.map((name) => db.table(name));
  await db.transaction('rw', [...tables, db.syncMeta], async (trans) => {
    remoteContext.enter(trans);
    try {
      for (const name of SYNC_TABLES) await db.table(name).clear();
      await db.syncMeta.clear();
    } finally {
      remoteContext.exit(trans);
    }
  });
  setSyncCursor('');
  await refreshPending();
}

/** Fuerza que todo el contenido local se suba en la próxima sincronización. */
async function markAllDirty(): Promise<void> {
  const stamp = new Date().toISOString();
  const id = deviceId();
  await db.syncMeta.toCollection().modify((meta) => {
    meta.dirty = 1;
    meta.updatedAt = stamp;
    meta.deviceId = id;
  });
  await refreshPending();
}

/**
 * Cantidad de registros operativos (no configuración ni usuarios). Sirve para
 * distinguir una instalación nueva —que debe descargar la nube— de un equipo
 * que ya tiene trabajo propio y debe combinarse.
 */
const OPERATIONAL_TABLES = [
  'products',
  'movements',
  'lots',
  'boms',
  'bomItems',
  'productionOrders',
  'consumptions',
  'counts',
  'machines',
  'productionRecords',
  'pnc',
  'locations',
  'transfers',
  'dispatches',
  'messages',
] as const;

async function localOperationalCount(): Promise<number> {
  const counts = await Promise.all(OPERATIONAL_TABLES.map((name) => db.table(name).count()));
  return counts.reduce((total, value) => total + value, 0);
}

export async function connectCloud(input: ConnectInput, mode: InitialMode = 'auto'): Promise<ConnectResult> {
  if (!navigator.onLine) throw new Error('Conecte el dispositivo a internet para configurar la nube.');
  if (!input.url.trim() || !input.anonKey.trim() || !input.email.trim() || !input.password) {
    throw new Error('Complete la URL, la llave anónima, el correo y la contraseña de la nube.');
  }
  if (input.password.length < 6) throw new Error('La contraseña de la nube debe tener al menos 6 caracteres.');
  const url = normalizeCloudUrl(input.url);
  if (!/^https?:\/\//i.test(url)) throw new Error('La URL debe comenzar por https://');

  const config: CloudConfig = {
    url,
    anonKey: input.anonKey.trim(),
    email: input.email.trim().toLowerCase(),
    autoSync: true,
    connectedAt: new Date().toISOString(),
  };
  saveCloudConfig(config);

  let supabase: SupabaseClient | null = null;
  try {
    supabase = await getSupabase();
    if (!supabase) throw new Error('No fue posible inicializar el cliente de Supabase.');

    const signIn = await supabase.auth.signInWithPassword({
      email: config.email,
      password: input.password,
    });
    if (signIn.error) {
      const signUp = await supabase.auth.signUp({ email: config.email, password: input.password });
      if (signUp.error) throw new Error(authErrorMessage(signUp.error.message));
      if (!signUp.data.session) {
        throw new Error(
          'La cuenta se creó, pero Supabase exige confirmar el correo. Confirme el enlace recibido o desactive "Confirm email" en Authentication → Providers → Email.',
        );
      }
    }

    await ensureRemoteTable(supabase);
    const count = await remoteCount(supabase);

    // Asegura que todo registro local tenga metadato antes de decidir.
    await reconcileLocalRecords(true);
    const hasLocalData = (await localOperationalCount()) > 0;

    let effective = mode;
    if (mode === 'auto') {
      effective = count === 0 ? 'push' : hasLocalData ? 'both' : 'pull';
    }

    if (effective === 'pull') {
      await clearLocalSyncedData();
    } else if (effective === 'push') {
      await markAllDirty();
    }

    setStatus({ connected: true, email: config.email, state: 'idle', lastError: null });
    const result = await syncNow('conexión');
    return { ...result, mode: effective, remoteCount: count };
  } catch (error) {
    clearCloudConfig();
    if (supabase) await supabase.auth.signOut().catch(() => undefined);
    const message = error instanceof Error ? error.message : 'No fue posible conectar la nube.';
    setStatus({ state: 'error', connected: false, email: null, lastError: message });
    throw new Error(message);
  }
}

export async function disconnectCloud(): Promise<void> {
  const supabase = await getSupabase().catch(() => null);
  if (supabase) await supabase.auth.signOut().catch(() => undefined);
  clearCloudConfig();
  setSyncCursor('');
  setStatus({
    state: 'disabled',
    connected: false,
    email: null,
    pending: status.pending,
    lastError: null,
  });
}

/** Fuerza la subida de todo el contenido local usando la sesión actual. */
export async function pushAllLocal(): Promise<SyncResult> {
  const config = getCloudConfig();
  if (!config) return { ok: false, pushed: 0, pulled: 0, error: 'La nube no está configurada.' };
  if (!navigator.onLine) return { ok: false, pushed: 0, pulled: 0, error: 'Sin conexión a internet.' };
  const supabase = await getSupabase();
  if (!supabase) return { ok: false, pushed: 0, pulled: 0, error: 'Cliente de Supabase no disponible.' };
  if (!(await hasSession(supabase))) {
    return { ok: false, pushed: 0, pulled: 0, error: 'La sesión de la nube expiró. Vuelva a conectar.' };
  }
  await reconcileLocalRecords(true);
  await markAllDirty();
  return syncNow('subir todo');
}

/** Reemplaza el contenido local con la copia del servidor. */
export async function pullAllRemote(): Promise<SyncResult> {
  const config = getCloudConfig();
  if (!config) return { ok: false, pushed: 0, pulled: 0, error: 'La nube no está configurada.' };
  if (!navigator.onLine) return { ok: false, pushed: 0, pulled: 0, error: 'Sin conexión a internet.' };
  const supabase = await getSupabase();
  if (!supabase) return { ok: false, pushed: 0, pulled: 0, error: 'Cliente de Supabase no disponible.' };
  if (!(await hasSession(supabase))) {
    return { ok: false, pushed: 0, pulled: 0, error: 'La sesión de la nube expiró. Vuelva a conectar.' };
  }
  await clearLocalSyncedData();
  await reconcileLocalRecords(true);
  return syncNow('descargar todo');
}

export function setAutoSync(enabled: boolean): void {
  patchCloudConfig({ autoSync: enabled });
  setStatus({});
  if (enabled) void syncNow('activación');
}

/* ------------------------------------------------------------------ */
/* Arranque                                                           */
/* ------------------------------------------------------------------ */

let initialized = false;

export function initSync(): void {
  if (initialized) return;
  initialized = true;

  installSyncHooks();

  const config = getCloudConfig();
  setStatus({
    state: config ? (navigator.onLine ? 'idle' : 'offline') : 'disabled',
    connected: Boolean(config),
    email: config?.email ?? null,
    lastSync: getLastSyncAt(),
    pending: 0,
    lastError: null,
  });

  void reconcileLocalRecords()
    .then(() => refreshPending())
    .then(() => {
      if (config) void syncNow('arranque');
    });

  window.addEventListener('online', () => {
    if (getCloudConfig()) void syncNow('conexión restablecida');
  });
  window.addEventListener('offline', () => setStatus({ state: 'offline' }));
  window.addEventListener('focus', () => {
    if (getCloudConfig()?.autoSync) void syncNow('foco');
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && getCloudConfig()?.autoSync) void syncNow('visible');
  });
  window.setInterval(() => {
    const current = getCloudConfig();
    if (current?.autoSync && navigator.onLine) void syncNow('intervalo');
  }, 30000);
}

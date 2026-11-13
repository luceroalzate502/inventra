// Tipos y catálogos de dominio — INVENTRA
// Nota: se usan objetos constantes en lugar de enums (erasableSyntaxOnly).

export type Role = 'admin' | 'jefe' | 'almacenista' | 'produccion' | 'consulta';

export const ROLES: Record<Role, { label: string; short: string }> = {
  admin: { label: 'Administrador', short: 'Admin' },
  jefe: { label: 'Jefe de inventarios', short: 'Jefe' },
  almacenista: { label: 'Almacenista', short: 'Almacén' },
  produccion: { label: 'Producción', short: 'Producción' },
  consulta: { label: 'Consulta', short: 'Consulta' },
};

export type ProductType = 'MP' | 'ME' | 'IN' | 'PP' | 'PT' | 'RE';

export const PRODUCT_TYPES: {
  value: ProductType;
  label: string;
  plural: string;
  color: string;
}[] = [
  { value: 'MP', label: 'Materia prima', plural: 'Materias primas', color: '#0f9b8e' },
  { value: 'ME', label: 'Material de empaque', plural: 'Empaques', color: '#3b82f6' },
  { value: 'IN', label: 'Insumo', plural: 'Insumos', color: '#8b5cf6' },
  { value: 'PP', label: 'Producto en proceso', plural: 'En proceso', color: '#f59e0b' },
  { value: 'PT', label: 'Producto terminado', plural: 'Terminados', color: '#10b981' },
  { value: 'RE', label: 'Repuesto y consumible', plural: 'Repuestos', color: '#64748b' },
];

export const typeLabel = (t: ProductType) =>
  PRODUCT_TYPES.find((p) => p.value === t)?.label ?? t;
export const typeColor = (t: ProductType) =>
  PRODUCT_TYPES.find((p) => p.value === t)?.color ?? '#64748b';

export type Uom = 'UND' | 'KG' | 'LT' | 'MT' | 'CJA' | 'ROLLO' | 'PAR';

export const UOMS: Uom[] = ['UND', 'KG', 'LT', 'MT', 'CJA', 'ROLLO', 'PAR'];

export const UOM_LABEL: Record<Uom, string> = {
  UND: 'Unidad',
  KG: 'Kilogramo',
  LT: 'Litro',
  MT: 'Metro',
  CJA: 'Caja',
  ROLLO: 'Rollo',
  PAR: 'Par',
};

export type MovementType =
  | 'ENTRADA'
  | 'SALIDA'
  | 'AJUSTE_POS'
  | 'AJUSTE_NEG'
  | 'TRASLADO_IN'
  | 'TRASLADO_OUT'
  | 'PROD_IN'
  | 'PROD_CONSUMO'
  | 'REVERSION';

export const MOVEMENT_META: Record<
  MovementType,
  { label: string; dir: 1 | -1; tone: 'in' | 'out' | 'neutral' }
> = {
  ENTRADA: { label: 'Entrada', dir: 1, tone: 'in' },
  SALIDA: { label: 'Salida', dir: -1, tone: 'out' },
  AJUSTE_POS: { label: 'Ajuste positivo', dir: 1, tone: 'in' },
  AJUSTE_NEG: { label: 'Ajuste negativo', dir: -1, tone: 'out' },
  TRASLADO_IN: { label: 'Traslado recibido', dir: 1, tone: 'in' },
  TRASLADO_OUT: { label: 'Traslado enviado', dir: -1, tone: 'out' },
  PROD_IN: { label: 'Producción terminada', dir: 1, tone: 'in' },
  PROD_CONSUMO: { label: 'Consumo de producción', dir: -1, tone: 'out' },
  REVERSION: { label: 'Reversión', dir: -1, tone: 'neutral' },
};

export const ENTRY_REASONS = [
  'Compra a proveedor',
  'Devolución de cliente',
  'Producción terminada',
  'Ajuste positivo',
  'Traslado recibido',
  'Saldo inicial',
  'Otra entrada autorizada',
];

export const EXIT_REASONS = [
  'Consumo de producción',
  'Despacho',
  'Venta',
  'Devolución a proveedor',
  'Ajuste negativo',
  'Traslado',
  'Baja por desperdicio',
  'Baja por obsolescencia',
  'Otra salida autorizada',
];

export const LOCATIONS = ['Planta', 'Almacén'];

/* ============================================================
   Planta: turnos, máquinas y registro diario de producción
   ============================================================ */

export type Shift = 1 | 2 | 3 | 4;

export const SHIFTS: {
  value: Shift;
  label: string;
  short: string;
  start: string;
  end: string;
  minutes: number;
}[] = [
  { value: 1, label: 'Turno 1', short: 'T1', start: '06:00', end: '12:00', minutes: 360 },
  { value: 2, label: 'Turno 2', short: 'T2', start: '12:00', end: '18:00', minutes: 360 },
  { value: 3, label: 'Turno 3', short: 'T3', start: '18:00', end: '00:00', minutes: 360 },
  { value: 4, label: 'Turno 4', short: 'T4', start: '00:00', end: '06:00', minutes: 360 },
];

export const shiftLabel = (s: Shift) => SHIFTS.find((x) => x.value === s)?.label ?? `Turno ${s}`;

export type MachineType = 'inyectora' | 'sopladora' | 'extrusora' | 'otra';

export const MACHINE_TYPES: { value: MachineType; label: string; short: string }[] = [
  { value: 'inyectora', label: 'Inyectora', short: 'INY' },
  { value: 'sopladora', label: 'Sopladora', short: 'SOP' },
  { value: 'extrusora', label: 'Extrusora', short: 'EXT' },
  { value: 'otra', label: 'Otra máquina', short: 'MAQ' },
];

export interface Machine {
  id: string;
  code: string;
  name: string;
  type: MachineType;
  brand: string;
  cavities: number;
  idealCycleSeconds: number;
  status: 'activa' | 'mantenimiento' | 'inactiva';
  locationId?: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProductionRecord {
  id: string;
  code: string;
  date: string; // YYYY-MM-DD
  shift: Shift;
  machineId: string;
  machineCode: string;
  machineName: string;
  productId: string;
  productSku: string;
  productName: string;
  orderId?: string;
  plannedQty: number;
  goodQty: number;
  scrapQty: number;
  shots: number;
  cavities: number;
  plannedMinutes: number;
  downtimeMinutes: number;
  idealCycleSeconds: number;
  scrapReason: string;
  notes: string;
  status: 'abierto' | 'validado';
  lotCode: string;
  locationId?: string;
  movementId?: string;
  pncId?: string;
  userId: string;
  userName: string;
  createdAt: string;
  validatedAt?: string;
  validatedBy?: string;
}

export const SCRAP_REASONS = [
  'Rechupado',
  'Ráfaga / rebaba',
  'Peso fuera de especificación',
  'Defecto dimensional',
  'Color / contaminación',
  'Arranque de máquina',
  'Paro de molde',
  'Otro defecto',
];

/* ============================================================
   Producto no conforme (PNC) y análisis Kaizen
   ============================================================ */

export type DefectType =
  | 'rechupado'
  | 'rafaga'
  | 'rebaba'
  | 'peso'
  | 'dimension'
  | 'color'
  | 'otro';

export const DEFECT_TYPES: { value: DefectType; label: string; color: string }[] = [
  { value: 'rechupado', label: 'Rechupado', color: '#f59e0b' },
  { value: 'rafaga', label: 'Ráfaga', color: '#ef4444' },
  { value: 'rebaba', label: 'Rebaba', color: '#8b5cf6' },
  { value: 'peso', label: 'Peso fuera de especificación', color: '#3b82f6' },
  { value: 'dimension', label: 'Defecto dimensional', color: '#0ea5e9' },
  { value: 'color', label: 'Color / contaminación', color: '#14b8a6' },
  { value: 'otro', label: 'Otro', color: '#64748b' },
];

export const ROOT_CAUSES = [
  'Máquina / equipo',
  'Molde',
  'Material / resina',
  'Método / parámetros',
  'Mano de obra',
  'Medición / inspección',
  'Medio ambiente',
];

export type PncStatus = 'abierto' | 'segregado' | 'en_analisis' | 'cerrado' | 'reprocesado' | 'desechado';

export const PNC_STATUS: Record<PncStatus, { label: string; tone: 'ok' | 'warn' | 'danger' | 'info' | 'muted' | 'brand' }> = {
  abierto: { label: 'Abierto', tone: 'warn' },
  segregado: { label: 'Segregado / bloqueado', tone: 'danger' },
  en_analisis: { label: 'En análisis Kaizen', tone: 'info' },
  cerrado: { label: 'Cerrado', tone: 'ok' },
  reprocesado: { label: 'Reprocesado', tone: 'brand' },
  desechado: { label: 'Desechado', tone: 'muted' },
};

export interface NonConformity {
  id: string;
  code: string;
  date: string;
  productId: string;
  productSku: string;
  productName: string;
  lotCode: string;
  qty: number;
  unitCost: number;
  defectType: DefectType;
  source: 'produccion' | 'almacen' | 'cliente' | 'inspeccion';
  machineId?: string;
  shift?: Shift;
  orderId?: string;
  productionRecordId?: string;
  status: PncStatus;
  containment: string;
  rootCause: string;
  rootCauseDetail: string;
  correctiveAction: string;
  responsible: string;
  kaizenNotes: string;
  disposition: string;
  userId: string;
  userName: string;
  createdAt: string;
  closedAt?: string;
}

/* ============================================================
   Almacén: ubicaciones 5S, stock por ubicación y traslados
   ============================================================ */

export type LocationType = 'curado' | 'pt' | 'rack' | 'estiba' | 'pasillo' | 'despacho' | 'devolucion';

export const LOCATION_TYPES: { value: LocationType; label: string; color: string }[] = [
  { value: 'curado', label: 'Curado / enfriamiento', color: '#f59e0b' },
  { value: 'pt', label: 'Producto terminado', color: '#10b981' },
  { value: 'rack', label: 'Rack', color: '#3b82f6' },
  { value: 'estiba', label: 'Estiba', color: '#8b5cf6' },
  { value: 'pasillo', label: 'Pasillo', color: '#64748b' },
  { value: 'despacho', label: 'Zona de despacho', color: '#0ea5e9' },
  { value: 'devolucion', label: 'Devoluciones', color: '#ef4444' },
];

export interface WarehouseLocation {
  id: string;
  code: string;
  name: string;
  type: LocationType;
  zone: string;
  capacity: number;
  status: 'activa' | 'inactiva';
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface LocationStock {
  id: string;
  productId: string;
  locationId: string;
  lotCode?: string;
  qty: number;
  updatedAt: string;
}

export interface Transfer {
  id: string;
  code: string;
  productId: string;
  productSku: string;
  productName: string;
  qty: number;
  uom: Uom;
  fromLocationId: string;
  fromLocationName: string;
  toLocationId: string;
  toLocationName: string;
  lotCode?: string;
  notes: string;
  userId: string;
  userName: string;
  createdAt: string;
}

/* ============================================================
   Despachos y logística externa
   ============================================================ */

export type DispatchStatus = 'borrador' | 'picking' | 'despachado' | 'anulado';

export const DISPATCH_STATUS: Record<
  DispatchStatus,
  { label: string; tone: 'ok' | 'warn' | 'danger' | 'info' | 'muted' | 'brand' }
> = {
  borrador: { label: 'Borrador', tone: 'muted' },
  picking: { label: 'En picking', tone: 'warn' },
  despachado: { label: 'Despachado', tone: 'ok' },
  anulado: { label: 'Anulado', tone: 'danger' },
};

export interface DispatchItem {
  productId: string;
  sku: string;
  name: string;
  uom: Uom;
  requestedQty: number;
  pickedQty: number;
  lotCode?: string;
  locationId?: string;
  locationName?: string;
  scanned: boolean;
}

export interface Dispatch {
  id: string;
  code: string;
  date: string;
  customer: string;
  orderRef: string;
  vehicle: string;
  driver: string;
  destination: string;
  notes: string;
  status: DispatchStatus;
  items: DispatchItem[];
  remision: string;
  packingList: string;
  userId: string;
  userName: string;
  createdAt: string;
  dispatchedAt?: string;
  movementIds?: string[];
}

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  pinHash: string;
  salt: string;
  active: boolean;
  failedAttempts: number;
  lockedUntil: number | null;
  createdAt: string;
  lastLoginAt: string | null;
  phone?: string;
}

export interface Product {
  id: string;
  sku: string;
  name: string;
  description: string;
  category: string;
  type: ProductType;
  uom: Uom;
  cost: number;
  stock: number;
  minStock: number;
  maxStock: number;
  location: string;
  locationId?: string;
  barcode: string;
  lotTracked: boolean;
  status: 'activo' | 'inactivo';
  createdAt: string;
  updatedAt: string;
}

export interface Movement {
  id: string;
  code: string;
  type: MovementType;
  direction: 1 | -1;
  reason: string;
  productId: string;
  productSku: string;
  productName: string;
  qty: number;
  unitCost: number;
  totalCost: number;
  stockBefore: number;
  stockAfter: number;
  lotCode?: string;
  locationId?: string;
  locationName?: string;
  counterparty?: string;
  refDoc?: string;
  orderId?: string;
  notes?: string;
  userId: string;
  userName: string;
  createdAt: string;
  reversalOf?: string;
  reversedBy?: string;
}

export interface Lot {
  id: string;
  productId: string;
  code: string;
  qty: number;
  unitCost: number;
  receivedAt: string;
  expiresAt?: string;
  blocked?: boolean;
}

export interface BomItem {
  id: string;
  bomId: string;
  componentId: string;
  qty: number;
  uom: Uom;
  wastePct: number;
}

export interface Bom {
  id: string;
  code: string;
  productId: string;
  version: number;
  status: 'borrador' | 'activo' | 'obsoleto';
  outputQty: number;
  laborCost: number;
  notes: string;
  createdAt: string;
  createdBy: string;
}

export interface ProductionOrder {
  id: string;
  code: string;
  productId: string;
  bomId: string;
  bomVersion: number;
  plannedQty: number;
  producedQty: number;
  rejectedQty: number;
  status: 'borrador' | 'liberada' | 'en_proceso' | 'cerrada' | 'cancelada';
  materialsCost: number;
  laborCost: number;
  totalCost: number;
  scheduledDate: string;
  startedAt: string | null;
  closedAt: string | null;
  userId: string;
  userName: string;
  notes: string;
  createdAt: string;
}

export const ORDER_STATUS: Record<
  ProductionOrder['status'],
  { label: string; tone: 'ok' | 'warn' | 'danger' | 'info' | 'muted' }
> = {
  borrador: { label: 'Borrador', tone: 'muted' },
  liberada: { label: 'Liberada', tone: 'info' },
  en_proceso: { label: 'En proceso', tone: 'warn' },
  cerrada: { label: 'Cerrada', tone: 'ok' },
  cancelada: { label: 'Cancelada', tone: 'danger' },
};

export interface Consumption {
  id: string;
  orderId: string;
  productId: string;
  plannedQty: number;
  realQty: number;
  wasteQty: number;
  unitCost: number;
  totalCost: number;
  lotCode?: string;
  createdAt: string;
}

export interface AuditEntry {
  id: string;
  entity: string;
  entityId: string;
  action: 'crear' | 'actualizar' | 'revertir' | 'login' | 'cierre' | 'eliminar';
  summary: string;
  before?: unknown;
  after?: unknown;
  userId: string;
  userName: string;
  at: string;
}

export interface CountItem {
  productId: string;
  sku: string;
  name: string;
  uom: Uom;
  systemQty: number;
  countedQty: number;
  diff: number;
  unitCost: number;
}

export interface PhysicalCount {
  id: string;
  code: string;
  status: 'abierto' | 'cerrado';
  location: string;
  items: CountItem[];
  createdAt: string;
  closedAt: string | null;
  userId: string;
  userName: string;
}

export interface Settings {
  key: string;
  companyName: string;
  nit: string;
  currency: 'COP';
  allowNegativeStock: boolean;
  sessionMinutes: number;
  lowStockAlert: boolean;
  decimals: number;
  warehouseManager: string;
}

export interface Counter {
  prefix: string;
  value: number;
}

export interface OutboxEvent {
  id?: number;
  entity: string;
  entityId: string;
  action: string;
  payload: unknown;
  at: string;
  synced: 0 | 1;
}

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: Role;
}

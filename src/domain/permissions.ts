import type { Role } from './types';

export type Permission =
  | 'products.edit'
  | 'inventory.entry'
  | 'inventory.exit'
  | 'inventory.override'
  | 'inventory.reverse'
  | 'production.manage'
  | 'production.daily'
  | 'bom.edit'
  | 'mrp.view'
  | 'warehouse.locations'
  | 'dispatch.manage'
  | 'pnc.manage'
  | 'data.import'
  | 'reports.view'
  | 'reports.export'
  | 'counts.manage'
  | 'users.manage'
  | 'settings.manage'
  | 'audit.view';

/** Autorización guardada por el administrador para un rol. */
export interface RolePermission {
  role: Role;
  grants: Partial<Record<Permission, boolean>>;
}

type PermissionMap = Partial<Record<Role, Partial<Record<Permission, boolean>>>>;

export const ALL_PERMISSIONS: Permission[] = [
  'products.edit',
  'inventory.entry',
  'inventory.exit',
  'inventory.override',
  'inventory.reverse',
  'production.manage',
  'production.daily',
  'bom.edit',
  'mrp.view',
  'warehouse.locations',
  'dispatch.manage',
  'pnc.manage',
  'data.import',
  'reports.view',
  'reports.export',
  'counts.manage',
  'users.manage',
  'settings.manage',
  'audit.view',
];

const ALL_PERMISSION_SET = new Set<string>(ALL_PERMISSIONS);

/** Verifica que un valor leído de la base corresponda a una función conocida. */
export function isPermission(value: string): value is Permission {
  return ALL_PERMISSION_SET.has(value);
}

export const PERMISSION_LABELS: Record<Permission, string> = {
  'products.edit': 'Crear y editar productos',
  'inventory.entry': 'Registrar entradas',
  'inventory.exit': 'Registrar salidas',
  'inventory.override': 'Autorizar stock negativo',
  'inventory.reverse': 'Revertir movimientos',
  'production.manage': 'Gestionar órdenes de producción',
  'production.daily': 'Registrar producción diaria por turno y máquina',
  'bom.edit': 'Editar listas de materiales',
  'mrp.view': 'Consultar el plan MRP de materiales',
  'warehouse.locations': 'Administrar ubicaciones y traslados internos',
  'dispatch.manage': 'Crear y confirmar despachos',
  'pnc.manage': 'Gestionar producto no conforme y Kaizen',
  'data.import': 'Importar catálogos desde Excel',
  'reports.view': 'Consultar reportes e indicadores',
  'reports.export': 'Exportar reportes (Excel / PDF)',
  'counts.manage': 'Realizar conteos físicos',
  'users.manage': 'Administrar usuarios y roles',
  'settings.manage': 'Modificar configuración del sistema',
  'audit.view': 'Consultar auditoría',
};

export const PERMISSION_GROUPS: { label: string; permissions: Permission[] }[] = [
  {
    label: 'Catálogo e inventario',
    permissions: ['products.edit', 'inventory.entry', 'inventory.exit', 'inventory.override', 'inventory.reverse'],
  },
  {
    label: 'Producción y calidad',
    permissions: ['production.manage', 'production.daily', 'bom.edit', 'mrp.view', 'pnc.manage'],
  },
  {
    label: 'Almacén y despachos',
    permissions: ['warehouse.locations', 'dispatch.manage'],
  },
  {
    label: 'Análisis',
    permissions: ['reports.view', 'reports.export', 'counts.manage', 'data.import'],
  },
  {
    label: 'Administración',
    permissions: ['users.manage', 'settings.manage', 'audit.view'],
  },
];

const MATRIX: Record<Role, Permission[]> = {
  admin: ALL_PERMISSIONS,
  jefe: [
    'products.edit',
    'inventory.entry',
    'inventory.exit',
    'inventory.override',
    'inventory.reverse',
    'production.manage',
    'production.daily',
    'bom.edit',
    'mrp.view',
    'warehouse.locations',
    'dispatch.manage',
    'pnc.manage',
    'data.import',
    'reports.view',
    'reports.export',
    'counts.manage',
    'audit.view',
  ],
  almacenista: [
    'inventory.entry',
    'inventory.exit',
    'warehouse.locations',
    'dispatch.manage',
    'pnc.manage',
    'reports.view',
    'reports.export',
    'counts.manage',
  ],
  produccion: [
    'production.manage',
    'production.daily',
    'bom.edit',
    'mrp.view',
    'pnc.manage',
    'reports.view',
    'reports.export',
  ],
  consulta: ['reports.view'],
};

/*
 * Autorizaciones configuradas por el administrador. Se mantienen en memoria
 * para que todas las pantallas usen la misma regla; `usePermissionSync` las
 * recarga desde IndexedDB y fuerza un redibujado cuando cambian.
 */
let overrides: PermissionMap = {};

/** Reemplaza las autorizaciones manuales con las filas guardadas en la base. */
export function setPermissionOverrides(rows: RolePermission[]): void {
  const next: PermissionMap = {};
  for (const row of rows) {
    if (!row?.role) continue;
    const grants: Partial<Record<Permission, boolean>> = {};
    for (const [key, value] of Object.entries(row.grants ?? {})) {
      if (isPermission(key) && typeof value === 'boolean') grants[key] = value;
    }
    next[row.role] = grants;
  }
  overrides = next;
}

/**
 * El administrador siempre conserva estas dos funciones para poder corregir
 * los permisos que él mismo haya cambiado.
 */
const ADMIN_LOCKED: Permission[] = ['users.manage', 'settings.manage'];

export function isPermissionLocked(role: Role, permission: Permission): boolean {
  return role === 'admin' && ADMIN_LOCKED.includes(permission);
}

export function can(role: Role, permission: Permission): boolean {
  if (isPermissionLocked(role, permission)) return true;
  const explicit = overrides[role]?.[permission];
  if (typeof explicit === 'boolean') return explicit;
  return MATRIX[role]?.includes(permission) ?? false;
}

export function permissionsOf(role: Role): Permission[] {
  return MATRIX[role] ?? [];
}

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

const ALL: Permission[] = [
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
  admin: ALL,
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

export function can(role: Role, permission: Permission): boolean {
  return MATRIX[role]?.includes(permission) ?? false;
}

export function permissionsOf(role: Role): Permission[] {
  return MATRIX[role] ?? [];
}

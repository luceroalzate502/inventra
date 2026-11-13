// Carga masiva y plantillas Excel (SheetJS) para catálogos operativos.

import * as XLSX from 'xlsx';
import { db } from '../db/schema';
import { uid } from './format';
import { BusinessError } from './movements';
import { exportExcel } from './export';
import type {
  Bom,
  BomItem,
  LocationType,
  Machine,
  MachineType,
  Product,
  ProductType,
  SessionUser,
  Uom,
  WarehouseLocation,
} from './types';
import { LOCATION_TYPES, MACHINE_TYPES, PRODUCT_TYPES, UOMS } from './types';

export type ExcelRow = Record<string, string>;

export interface ImportResult {
  created: number;
  updated: number;
  skipped: number;
  errors: string[];
}

const normalizeKey = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase();

const normalizeRow = (row: Record<string, unknown>): ExcelRow => {
  const out: ExcelRow = {};
  for (const [key, value] of Object.entries(row)) {
    out[normalizeKey(key)] = value === null || value === undefined ? '' : String(value).trim();
  }
  return out;
};

export async function readExcelFile(file: File): Promise<ExcelRow[]> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array' });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new BusinessError('FILE', 'El archivo no contiene hojas.');
  const sheet = workbook.Sheets[sheetName];
  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });
  return raw.map(normalizeRow).filter((row) => Object.values(row).some((v) => v !== ''));
}

const pick = (row: ExcelRow, ...keys: string[]) => {
  for (const key of keys) {
    const value = row[normalizeKey(key)];
    if (value !== undefined && value !== '') return value;
  }
  return '';
};

const num = (row: ExcelRow, ...keys: string[]) => {
  const raw = pick(row, ...keys).replace(/\s/g, '');
  const value = raw.includes(',')
    ? Number(raw.replace(/\./g, '').replace(',', '.'))
    : Number(raw);
  return Number.isFinite(value) ? value : 0;
};

const yes = (row: ExcelRow, ...keys: string[]) => {
  const value = pick(row, ...keys).toUpperCase();
  return ['SI', 'SÍ', 'S', 'TRUE', '1', 'X', 'YES'].includes(value);
};

const matchType = (raw: string): ProductType | null => {
  const value = normalizeKey(raw);
  const byValue = PRODUCT_TYPES.find((t) => normalizeKey(t.value) === value);
  if (byValue) return byValue.value;
  const byLabel = PRODUCT_TYPES.find((t) => normalizeKey(t.label) === value || normalizeKey(t.plural) === value);
  return byLabel?.value ?? null;
};

const matchUom = (raw: string): Uom | null => {
  const value = normalizeKey(raw);
  return UOMS.find((u) => normalizeKey(u) === value) ?? null;
};

const matchLocationType = (raw: string): LocationType => {
  const value = normalizeKey(raw);
  return LOCATION_TYPES.find((t) => normalizeKey(t.value) === value || normalizeKey(t.label) === value)?.value ?? 'rack';
};

const matchMachineType = (raw: string): MachineType => {
  const value = normalizeKey(raw);
  return MACHINE_TYPES.find((t) => normalizeKey(t.value) === value || normalizeKey(t.label) === value)?.value ?? 'inyectora';
};

async function writeAudit(
  entity: string,
  entityId: string,
  summary: string,
  user: SessionUser,
): Promise<void> {
  await db.audit.add({
    id: uid(),
    entity,
    entityId,
    action: 'crear',
    summary,
    userId: user.id,
    userName: user.name,
    at: new Date().toISOString(),
  });
}

export function downloadTemplate(
  filename: string,
  sheetName: string,
  headers: string[],
  sample?: Record<string, string | number>[],
): void {
  const rows = sample && sample.length > 0 ? sample : [Object.fromEntries(headers.map((h) => [h, '']))];
  exportExcel(filename, [{ name: sheetName, rows, widths: headers.map((h) => Math.max(14, h.length + 3)) }]);
}

/* ------------------------------------------------------------------ */
/* Productos                                                           */
/* ------------------------------------------------------------------ */

export async function importProducts(rows: ExcelRow[], user: SessionUser): Promise<ImportResult> {
  const result: ImportResult = { created: 0, updated: 0, skipped: 0, errors: [] };
  await db.transaction('rw', [db.products, db.audit], async () => {
    for (const [index, row] of rows.entries()) {
      const line = index + 2;
      try {
        const sku = pick(row, 'SKU', 'CODIGO', 'CODIGO_SKU').toUpperCase();
        const name = pick(row, 'NOMBRE', 'DESCRIPCION', 'PRODUCTO');
        if (!sku || !name) {
          result.skipped++;
          result.errors.push(`Fila ${line}: SKU y NOMBRE son obligatorios.`);
          continue;
        }
        const type = matchType(pick(row, 'TIPO', 'TIPO_INVENTARIO'));
        const uom = matchUom(pick(row, 'UOM', 'UNIDAD', 'UNIDAD_MEDIDA')) ?? 'UND';
        if (!type) {
          result.skipped++;
          result.errors.push(`Fila ${line}: tipo de inventario inválido (MP, ME, IN, PP, PT, RE).`);
          continue;
        }
        const existing = await db.products.where('sku').equals(sku).first();
        const now = new Date().toISOString();
        const base = {
          sku,
          name,
          description: pick(row, 'DESCRIPCION', 'DESCRIPCION_LARGA') || existing?.description || '',
          category: pick(row, 'CATEGORIA', 'LINEA') || existing?.category || 'General',
          type,
          uom,
          cost: num(row, 'COSTO', 'COSTO_UNITARIO', 'PRECIO'),
          minStock: num(row, 'STOCK_MIN', 'MINIMO', 'MIN'),
          maxStock: num(row, 'STOCK_MAX', 'MAXIMO', 'MAX'),
          location: pick(row, 'UBICACION', 'LOCATION') || existing?.location || 'Planta',
          barcode: pick(row, 'CODIGO_BARRAS', 'BARCODE', 'EAN') || existing?.barcode || `770${String(Math.floor(1000000000 + Math.random() * 8999999999)).slice(0, 10)}`,
          lotTracked: pick(row, 'LOTE', 'CONTROL_LOTE') ? yes(row, 'LOTE', 'CONTROL_LOTE') : existing?.lotTracked ?? false,
          status: 'activo' as const,
          updatedAt: now,
        };
        if (existing) {
          await db.products.update(existing.id, base);
          result.updated++;
        } else {
          const product: Product = {
            ...base,
            id: uid(),
            stock: 0,
            createdAt: now,
          };
          await db.products.add(product);
          result.created++;
        }
      } catch (error) {
        result.skipped++;
        result.errors.push(`Fila ${line}: ${error instanceof Error ? error.message : 'error desconocido'}`);
      }
    }
    await writeAudit(
      'import',
      'products',
      `Importación de productos: ${result.created} creados, ${result.updated} actualizados, ${result.skipped} omitidos`,
      user,
    );
  });
  return result;
}

/* ------------------------------------------------------------------ */
/* BOM                                                                 */
/* ------------------------------------------------------------------ */

export async function importBoms(rows: ExcelRow[], user: SessionUser): Promise<ImportResult> {
  const result: ImportResult = { created: 0, updated: 0, skipped: 0, errors: [] };
  await db.transaction('rw', [db.products, db.boms, db.bomItems, db.audit], async () => {
    const groups = new Map<string, ExcelRow[]>();
    for (const row of rows) {
      const code = pick(row, 'BOM_CODIGO', 'CODIGO_BOM', 'BOM').toUpperCase();
      if (!code) {
        result.skipped++;
        result.errors.push('BOM_CODIGO es obligatorio en todas las filas.');
        continue;
      }
      const list = groups.get(code) ?? [];
      list.push(row);
      groups.set(code, list);
    }

    for (const [code, group] of groups.entries()) {
      try {
        const first = group[0];
        const productSku = pick(first, 'PRODUCTO_SKU', 'SKU_PRODUCTO', 'PRODUCTO').toUpperCase();
        const product = await db.products.where('sku').equals(productSku).first();
        if (!product) {
          result.skipped++;
          result.errors.push(`${code}: no existe el producto terminado ${productSku}.`);
          continue;
        }
        const version = Math.max(1, Math.round(num(first, 'VERSION') || 1));
        const outputQty = num(first, 'CANTIDAD_SALIDA', 'SALIDA', 'OUTPUT') || 1;
        const laborCost = num(first, 'MANO_OBRA', 'COSTO_MANO_OBRA');
        const statusRaw = normalizeKey(pick(first, 'ESTADO', 'STATUS'));
        const status: Bom['status'] = statusRaw === 'OBSOLETO' ? 'obsoleto' : statusRaw === 'BORRADOR' ? 'borrador' : 'activo';
        const now = new Date().toISOString();
        let bom = await db.boms.where('code').equals(code).first();
        if (bom) {
          await db.boms.update(bom.id, { productId: product.id, version, outputQty, laborCost, status });
          await db.bomItems.where('bomId').equals(bom.id).delete();
          result.updated++;
        } else {
          bom = {
            id: uid(),
            code,
            productId: product.id,
            version,
            status,
            outputQty,
            laborCost,
            notes: 'Importado desde Excel',
            createdAt: now,
            createdBy: user.name,
          };
          await db.boms.add(bom);
          result.created++;
        }
        if (status === 'activo') {
          const others = await db.boms.where('productId').equals(product.id).toArray();
          for (const other of others) {
            if (other.id !== bom.id && other.status === 'activo') {
              await db.boms.update(other.id, { status: 'obsoleto' });
            }
          }
        }
        for (const [i, row] of group.entries()) {
          const componentSku = pick(row, 'COMPONENTE_SKU', 'SKU_COMPONENTE', 'COMPONENTE').toUpperCase();
          const component = await db.products.where('sku').equals(componentSku).first();
          const qty = num(row, 'CANTIDAD', 'QTY', 'CONSUMO');
          if (!component) {
            result.errors.push(`${code} fila ${i + 2}: no existe el componente ${componentSku}.`);
            continue;
          }
          if (qty <= 0) {
            result.errors.push(`${code} fila ${i + 2}: la cantidad debe ser mayor que cero.`);
            continue;
          }
          const item: BomItem = {
            id: uid(),
            bomId: bom.id,
            componentId: component.id,
            qty,
            uom: component.uom,
            wastePct: num(row, 'MERMA_PCT', 'MERMA', 'WASTE_PCT'),
          };
          await db.bomItems.add(item);
        }
      } catch (error) {
        result.skipped++;
        result.errors.push(`${code}: ${error instanceof Error ? error.message : 'error desconocido'}`);
      }
    }
    await writeAudit(
      'import',
      'boms',
      `Importación de BOM: ${result.created} creadas, ${result.updated} actualizadas, ${result.skipped} omitidas`,
      user,
    );
  });
  return result;
}

/* ------------------------------------------------------------------ */
/* Ubicaciones                                                         */
/* ------------------------------------------------------------------ */

export async function importLocations(rows: ExcelRow[], user: SessionUser): Promise<ImportResult> {
  const result: ImportResult = { created: 0, updated: 0, skipped: 0, errors: [] };
  await db.transaction('rw', [db.locations, db.audit], async () => {
    for (const [index, row] of rows.entries()) {
      const line = index + 2;
      const code = pick(row, 'CODIGO', 'CODE').toUpperCase();
      const name = pick(row, 'NOMBRE', 'NAME');
      if (!code || !name) {
        result.skipped++;
        result.errors.push(`Fila ${line}: CODIGO y NOMBRE son obligatorios.`);
        continue;
      }
      const existing = await db.locations.where('code').equals(code).first();
      const now = new Date().toISOString();
      const base = {
        code,
        name,
        type: matchLocationType(pick(row, 'TIPO', 'TYPE')),
        zone: pick(row, 'ZONA', 'ZONE') || 'General',
        capacity: num(row, 'CAPACIDAD', 'CAPACITY'),
        status: (pick(row, 'ESTADO', 'STATUS').toUpperCase() === 'INACTIVA' ? 'inactiva' : 'activa') as WarehouseLocation['status'],
        notes: pick(row, 'NOTAS', 'NOTES'),
        updatedAt: now,
      };
      if (existing) {
        await db.locations.update(existing.id, base);
        result.updated++;
      } else {
        await db.locations.add({ ...base, id: uid(), createdAt: now });
        result.created++;
      }
    }
    await writeAudit(
      'import',
      'locations',
      `Importación de ubicaciones: ${result.created} creadas, ${result.updated} actualizadas, ${result.skipped} omitidas`,
      user,
    );
  });
  return result;
}

/* ------------------------------------------------------------------ */
/* Máquinas                                                            */
/* ------------------------------------------------------------------ */

export async function importMachines(rows: ExcelRow[], user: SessionUser): Promise<ImportResult> {
  const result: ImportResult = { created: 0, updated: 0, skipped: 0, errors: [] };
  await db.transaction('rw', [db.machines, db.audit], async () => {
    for (const [index, row] of rows.entries()) {
      const line = index + 2;
      const code = pick(row, 'CODIGO', 'CODE').toUpperCase();
      const name = pick(row, 'NOMBRE', 'NAME');
      if (!code || !name) {
        result.skipped++;
        result.errors.push(`Fila ${line}: CODIGO y NOMBRE son obligatorios.`);
        continue;
      }
      const existing = await db.machines.where('code').equals(code).first();
      const now = new Date().toISOString();
      const statusRaw = normalizeKey(pick(row, 'ESTADO', 'STATUS'));
      const base = {
        code,
        name,
        type: matchMachineType(pick(row, 'TIPO', 'TYPE')),
        brand: pick(row, 'MARCA', 'BRAND'),
        cavities: Math.max(1, Math.round(num(row, 'CAVIDADES', 'CAVITIES') || 1)),
        idealCycleSeconds: num(row, 'CICLO_IDEAL_SEG', 'CICLO', 'CYCLE'),
        status: (statusRaw === 'MANTENIMIENTO' ? 'mantenimiento' : statusRaw === 'INACTIVA' ? 'inactiva' : 'activa') as Machine['status'],
        notes: pick(row, 'NOTAS', 'NOTES'),
        updatedAt: now,
      };
      if (existing) {
        await db.machines.update(existing.id, base);
        result.updated++;
      } else {
        await db.machines.add({ ...base, id: uid(), createdAt: now });
        result.created++;
      }
    }
    await writeAudit(
      'import',
      'machines',
      `Importación de máquinas: ${result.created} creadas, ${result.updated} actualizadas, ${result.skipped} omitidas`,
      user,
    );
  });
  return result;
}

export const TEMPLATES = {
  products: {
    filename: 'plantilla-productos.xlsx',
    sheet: 'Productos',
    headers: ['SKU', 'NOMBRE', 'TIPO', 'UOM', 'COSTO', 'STOCK_MIN', 'STOCK_MAX', 'UBICACION', 'CODIGO_BARRAS', 'LOTE', 'CATEGORIA', 'DESCRIPCION'],
    sample: [
      {
        SKU: 'PT-BOT-500',
        NOMBRE: 'Botella PET 500 ml',
        TIPO: 'PT',
        UOM: 'UND',
        COSTO: 450,
        STOCK_MIN: 1000,
        STOCK_MAX: 50000,
        UBICACION: 'Almacén de producto terminado',
        CODIGO_BARRAS: '7701234567890',
        LOTE: 'SI',
        CATEGORIA: 'Botellas',
        DESCRIPCION: 'Botella PET 500 ml transparente',
      },
      {
        SKU: 'ME-TAPA-38',
        NOMBRE: 'Tapa rosca 38 mm',
        TIPO: 'ME',
        UOM: 'UND',
        COSTO: 35,
        STOCK_MIN: 5000,
        STOCK_MAX: 200000,
        UBICACION: 'Rack A1',
        CODIGO_BARRAS: '',
        LOTE: 'NO',
        CATEGORIA: 'Tapas',
        DESCRIPCION: '',
      },
    ],
  },
  boms: {
    filename: 'plantilla-bom.xlsx',
    sheet: 'BOM',
    headers: ['BOM_CODIGO', 'PRODUCTO_SKU', 'VERSION', 'CANTIDAD_SALIDA', 'COMPONENTE_SKU', 'CANTIDAD', 'MERMA_PCT', 'MANO_OBRA', 'ESTADO'],
    sample: [
      { BOM_CODIGO: 'BOM-BOT-500', PRODUCTO_SKU: 'PT-BOT-500', VERSION: 1, CANTIDAD_SALIDA: 1, COMPONENTE_SKU: 'ME-TAPA-38', CANTIDAD: 1, MERMA_PCT: 1, MANO_OBRA: 20, ESTADO: 'ACTIVO' },
      { BOM_CODIGO: 'BOM-BOT-500', PRODUCTO_SKU: 'PT-BOT-500', VERSION: 1, CANTIDAD_SALIDA: 1, COMPONENTE_SKU: 'ME-ETIQ-500', CANTIDAD: 1, MERMA_PCT: 2, MANO_OBRA: 0, ESTADO: 'ACTIVO' },
    ],
  },
  locations: {
    filename: 'plantilla-ubicaciones.xlsx',
    sheet: 'Ubicaciones',
    headers: ['CODIGO', 'NOMBRE', 'TIPO', 'ZONA', 'CAPACIDAD', 'ESTADO', 'NOTAS'],
    sample: [
      { CODIGO: 'RACK-B1', NOMBRE: 'Rack B1', TIPO: 'rack', ZONA: 'Almacén', CAPACIDAD: 5000, ESTADO: 'activa', NOTAS: 'Pasillo 2' },
      { CODIGO: 'CUR-02', NOMBRE: 'Curado 2', TIPO: 'curado', ZONA: 'Planta', CAPACIDAD: 0, ESTADO: 'activa', NOTAS: '' },
    ],
  },
  machines: {
    filename: 'plantilla-maquinas.xlsx',
    sheet: 'Máquinas',
    headers: ['CODIGO', 'NOMBRE', 'TIPO', 'MARCA', 'CAVIDADES', 'CICLO_IDEAL_SEG', 'ESTADO', 'NOTAS'],
    sample: [
      { CODIGO: 'INY-01', NOMBRE: 'Inyectora 1', TIPO: 'inyectora', MARCA: 'Haitian', CAVIDADES: 8, CICLO_IDEAL_SEG: 18, ESTADO: 'activa', NOTAS: '' },
      { CODIGO: 'SOP-01', NOMBRE: 'Sopladora 1', TIPO: 'sopladora', MARCA: 'Sidel', CAVIDADES: 4, CICLO_IDEAL_SEG: 12, ESTADO: 'activa', NOTAS: '' },
    ],
  },
};

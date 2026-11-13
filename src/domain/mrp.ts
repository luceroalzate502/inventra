// MRP — Planificación de requerimientos de materiales
// Cruza la demanda de órdenes de producción abiertas con las BOM activas,
// el stock disponible y el stock mínimo de cada componente.

import type { Bom, BomItem, Product, ProductionOrder } from './types';

export const MRP_OPEN_STATUSES: ProductionOrder['status'][] = ['borrador', 'liberada', 'en_proceso'];

const round = (n: number, d = 4) => Math.round(n * 10 ** d) / 10 ** d;

export interface MrpDemandLine {
  orderId: string;
  code: string;
  productName: string;
  plannedQty: number;
  required: number;
  status: ProductionOrder['status'];
  scheduledDate: string;
}

export interface MrpRow {
  componentId: string;
  sku: string;
  name: string;
  type: Product['type'];
  uom: Product['uom'];
  location: string;
  unitCost: number;
  grossRequired: number;
  stock: number;
  minStock: number;
  safetyStock: number;
  target: number;
  netRequired: number;
  estimatedCost: number;
  coverage: number;
  orders: MrpDemandLine[];
}

export interface MrpExtraDemand {
  productId: string;
  qty: number;
  code: string;
  label?: string;
}

export interface MrpPlan {
  orders: ProductionOrder[];
  rows: MrpRow[];
  missingBom: ProductionOrder[];
  missingDaily: MrpExtraDemand[];
  components: number;
  shortageCount: number;
  coveredCount: number;
  grossValue: number;
  netValue: number;
}

export interface MrpOptions {
  /** Suma el stock mínimo como colchón de seguridad al requerimiento. */
  safetyStock?: boolean;
  /** Demanda adicional del programa diario de producción (pendiente por turno). */
  extraDemand?: MrpExtraDemand[];
}

/**
 * Construye el plan MRP a partir de las órdenes de producción abiertas y,
 * opcionalmente, de la demanda pendiente del programa diario.
 * El requerimiento bruto usa la cantidad planificada y la merma del BOM.
 * El requerimiento neto descuenta el stock actual y, opcionalmente, el mínimo.
 */
export function buildMrp(
  orders: ProductionOrder[],
  boms: Bom[],
  bomItems: BomItem[],
  products: Product[],
  options: MrpOptions = {},
): MrpPlan {
  const productMap = new Map(products.map((p) => [p.id, p]));
  const openOrders = orders
    .filter((o) => MRP_OPEN_STATUSES.includes(o.status))
    .sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate));

  const rows = new Map<string, MrpRow>();
  const missingBom: ProductionOrder[] = [];
  const missingDaily: MrpExtraDemand[] = [];

  const addDemand = (item: BomItem, required: number, line: MrpDemandLine) => {
    const component = productMap.get(item.componentId);
    const current =
      rows.get(item.componentId) ??
      ({
        componentId: item.componentId,
        sku: component?.sku ?? '—',
        name: component?.name ?? 'Componente no encontrado',
        type: component?.type ?? 'MP',
        uom: component?.uom ?? item.uom,
        location: component?.location ?? '—',
        unitCost: component?.cost ?? 0,
        grossRequired: 0,
        stock: component?.stock ?? 0,
        minStock: component?.minStock ?? 0,
        safetyStock: 0,
        target: 0,
        netRequired: 0,
        estimatedCost: 0,
        coverage: 100,
        orders: [],
      } satisfies MrpRow);

    current.grossRequired = round(current.grossRequired + required);
    current.orders.push(line);
    rows.set(item.componentId, current);
  };

  for (const order of openOrders) {
    const bom =
      boms.find((b) => b.id === order.bomId) ??
      boms.find((b) => b.productId === order.productId && b.status === 'activo');
    const items = bom ? bomItems.filter((i) => i.bomId === bom.id) : [];

    if (!bom || items.length === 0) {
      missingBom.push(order);
      continue;
    }

    const finished = productMap.get(order.productId);

    for (const item of items) {
      const perUnit = item.qty * (1 + (item.wastePct || 0) / 100);
      addDemand(item, round(perUnit * order.plannedQty), {
        orderId: order.id,
        code: order.code,
        productName: finished?.name ?? 'Producto eliminado',
        plannedQty: order.plannedQty,
        required: round(perUnit * order.plannedQty),
        status: order.status,
        scheduledDate: order.scheduledDate,
      });
    }
  }

  for (const demand of options.extraDemand ?? []) {
    if (demand.qty <= 0.0001) continue;
    const bom = boms.find((b) => b.productId === demand.productId && b.status === 'activo');
    const items = bom ? bomItems.filter((i) => i.bomId === bom.id) : [];
    if (!bom || items.length === 0) {
      missingDaily.push(demand);
      continue;
    }
    const finished = productMap.get(demand.productId);
    for (const item of items) {
      const perUnit = item.qty * (1 + (item.wastePct || 0) / 100);
      addDemand(item, round(perUnit * demand.qty), {
        orderId: `daily-${demand.productId}`,
        code: demand.code,
        productName: finished?.name ?? demand.label ?? 'Programa diario',
        plannedQty: demand.qty,
        required: round(perUnit * demand.qty),
        status: 'liberada',
        scheduledDate: demand.code,
      });
    }
  }

  const list = Array.from(rows.values()).map((row) => {
    const safetyStock = options.safetyStock ? Math.max(row.minStock, 0) : 0;
    const target = round(row.grossRequired + safetyStock);
    const netRequired = round(Math.max(0, target - row.stock));
    const coverage = target > 0 ? Math.min(999, (row.stock / target) * 100) : 100;
    return {
      ...row,
      safetyStock,
      target,
      netRequired,
      estimatedCost: round(netRequired * row.unitCost, 2),
      coverage,
    };
  });

  list.sort((a, b) => {
    if (a.netRequired > 0 !== b.netRequired > 0) return a.netRequired > 0 ? -1 : 1;
    if (b.estimatedCost !== a.estimatedCost) return b.estimatedCost - a.estimatedCost;
    return a.name.localeCompare(b.name);
  });

  return {
    orders: openOrders,
    rows: list,
    missingBom,
    missingDaily,
    components: list.length,
    shortageCount: list.filter((r) => r.netRequired > 0.0001).length,
    coveredCount: list.filter((r) => r.netRequired <= 0.0001).length,
    grossValue: round(list.reduce((acc, r) => acc + r.grossRequired * r.unitCost, 0), 2),
    netValue: round(list.reduce((acc, r) => acc + r.estimatedCost, 0), 2),
  };
}

import type {
  Bom,
  BomItem,
  Consumption,
  Movement,
  PhysicalCount,
  Product,
  ProductionOrder,
  ProductType,
} from './types';
import { MOVEMENT_META, PRODUCT_TYPES, typeColor, typeLabel } from './types';
import { daysBetween } from './format';

const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

export const inventoryValue = (products: Product[]) =>
  round(products.reduce((acc, p) => acc + Math.max(p.stock, 0) * p.cost, 0));

export interface KardexRow {
  movement: Movement;
  balance: number;
  inQty: number;
  outQty: number;
}

export function buildKardex(movements: Movement[], productId: string): KardexRow[] {
  const rows = movements
    .filter((m) => m.productId === productId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  let balance = 0;
  return rows.map((m) => {
    balance = round(balance + m.direction * m.qty, 4);
    return {
      movement: m,
      balance,
      inQty: m.direction === 1 ? m.qty : 0,
      outQty: m.direction === -1 ? m.qty : 0,
    };
  });
}

export interface TypeSlice {
  type: ProductType;
  label: string;
  color: string;
  value: number;
  units: number;
  count: number;
  share: number;
}

export function valuationByType(products: Product[]): TypeSlice[] {
  const total = inventoryValue(products) || 1;
  return PRODUCT_TYPES.map((t) => {
    const list = products.filter((p) => p.type === t.value);
    const value = round(list.reduce((acc, p) => acc + Math.max(p.stock, 0) * p.cost, 0));
    return {
      type: t.value,
      label: t.label,
      color: t.color,
      value,
      units: round(list.reduce((acc, p) => acc + p.stock, 0), 2),
      count: list.length,
      share: round((value / total) * 100, 1),
    };
  }).filter((s) => s.count > 0);
}

export function valuationByCategory(products: Product[]) {
  const map = new Map<string, { value: number; count: number; units: number }>();
  for (const p of products) {
    const current = map.get(p.category) ?? { value: 0, count: 0, units: 0 };
    current.value += Math.max(p.stock, 0) * p.cost;
    current.count += 1;
    current.units += p.stock;
    map.set(p.category, current);
  }
  return Array.from(map.entries())
    .map(([category, v]) => ({ category, ...v, value: round(v.value) }))
    .sort((a, b) => b.value - a.value);
}

export interface DailyFlow {
  date: string;
  label: string;
  inValue: number;
  outValue: number;
  inQty: number;
  outQty: number;
}

export function dailyFlow(movements: Movement[], days = 7): DailyFlow[] {
  const out: DailyFlow[] = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    const dayMoves = movements.filter((m) => m.createdAt.slice(0, 10) === key);
    out.push({
      date: key,
      label: d.toLocaleDateString('es-CO', { weekday: 'short' }).replace('.', ''),
      inValue: round(
        dayMoves.filter((m) => m.direction === 1).reduce((a, m) => a + m.totalCost, 0),
      ),
      outValue: round(
        dayMoves.filter((m) => m.direction === -1).reduce((a, m) => a + m.totalCost, 0),
      ),
      inQty: round(dayMoves.filter((m) => m.direction === 1).reduce((a, m) => a + m.qty, 0), 2),
      outQty: round(dayMoves.filter((m) => m.direction === -1).reduce((a, m) => a + m.qty, 0), 2),
    });
  }
  return out;
}

export interface RotationRow {
  product: Product;
  outQty: number;
  outValue: number;
  rotation: number;
  coverageDays: number | null;
  lastMovement: string | null;
  status: 'alta' | 'media' | 'baja' | 'sin_movimiento';
}

export function rotationRows(products: Product[], movements: Movement[], days = 90): RotationRow[] {
  const since = Date.now() - days * 86400000;
  return products
    .map((product) => {
      const moves = movements.filter((m) => m.productId === product.id);
      const outs = moves.filter((m) => m.direction === -1 && new Date(m.createdAt).getTime() >= since);
      const outQty = round(outs.reduce((a, m) => a + m.qty, 0), 2);
      const outValue = round(outs.reduce((a, m) => a + m.totalCost, 0), 2);
      const avgValue = Math.max(product.stock * product.cost, 1);
      const rotation = round(outValue / avgValue, 2);
      const dailyOut = outQty / days;
      const coverageDays = dailyOut > 0 ? Math.round(product.stock / dailyOut) : null;
      const last = moves.length
        ? moves.reduce((a, m) => (m.createdAt > a ? m.createdAt : a), moves[0].createdAt)
        : null;
      const status: RotationRow['status'] =
        outQty <= 0
          ? 'sin_movimiento'
          : rotation >= 2
            ? 'alta'
            : rotation >= 0.8
              ? 'media'
              : 'baja';
      return { product, outQty, outValue, rotation, coverageDays, lastMovement: last, status };
    })
    .sort((a, b) => b.outValue - a.outValue);
}

export interface Kpis {
  inventoryValue: number;
  skuCount: number;
  lowStock: number;
  outOfStock: number;
  criticalCount: number;
  movementsToday: number;
  entriesValue30: number;
  exitsValue30: number;
  rotation: number;
  coverageDays: number | null;
  exactitud: number | null;
  productionCompliance: number | null;
  wastePct: number | null;
  deadStockCount: number;
  deadStockValue: number;
  openOrders: number;
}

export function computeKpis(input: {
  products: Product[];
  movements: Movement[];
  orders: ProductionOrder[];
  consumptions: Consumption[];
  counts: PhysicalCount[];
}): Kpis {
  const { products, movements, orders, consumptions, counts } = input;
  const active = products.filter((p) => p.status === 'activo');
  const value = inventoryValue(active);
  const now = Date.now();
  const since30 = now - 30 * 86400000;
  const todayKey = new Date().toISOString().slice(0, 10);

  const lowStock = active.filter((p) => p.stock > 0 && p.stock <= p.minStock).length;
  const outOfStock = active.filter((p) => p.stock <= 0).length;

  const entriesValue30 = round(
    movements
      .filter((m) => m.direction === 1 && new Date(m.createdAt).getTime() >= since30)
      .reduce((a, m) => a + m.totalCost, 0),
  );
  const exitsValue30 = round(
    movements
      .filter((m) => m.direction === -1 && new Date(m.createdAt).getTime() >= since30)
      .reduce((a, m) => a + m.totalCost, 0),
  );

  const rotation = value > 0 ? round((exitsValue30 * (365 / 30)) / value, 2) : 0;
  const dailyOut = exitsValue30 / 30;
  const coverageDays = dailyOut > 0 ? Math.round(value / dailyOut) : null;

  // Exactitud a partir del último conteo cerrado
  const lastCount = counts
    .filter((c) => c.status === 'cerrado')
    .sort((a, b) => (b.closedAt ?? '').localeCompare(a.closedAt ?? ''))[0];
  let exactitud: number | null = null;
  if (lastCount) {
    const totalValue = lastCount.items.reduce((a, i) => a + i.systemQty * i.unitCost, 0);
    const diffValue = lastCount.items.reduce((a, i) => a + Math.abs(i.diff) * i.unitCost, 0);
    exactitud = totalValue > 0 ? round(Math.max(0, 1 - diffValue / totalValue) * 100, 1) : 100;
  }

  const closed = orders.filter((o) => o.status === 'cerrada');
  const planned = closed.reduce((a, o) => a + o.plannedQty, 0);
  const produced = closed.reduce((a, o) => a + o.producedQty, 0);
  const productionCompliance = planned > 0 ? round((produced / planned) * 100, 1) : null;

  const waste = consumptions.reduce((a, c) => a + c.wasteQty, 0);
  const consumed = consumptions.reduce((a, c) => a + c.realQty + c.wasteQty, 0);
  const wastePct = consumed > 0 ? round((waste / consumed) * 100, 1) : null;

  const dead = rotationRows(active, movements, 60).filter(
    (r) => r.status === 'sin_movimiento' && r.product.stock > 0,
  );

  return {
    inventoryValue: value,
    skuCount: active.length,
    lowStock,
    outOfStock,
    criticalCount: lowStock + outOfStock,
    movementsToday: movements.filter((m) => m.createdAt.slice(0, 10) === todayKey).length,
    entriesValue30,
    exitsValue30,
    rotation,
    coverageDays,
    exactitud,
    productionCompliance,
    wastePct,
    deadStockCount: dead.length,
    deadStockValue: round(dead.reduce((a, r) => a + r.product.stock * r.product.cost, 0)),
    openOrders: orders.filter((o) => ['borrador', 'liberada', 'en_proceso'].includes(o.status)).length,
  };
}

export function consumptionVariance(
  orders: ProductionOrder[],
  consumptions: Consumption[],
  boms: Bom[],
  bomItems: BomItem[],
  products: Product[],
) {
  return orders
    .filter((o) => o.status === 'cerrada')
    .map((order) => {
      const bom = boms.find((b) => b.id === order.bomId);
      const items = bomItems.filter((i) => i.bomId === order.bomId);
      const real = consumptions.filter((c) => c.orderId === order.id);
      const rows = items.map((item) => {
        const product = products.find((p) => p.id === item.componentId);
        const theoretical = item.qty * order.producedQty * (1 + item.wastePct / 100);
        const realQty = real
          .filter((c) => c.productId === item.componentId)
          .reduce((a, c) => a + c.realQty + c.wasteQty, 0);
        return {
          sku: product?.sku ?? '—',
          name: product?.name ?? '—',
          uom: product?.uom ?? 'UND',
          theoretical: round(theoretical, 3),
          real: round(realQty, 3),
          variance: round(realQty - theoretical, 3),
          variancePct: theoretical > 0 ? round(((realQty - theoretical) / theoretical) * 100, 1) : 0,
        };
      });
      return { order, bom, rows };
    });
}

export interface AlertRow {
  product: Product;
  severity: 'agotado' | 'critico' | 'bajo' | 'sobrestock' | 'sin_movimiento';
  message: string;
}

export function alertsFor(products: Product[], movements: Movement[]): AlertRow[] {
  const rows: AlertRow[] = [];
  const lastMove = new Map<string, string>();
  for (const m of movements) {
    const prev = lastMove.get(m.productId);
    if (!prev || m.createdAt > prev) lastMove.set(m.productId, m.createdAt);
  }
  for (const p of products.filter((x) => x.status === 'activo')) {
    if (p.stock <= 0) {
      rows.push({ product: p, severity: 'agotado', message: 'Sin existencias' });
    } else if (p.stock <= p.minStock) {
      rows.push({
        product: p,
        severity: p.stock <= p.minStock * 0.5 ? 'critico' : 'bajo',
        message: `Bajo mínimo (${p.minStock} ${p.uom})`,
      });
    } else if (p.maxStock > 0 && p.stock > p.maxStock) {
      rows.push({ product: p, severity: 'sobrestock', message: 'Por encima del máximo' });
    }
    const last = lastMove.get(p.id);
    if (p.stock > 0 && (!last || daysBetween(last, new Date()) > 90)) {
      rows.push({ product: p, severity: 'sin_movimiento', message: 'Sin movimiento hace más de 90 días' });
    }
  }
  const order = { agotado: 0, critico: 1, bajo: 2, sobrestock: 3, sin_movimiento: 4 };
  return rows.sort((a, b) => order[a.severity] - order[b.severity]);
}

export function movementLabel(type: Movement['type']) {
  return MOVEMENT_META[type].label;
}

export { typeLabel, typeColor };

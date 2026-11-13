import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Download, FileSpreadsheet, FileText, Search } from 'lucide-react';
import { db } from '../db/schema';
import { useApp } from '../context/AppContext';
import {
  consumptionVariance,
  inventoryValue,
  rotationRows,
  valuationByCategory,
  valuationByType,
} from '../domain/reports';
import { MOVEMENT_META, typeLabel } from '../domain/types';
import type { ProductType } from '../domain/types';
import { dateTime, money, pct, qty as fmtQty } from '../domain/format';
import { exportExcel, exportPdf } from '../domain/export';
import type { PdfSpec, SheetSpec } from '../domain/export';
import {
  Badge,
  Button,
  Card,
  CardHead,
  EmptyState,
  Field,
  Input,
  PageHeader,
  SearchInput,
  Select,
  StatCard,
  Tabs,
} from '../components/ui';
import { Donut, DonutLegend, HBars } from '../components/charts';

type TabId = 'existencias' | 'valorizacion' | 'rotacion' | 'consumo' | 'produccion' | 'trazabilidad';

export function Reports() {
  const { user, settings, toast } = useApp();
  const [tab, setTab] = useState<TabId>('existencias');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [type, setType] = useState('all');
  const [search, setSearch] = useState('');

  const products = useLiveQuery(() => db.products.toArray(), []) ?? [];
  const movements = useLiveQuery(() => db.movements.toArray(), []) ?? [];
  const orders = useLiveQuery(() => db.productionOrders.toArray(), []) ?? [];
  const consumptions = useLiveQuery(() => db.consumptions.toArray(), []) ?? [];
  const boms = useLiveQuery(() => db.boms.toArray(), []) ?? [];
  const bomItems = useLiveQuery(() => db.bomItems.toArray(), []) ?? [];

  const inRange = (iso: string) =>
    (!from || iso.slice(0, 10) >= from) && (!to || iso.slice(0, 10) <= to);

  const term = search.trim().toLowerCase();

  const stockRows = useMemo(
    () =>
      products
        .filter((p) => (type === 'all' ? true : p.type === type))
        .filter(
          (p) =>
            !term ||
            p.name.toLowerCase().includes(term) ||
            p.sku.toLowerCase().includes(term) ||
            p.category.toLowerCase().includes(term),
        )
        .sort((a, b) => b.stock * b.cost - a.stock * a.cost),
    [products, type, term],
  );

  const slices = useMemo(() => valuationByType(products), [products]);
  const categories = useMemo(() => valuationByCategory(products), [products]);
  const rotation = useMemo(() => rotationRows(products, movements, 90), [products, movements]);

  const consumptionRows = useMemo(() => {
    const map = new Map<string, { productId: string; real: number; waste: number; cost: number; orders: number }>();
    for (const c of consumptions) {
      if (!inRange(c.createdAt)) continue;
      const prev = map.get(c.productId) ?? { productId: c.productId, real: 0, waste: 0, cost: 0, orders: 0 };
      prev.real += c.realQty;
      prev.waste += c.wasteQty;
      prev.cost += c.totalCost;
      prev.orders += 1;
      map.set(c.productId, prev);
    }
    return Array.from(map.values())
      .map((r) => {
        const p = products.find((x) => x.id === r.productId);
        return { ...r, product: p };
      })
      .filter((r) => (type === 'all' ? true : r.product?.type === type))
      .sort((a, b) => b.cost - a.cost);
  }, [consumptions, products, from, to, type]);

  const variance = useMemo(
    () => consumptionVariance(orders, consumptions, boms, bomItems, products),
    [orders, consumptions, boms, bomItems, products],
  );

  const traceRows = useMemo(() => {
    if (!term) return [];
    const matchingOrders = orders.filter((o) => o.code.toLowerCase().includes(term));
    const orderIds = new Set(matchingOrders.map((o) => o.id));
    return movements
      .filter(
        (m) =>
          (m.lotCode ?? '').toLowerCase().includes(term) ||
          (m.refDoc ?? '').toLowerCase().includes(term) ||
          (m.orderId ? orderIds.has(m.orderId) : false) ||
          m.productSku.toLowerCase().includes(term),
      )
      .filter((m) => inRange(m.createdAt))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 200);
  }, [term, movements, orders, from, to]);

  const totalValue = inventoryValue(stockRows);
  const totalUnits = stockRows.reduce((a, p) => a + p.stock, 0);

  const buildExport = (): { excel: SheetSpec[]; pdf: PdfSpec } => {
    const company = settings?.companyName ?? 'INVENTRA';
    if (tab === 'existencias') {
      return {
        excel: [
          {
            name: 'Existencias',
            rows: stockRows.map((p) => ({
              SKU: p.sku,
              Producto: p.name,
              Tipo: typeLabel(p.type),
              Categoría: p.category,
              Stock: p.stock,
              UOM: p.uom,
              'Costo unitario': p.cost,
              'Valor total': Math.round(p.stock * p.cost),
              Ubicación: p.location,
            })),
          },
        ],
        pdf: {
          filename: 'reporte-existencias',
          title: 'Reporte de existencias',
          subtitle: `${stockRows.length} referencias · ${money(totalValue)}`,
          company,
          user: user?.name,
          landscape: true,
          columns: ['SKU', 'Producto', 'Tipo', 'Stock', 'Costo', 'Valor', 'Ubicación'],
          rows: stockRows.map((p) => [
            p.sku,
            p.name,
            typeLabel(p.type),
            `${fmtQty(p.stock)} ${p.uom}`,
            money(p.cost),
            money(p.stock * p.cost),
            p.location,
          ]),
          totals: [`Valor total: ${money(totalValue)}`],
        },
      };
    }
    if (tab === 'valorizacion') {
      return {
        excel: [
          {
            name: 'Valorización',
            rows: categories.map((c) => ({
              Categoría: c.category,
              Referencias: c.count,
              Unidades: c.units,
              'Valor COP': Math.round(c.value),
              'Participación %': Math.round((c.value / (totalValue || 1)) * 1000) / 10,
            })),
          },
        ],
        pdf: {
          filename: 'reporte-valorizacion',
          title: 'Valorización del inventario',
          subtitle: `Valor total ${money(totalValue)}`,
          company,
          user: user?.name,
          columns: ['Categoría', 'Referencias', 'Unidades', 'Valor COP', 'Participación'],
          rows: categories.map((c) => [
            c.category,
            String(c.count),
            fmtQty(c.units),
            money(c.value),
            pct((c.value / (totalValue || 1)) * 100),
          ]),
          totals: [`Valor total del inventario: ${money(totalValue)}`],
        },
      };
    }
    if (tab === 'rotacion') {
      return {
        excel: [
          {
            name: 'Rotación',
            rows: rotation.map((r) => ({
              SKU: r.product.sku,
              Producto: r.product.name,
              'Salidas 90d': r.outQty,
              'Valor salidas': Math.round(r.outValue),
              Rotación: r.rotation,
              'Cobertura días': r.coverageDays ?? '',
              'Último movimiento': r.lastMovement ? dateTime(r.lastMovement) : 'Sin movimiento',
              Clasificación: r.status,
            })),
          },
        ],
        pdf: {
          filename: 'reporte-rotacion',
          title: 'Rotación de inventarios (90 días)',
          subtitle: 'Clasificación por valor despachado vs. inventario promedio',
          company,
          user: user?.name,
          landscape: true,
          columns: ['SKU', 'Producto', 'Salidas', 'Valor', 'Rotación', 'Cobertura', 'Clasificación'],
          rows: rotation.map((r) => [
            r.product.sku,
            r.product.name,
            fmtQty(r.outQty),
            money(r.outValue),
            `${r.rotation.toFixed(2)}x`,
            r.coverageDays ? `${r.coverageDays} días` : '—',
            r.status,
          ]),
        },
      };
    }
    if (tab === 'consumo') {
      return {
        excel: [
          {
            name: 'Consumo',
            rows: consumptionRows.map((r) => ({
              SKU: r.product?.sku ?? '',
              Producto: r.product?.name ?? '',
              'Consumo real': r.real,
              Merma: r.waste,
              'Costo total': Math.round(r.cost),
              Registros: r.orders,
            })),
          },
        ],
        pdf: {
          filename: 'reporte-consumo',
          title: 'Consumo de materias primas',
          subtitle: from || to ? `Periodo ${from || 'inicio'} a ${to || 'hoy'}` : 'Todo el historial',
          company,
          user: user?.name,
          columns: ['SKU', 'Producto', 'Consumo', 'Merma', 'Costo'],
          rows: consumptionRows.map((r) => [
            r.product?.sku ?? '',
            r.product?.name ?? '',
            `${fmtQty(r.real)} ${r.product?.uom ?? ''}`,
            fmtQty(r.waste),
            money(r.cost),
          ]),
        },
      };
    }
    if (tab === 'produccion') {
      return {
        excel: [
          {
            name: 'Producción',
            rows: variance.map((v) => ({
              Orden: v.order.code,
              Producto: products.find((p) => p.id === v.order.productId)?.name ?? '',
              Programado: v.order.plannedQty,
              Producido: v.order.producedQty,
              Rechazado: v.order.rejectedQty,
              'Costo total': Math.round(v.order.totalCost),
              'Cumplimiento %': Math.round((v.order.producedQty / v.order.plannedQty) * 1000) / 10,
            })),
          },
        ],
        pdf: {
          filename: 'reporte-produccion',
          title: 'Producción terminada',
          subtitle: `${variance.length} órdenes cerradas`,
          company,
          user: user?.name,
          landscape: true,
          columns: ['Orden', 'Producto', 'Programado', 'Producido', 'Rechazado', 'Costo', 'Cumplimiento'],
          rows: variance.map((v) => [
            v.order.code,
            products.find((p) => p.id === v.order.productId)?.name ?? '',
            fmtQty(v.order.plannedQty),
            fmtQty(v.order.producedQty),
            fmtQty(v.order.rejectedQty),
            money(v.order.totalCost),
            pct((v.order.producedQty / v.order.plannedQty) * 100),
          ]),
        },
      };
    }
    return {
      excel: [
        {
          name: 'Trazabilidad',
          rows: traceRows.map((m) => ({
            Código: m.code,
            Fecha: dateTime(m.createdAt),
            Producto: m.productName,
            SKU: m.productSku,
            Tipo: MOVEMENT_META[m.type].label,
            Cantidad: m.qty,
            Lote: m.lotCode ?? '',
            Documento: m.refDoc ?? '',
            Orden: m.orderId ?? '',
          })),
        },
      ],
      pdf: {
        filename: 'reporte-trazabilidad',
        title: `Trazabilidad: ${search}`,
        subtitle: `${traceRows.length} movimientos relacionados`,
        company,
        user: user?.name,
        landscape: true,
        columns: ['Código', 'Fecha', 'Producto', 'Tipo', 'Cantidad', 'Lote', 'Documento'],
        rows: traceRows.map((m) => [
          m.code,
          dateTime(m.createdAt),
          m.productSku,
          MOVEMENT_META[m.type].label,
          fmtQty(m.qty),
          m.lotCode ?? '',
          m.refDoc ?? '',
        ]),
      },
    };
  };

  const doExport = (kind: 'excel' | 'pdf') => {
    const { excel, pdf } = buildExport();
    if (kind === 'excel') {
      exportExcel(pdf.filename, excel);
      toast('Excel generado', 'success');
    } else {
      exportPdf(pdf);
      toast('PDF generado', 'success');
    }
  };

  return (
    <>
      <PageHeader
        title="Reportes"
        subtitle="Análisis de inventario, producción y trazabilidad"
        actions={
          <>
            <Button variant="secondary" size="sm" icon={<FileSpreadsheet size={15} />} onClick={() => doExport('excel')}>
              Excel
            </Button>
            <Button variant="secondary" size="sm" icon={<FileText size={15} />} onClick={() => doExport('pdf')}>
              PDF
            </Button>
          </>
        }
      />

      <Card className="mb-16">
        <div className="card-pad" style={{ display: 'grid', gap: 12 }}>
          <Tabs
            active={tab}
            onChange={(t) => setTab(t as TabId)}
            tabs={[
              { id: 'existencias', label: 'Existencias' },
              { id: 'valorizacion', label: 'Valorización' },
              { id: 'rotacion', label: 'Rotación' },
              { id: 'consumo', label: 'Consumo MP' },
              { id: 'produccion', label: 'Producción' },
              { id: 'trazabilidad', label: 'Trazabilidad' },
            ]}
          />
          <div className="row wrap" style={{ gap: 10 }}>
            <SearchInput value={search} onChange={setSearch} placeholder="Buscar producto, SKU, lote, orden o documento…" />
            <Select value={type} onChange={(e) => setType(e.target.value)} style={{ width: 190 }}>
              <option value="all">Todos los tipos</option>
              {['MP', 'ME', 'IN', 'PP', 'PT', 'RE'].map((t) => (
                <option key={t} value={t}>
                  {typeLabel(t as ProductType)}
                </option>
              ))}
            </Select>
            <div className="row" style={{ gap: 6 }}>
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={{ width: 145 }} />
              <span className="small muted">a</span>
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={{ width: 145 }} />
            </div>
          </div>
        </div>
      </Card>

      {tab === 'existencias' && (
        <>
          <div className="kpi-grid">
            <StatCard label="Valor total" value={money(totalValue)} icon={<Download size={18} />} tone="brand" />
            <StatCard label="Referencias" value={stockRows.length} icon={<FileSpreadsheet size={18} />} tone="info" />
            <StatCard label="Unidades" value={fmtQty(totalUnits)} icon={<FileText size={18} />} tone="muted" />
            <StatCard
              label="Bajo mínimo"
              value={stockRows.filter((p) => p.stock <= p.minStock).length}
              icon={<Download size={18} />}
              tone="warn"
            />
          </div>
          <Card>
            <CardHead title="Existencias actuales" subtitle="Saldo y valorización por referencia" />
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>SKU</th>
                    <th>Producto</th>
                    <th>Tipo</th>
                    <th className="num">Stock</th>
                    <th className="num">Costo</th>
                    <th className="num">Valor</th>
                    <th>Ubicación</th>
                  </tr>
                </thead>
                <tbody>
                  {stockRows.map((p) => (
                    <tr key={p.id}>
                      <td className="mono small">{p.sku}</td>
                      <td className="strong">{p.name}</td>
                      <td className="small muted">{typeLabel(p.type)}</td>
                      <td className="num">
                        {fmtQty(p.stock)} {p.uom}
                      </td>
                      <td className="num">{money(p.cost)}</td>
                      <td className="num bold">{money(p.stock * p.cost)}</td>
                      <td className="small muted">{p.location}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="table-foot">
              <span>{stockRows.length} referencias</span>
              <span className="bold ink" style={{ marginLeft: 'auto' }}>
                {money(totalValue)}
              </span>
            </div>
          </Card>
        </>
      )}

      {tab === 'valorizacion' && (
        <div className="grid grid-2">
          <Card>
            <CardHead title="Distribución por tipo" subtitle="Valorizado en COP" />
            <div className="card-pad">
              <Donut
                data={slices.map((s) => ({ label: s.label, value: s.value, color: s.color }))}
                centerValue={money(totalValue)}
                centerLabel="valor total"
                size={190}
              />
              <DonutLegend data={slices} />
            </div>
          </Card>
          <Card>
            <CardHead title="Valor por categoría" subtitle="Participación sobre el total" />
            <div className="card-pad">
              <HBars
                rows={categories.slice(0, 8).map((c) => ({
                  label: c.category,
                  value: c.value,
                  extra: `${c.count} referencias · ${pct((c.value / (totalValue || 1)) * 100)}`,
                }))}
              />
            </div>
          </Card>
          <div style={{ gridColumn: '1 / -1' }}>
            <Card>
              <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Categoría</th>
                    <th className="num">Referencias</th>
                    <th className="num">Unidades</th>
                    <th className="num">Valor</th>
                    <th className="num">Participación</th>
                  </tr>
                </thead>
                <tbody>
                  {categories.map((c) => (
                    <tr key={c.category}>
                      <td className="strong">{c.category}</td>
                      <td className="num">{c.count}</td>
                      <td className="num">{fmtQty(c.units)}</td>
                      <td className="num bold">{money(c.value)}</td>
                      <td className="num">{pct((c.value / (totalValue || 1)) * 100)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </Card>
          </div>
        </div>
      )}

      {tab === 'rotacion' && (
        <Card>
          <CardHead title="Rotación de inventarios" subtitle="Últimos 90 días · clasificación por movimiento" />
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Producto</th>
                  <th className="num">Salidas</th>
                  <th className="num">Valor salidas</th>
                  <th className="num">Rotación</th>
                  <th className="num">Cobertura</th>
                  <th>Último movimiento</th>
                  <th>Clasificación</th>
                </tr>
              </thead>
              <tbody>
                {rotation.map((r) => (
                  <tr key={r.product.id}>
                    <td>
                      <div className="cell-main">
                        <span className="name">{r.product.name}</span>
                        <span className="sku">{r.product.sku}</span>
                      </div>
                    </td>
                    <td className="num">{fmtQty(r.outQty)}</td>
                    <td className="num">{money(r.outValue)}</td>
                    <td className="num">{r.rotation.toFixed(2)}x</td>
                    <td className="num">{r.coverageDays ?? '—'} d</td>
                    <td className="small muted">
                      {r.lastMovement ? dateTime(r.lastMovement) : 'Sin movimientos'}
                    </td>
                    <td>
                      <Badge
                        tone={
                          r.status === 'alta'
                            ? 'ok'
                            : r.status === 'media'
                              ? 'info'
                              : r.status === 'baja'
                                ? 'warn'
                                : 'danger'
                        }
                      >
                        {r.status.replace('_', ' ')}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {tab === 'consumo' && (
        <Card>
          <CardHead title="Consumo de materias primas" subtitle="Registros de consumo de producción" />
          {consumptionRows.length === 0 ? (
            <EmptyState icon={<Search size={22} />} title="Sin consumos en el periodo" />
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Producto</th>
                    <th className="num">Consumo real</th>
                    <th className="num">Merma</th>
                    <th className="num">% merma</th>
                    <th className="num">Costo</th>
                    <th className="num">Registros</th>
                  </tr>
                </thead>
                <tbody>
                  {consumptionRows.map((r) => (
                    <tr key={r.productId}>
                      <td>
                        <div className="cell-main">
                          <span className="name">{r.product?.name}</span>
                          <span className="sku">{r.product?.sku}</span>
                        </div>
                      </td>
                      <td className="num">
                        {fmtQty(r.real)} {r.product?.uom}
                      </td>
                      <td className="num">{fmtQty(r.waste)}</td>
                      <td className="num">
                        {pct(r.real + r.waste > 0 ? (r.waste / (r.real + r.waste)) * 100 : 0)}
                      </td>
                      <td className="num bold">{money(r.cost)}</td>
                      <td className="num">{r.orders}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {tab === 'produccion' && (
        <div style={{ display: 'grid', gap: 16 }}>
          <Card>
            <CardHead title="Órdenes cerradas" subtitle="Cumplimiento y costo real" />
            {variance.length === 0 ? (
              <EmptyState icon={<FileText size={22} />} title="Sin órdenes cerradas" />
            ) : (
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Orden</th>
                      <th>Producto</th>
                      <th className="num">Programado</th>
                      <th className="num">Producido</th>
                      <th className="num">Rechazado</th>
                      <th className="num">Cumplimiento</th>
                      <th className="num">Costo total</th>
                      <th className="num">Costo unitario</th>
                    </tr>
                  </thead>
                  <tbody>
                    {variance.map((v) => (
                      <tr key={v.order.id}>
                        <td className="mono strong">{v.order.code}</td>
                        <td className="small">{products.find((p) => p.id === v.order.productId)?.name}</td>
                        <td className="num">{fmtQty(v.order.plannedQty)}</td>
                        <td className="num">{fmtQty(v.order.producedQty)}</td>
                        <td className="num">{fmtQty(v.order.rejectedQty)}</td>
                        <td className="num">
                          <Badge tone={v.order.producedQty >= v.order.plannedQty ? 'ok' : 'warn'}>
                            {pct((v.order.producedQty / v.order.plannedQty) * 100)}
                          </Badge>
                        </td>
                        <td className="num">{money(v.order.totalCost)}</td>
                        <td className="num">
                          {money(v.order.producedQty > 0 ? v.order.totalCost / v.order.producedQty : 0)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {variance.slice(0, 3).map((v) => (
            <Card key={v.order.id}>
              <CardHead
                title={`Consumo real vs. teórico · ${v.order.code}`}
                subtitle={products.find((p) => p.id === v.order.productId)?.name}
              />
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Componente</th>
                      <th className="num">Teórico</th>
                      <th className="num">Real</th>
                      <th className="num">Variación</th>
                      <th className="num">%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {v.rows.map((r) => (
                      <tr key={r.sku}>
                        <td className="small">
                          <strong>{r.sku}</strong> · {r.name}
                        </td>
                        <td className="num">
                          {fmtQty(r.theoretical)} {r.uom}
                        </td>
                        <td className="num">
                          {fmtQty(r.real)} {r.uom}
                        </td>
                        <td className="num" style={{ color: Math.abs(r.variancePct) > 5 ? 'var(--warn)' : 'var(--ink-2)' }}>
                          {r.variance > 0 ? '+' : ''}
                          {fmtQty(r.variance)}
                        </td>
                        <td className="num">{pct(r.variancePct)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          ))}
        </div>
      )}

      {tab === 'trazabilidad' && (
        <Card>
          <CardHead
            title="Trazabilidad por lote u orden"
            subtitle="Escriba un código de lote, orden, documento o SKU"
          />
          <div className="card-pad" style={{ display: 'grid', gap: 12 }}>
            <Field label="Término de búsqueda">
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="L-2026-045 · OP-0001 · REM-8821 · MP-AC-001"
              />
            </Field>
            {!term ? (
              <EmptyState icon={<Search size={22} />} title="Busque para trazar" message="Los resultados muestran todos los movimientos asociados." />
            ) : traceRows.length === 0 ? (
              <EmptyState icon={<Search size={22} />} title="Sin coincidencias" />
            ) : (
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Código</th>
                      <th>Fecha</th>
                      <th>Producto</th>
                      <th>Movimiento</th>
                      <th className="num">Cantidad</th>
                      <th>Lote</th>
                      <th>Documento</th>
                      <th>Responsable</th>
                    </tr>
                  </thead>
                  <tbody>
                    {traceRows.map((m) => (
                      <tr key={m.id}>
                        <td className="mono small">{m.code}</td>
                        <td className="small nowrap">{dateTime(m.createdAt)}</td>
                        <td className="small">
                          <strong>{m.productSku}</strong> · {m.productName}
                        </td>
                        <td>
                          <Badge tone={m.direction === 1 ? 'ok' : 'danger'}>
                            {MOVEMENT_META[m.type].label}
                          </Badge>
                        </td>
                        <td className="num">{fmtQty(m.qty)}</td>
                        <td className="mono small">{m.lotCode ?? '—'}</td>
                        <td className="mono small">{m.refDoc ?? '—'}</td>
                        <td className="small muted">{m.userName}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </Card>
      )}
    </>
  );
}

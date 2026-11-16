import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowRight,
  ArrowUpFromLine,
  Boxes,
  CircleDollarSign,
  Factory,
  Package,
  PackageX,
} from 'lucide-react';
import { db } from '../db/schema';
import { useApp } from '../context/AppContext';
import { alertsFor, computeKpis, dailyFlow, valuationByType } from '../domain/reports';
import { money, moneyCompact, pct, qty as fmtQty, timeShort, dateLong } from '../domain/format';
import { summarize, todayKey } from '../domain/productionDaily';
import { pncSummary } from '../domain/pnc';
import { MOVEMENT_META } from '../domain/types';
import { Button, Card, CardHead, EmptyState, PageHeader, StatCard } from '../components/ui';
import { Donut, DonutLegend, FlowBars } from '../components/charts';

export function Dashboard() {
  const { user, settings } = useApp();
  const navigate = useNavigate();

  const products = useLiveQuery(() => db.products.toArray(), []);
  const movements = useLiveQuery(() => db.movements.toArray(), []);
  const orders = useLiveQuery(() => db.productionOrders.toArray(), []);
  const consumptions = useLiveQuery(() => db.consumptions.toArray(), []);
  const counts = useLiveQuery(() => db.counts.toArray(), []);
  const productionRecords = useLiveQuery(() => db.productionRecords.toArray(), []);
  const pncs = useLiveQuery(() => db.pnc.toArray(), []);

  const loading =
    !products || !movements || !orders || !consumptions || !counts || !productionRecords || !pncs;

  const data = useMemo(() => {
    if (loading) return null;
    const kpis = computeKpis({ products, movements, orders, consumptions, counts });
    const slices = valuationByType(products);
    const flow = dailyFlow(movements, 7);
    const alerts = alertsFor(products, movements);
    const todayRecords = productionRecords.filter((r) => r.date === todayKey());
    const plant = summarize(todayRecords);
    const pnc = pncSummary(pncs);
    return { kpis, slices, flow, alerts, plant, pnc };
  }, [loading, products, movements, orders, consumptions, counts, productionRecords, pncs]);

  if (loading || !data) {
    return (
      <div className="grid" style={{ gap: 16 }}>
        <div className="skeleton" style={{ height: 60 }} />
        <div className="kpi-grid">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="skeleton" style={{ height: 110 }} />
          ))}
        </div>
        <div className="skeleton" style={{ height: 260 }} />
      </div>
    );
  }

  const { kpis, slices, flow, alerts, plant, pnc } = data;
  const recent = movements.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 6);
  const critical = alerts.filter((a) => ['agotado', 'critico', 'bajo'].includes(a.severity)).slice(0, 5);
  const activeProducts = products.filter((p) => p.status === 'activo');

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Buenos días' : hour < 19 ? 'Buenas tardes' : 'Buenas noches';

  return (
    <>
      <PageHeader
        title={`${greeting}, ${user?.name.split(' ')[0] ?? ''}`}
        subtitle={`${dateLong(new Date().toISOString())} · ${settings?.companyName ?? ''}`}
        actions={
          <>
            <Button variant="secondary" icon={<ArrowDownToLine size={16} />} onClick={() => navigate('/entradas/nueva')}>
              Entrada
            </Button>
            <Button variant="primary" icon={<ArrowUpFromLine size={16} />} onClick={() => navigate('/salidas/nueva')}>
              Salida
            </Button>
          </>
        }
      />

      <div className="kpi-grid">
        <StatCard
          label="Inventario valorizado"
          value={money(kpis.inventoryValue)}
          icon={<CircleDollarSign size={18} />}
          tone="brand"
          foot={<span>{activeProducts.length} SKU activos</span>}
        />
        <StatCard
          label="Alertas de inventario"
          value={kpis.criticalCount}
          icon={<AlertTriangle size={18} />}
          tone={kpis.criticalCount > 0 ? 'warn' : 'ok'}
          foot={
            <span>
              {kpis.outOfStock} agotados · {kpis.lowStock} bajo mínimo
            </span>
          }
        />
        <StatCard
          label="Movimientos hoy"
          value={kpis.movementsToday}
          icon={<Boxes size={18} />}
          tone="info"
          foot={<span>Entradas {moneyCompact(kpis.entriesValue30)} · 30 días</span>}
        />
        <StatCard
          label="Órdenes en curso"
          value={kpis.openOrders}
          icon={<Factory size={18} />}
          tone="muted"
          foot={<span>{orders.filter((o) => o.status === 'en_proceso').length} en proceso</span>}
        />
      </div>

      {critical.length > 0 && (
        <div
          className="card"
          style={{
            display: 'flex',
            gap: 12,
            alignItems: 'center',
            padding: '12px 16px',
            marginBottom: 16,
            borderLeft: '4px solid var(--warn)',
            background: 'linear-gradient(90deg, var(--warn-soft), var(--surface) 55%)',
            flexWrap: 'wrap',
          }}
        >
          <AlertTriangle size={18} color="var(--warn)" />
          <div style={{ flex: 1, minWidth: 200 }}>
            <div className="bold" style={{ fontSize: 13 }}>
              {critical.length} producto(s) requieren reposición
            </div>
            <div className="small muted">
              {critical.map((a) => a.product.sku).slice(0, 4).join(' · ')}
              {critical.length > 4 ? ' …' : ''}
            </div>
          </div>
          <Button size="sm" variant="secondary" onClick={() => navigate('/alertas')}>
            Ver alertas <ArrowRight size={14} />
          </Button>
        </div>
      )}

      {(plant.records > 0 || pnc.open > 0) && (
        <Card className="mb-16">
          <CardHead
            title="Planta hoy"
            subtitle={`${plant.records} registro(s) de turno · OEE, scrap y no conformidades`}
            actions={
              <Link to="/indicadores" className="small" style={{ color: 'var(--brand-3)', fontWeight: 600 }}>
                Ver indicadores
              </Link>
            }
          />
          <div className="card-pad grid grid-4" style={{ gap: 18 }}>
            <div>
              <div className="meta-label">OEE del día</div>
              <div
                className="bold"
                style={{
                  fontSize: 24,
                  color: plant.oee >= 70 ? 'var(--ok)' : plant.oee >= 50 ? 'var(--warn)' : 'var(--danger)',
                }}
              >
                {pct(plant.oee)}
              </div>
              <div className="small faint">
                A {pct(plant.availability)} · R {pct(plant.performance)} · C {pct(plant.quality)}
              </div>
            </div>
            <div>
              <div className="meta-label">Producción conforme</div>
              <div className="bold" style={{ fontSize: 24 }}>
                {fmtQty(plant.good)}
              </div>
              <div className="small faint">
                {fmtQty(plant.planned)} programadas · {pct(plant.compliance)}
              </div>
            </div>
            <div>
              <div className="meta-label">Índice de scrap</div>
              <div
                className="bold"
                style={{
                  fontSize: 24,
                  color: plant.scrapPct <= 3 ? 'var(--ok)' : plant.scrapPct <= 6 ? 'var(--warn)' : 'var(--danger)',
                }}
              >
                {pct(plant.scrapPct)}
              </div>
              <div className="small faint">{fmtQty(plant.scrap)} piezas no conformes</div>
            </div>
            <div>
              <div className="meta-label">PNC abiertos</div>
              <div className="bold" style={{ fontSize: 24, color: pnc.open > 0 ? 'var(--warn)' : 'var(--ok)' }}>
                {pnc.open}
              </div>
              <div className="small faint">
                {pnc.blocked} lote(s) bloqueado(s) · {money(pnc.cost)}
              </div>
            </div>
          </div>
        </Card>
      )}

      <div className="grid grid-2" style={{ marginBottom: 16 }}>
        <Card>
          <CardHead
            title="Existencias por tipo de inventario"
            subtitle="Distribución valorizada en COP"
            actions={
              <Link to="/reportes" className="small" style={{ color: 'var(--brand-3)', fontWeight: 600 }}>
                Ver reporte
              </Link>
            }
          />
          <div className="card-pad">
            <Donut
              data={slices.map((s) => ({ label: s.label, value: s.value, color: s.color }))}
              centerValue={moneyCompact(kpis.inventoryValue)}
              centerLabel="valor total"
            />
            <DonutLegend data={slices} />
          </div>
        </Card>

        <Card>
          <CardHead title="Entradas vs. salidas" subtitle="Últimos 7 días · valor en COP" />
          <div className="card-pad">
            <FlowBars data={flow} />
            <div className="row-between mt-16" style={{ borderTop: '1px solid var(--line)', paddingTop: 12 }}>
              <div>
                <div className="meta-label">Salidas 30 días</div>
                <div className="bold" style={{ fontSize: 15 }}>
                  {money(kpis.exitsValue30)}
                </div>
              </div>
              <div className="right">
                <div className="meta-label">Rotación anualizada</div>
                <div className="bold" style={{ fontSize: 15 }}>
                  {kpis.rotation.toFixed(2).replace('.', ',')}x
                </div>
              </div>
              <div className="right">
                <div className="meta-label">Cobertura</div>
                <div className="bold" style={{ fontSize: 15 }}>
                  {kpis.coverageDays ?? '—'} días
                </div>
              </div>
            </div>
          </div>
        </Card>
      </div>

      <div className="grid grid-2" style={{ marginBottom: 16 }}>
        <Card>
          <CardHead
            title="Alertas de inventario"
            subtitle="Productos que requieren atención"
            actions={
              <Link to="/alertas" className="small" style={{ color: 'var(--brand-3)', fontWeight: 600 }}>
                Todas
              </Link>
            }
          />
          {critical.length === 0 ? (
            <EmptyState icon={<Package size={22} />} title="Sin alertas críticas" message="Todos los productos están por encima del mínimo." />
          ) : (
            <div className="list">
              {critical.map((a) => (
                <Link to={`/productos/${a.product.id}`} key={`${a.product.id}-${a.severity}`} className="list-item">
                  <div
                    className="list-icon"
                    style={{
                      background: a.severity === 'agotado' ? 'var(--danger-soft)' : 'var(--warn-soft)',
                      color: a.severity === 'agotado' ? 'var(--danger)' : 'var(--warn)',
                    }}
                  >
                    {a.product.stock <= 0 ? <PackageX size={16} /> : <AlertTriangle size={16} />}
                  </div>
                  <div className="list-main">
                    <div className="list-title">{a.product.name}</div>
                    <div className="list-sub">
                      {a.product.sku} · {a.message}
                    </div>
                  </div>
                  <div className="list-value">
                    {fmtQty(a.product.stock)} {a.product.uom}
                    <div className="small faint" style={{ fontWeight: 400 }}>
                      mín. {fmtQty(a.product.minStock)}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </Card>

        <Card>
          <CardHead
            title="Movimientos recientes"
            subtitle="Últimas transacciones registradas"
            actions={
              <Link to="/movimientos" className="small" style={{ color: 'var(--brand-3)', fontWeight: 600 }}>
                Kardex
              </Link>
            }
          />
          {recent.length === 0 ? (
            <EmptyState
              icon={<Boxes size={22} />}
              title="Sin movimientos"
              message="Registre una entrada o salida para ver la actividad reciente."
            />
          ) : (
          <div className="list">
            {recent.map((m) => {
              const meta = MOVEMENT_META[m.type];
              return (
                <Link to={`/kardex/${m.productId}`} key={m.id} className="list-item">
                  <div
                    className="list-icon"
                    style={{
                      background: m.direction === 1 ? 'var(--ok-soft)' : 'var(--danger-soft)',
                      color: m.direction === 1 ? 'var(--ok)' : 'var(--danger)',
                    }}
                  >
                    {m.direction === 1 ? <ArrowDownToLine size={16} /> : <ArrowUpFromLine size={16} />}
                  </div>
                  <div className="list-main">
                    <div className="list-title">{m.productName}</div>
                    <div className="list-sub">
                      {meta.label} · {m.reason} · {timeShort(m.createdAt)}
                    </div>
                  </div>
                  <div className="list-value" style={{ color: m.direction === 1 ? 'var(--ok)' : 'var(--danger)' }}>
                    {m.direction === 1 ? '+' : '−'}
                    {fmtQty(m.qty)}
                    <div className="small faint" style={{ fontWeight: 400 }}>
                      {money(m.totalCost)}
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
          )}
        </Card>
      </div>

      <div className="small faint center" style={{ marginTop: 22 }}>
        Datos calculados en tiempo real desde {movements.length} movimientos ·{' '}
        {products.length} productos · {orders.length} órdenes de producción
      </div>
    </>
  );
}

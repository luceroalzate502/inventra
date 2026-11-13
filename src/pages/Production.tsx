import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowRight, CheckCircle2, Clock, Factory, Plus, PlayCircle, XCircle } from 'lucide-react';
import { db } from '../db/schema';
import { useApp } from '../context/AppContext';
import { can } from '../domain/permissions';
import { ORDER_STATUS } from '../domain/types';
import { dateLong, money, qty as fmtQty } from '../domain/format';
import { computeKpis } from '../domain/reports';
import { Badge, Button, Card, EmptyRow, PageHeader, Progress, StatCard, Tabs } from '../components/ui';

export function Production() {
  const navigate = useNavigate();
  const { user } = useApp();
  const [tab, setTab] = useState('open');

  const orders = useLiveQuery(() => db.productionOrders.toArray(), []);
  const products = useLiveQuery(() => db.products.toArray(), []);
  const movements = useLiveQuery(() => db.movements.toArray(), []);
  const consumptions = useLiveQuery(() => db.consumptions.toArray(), []);
  const counts = useLiveQuery(() => db.counts.toArray(), []);

  const filtered = useMemo(() => {
    if (!orders) return [];
    const list =
      tab === 'open'
        ? orders.filter((o) => ['borrador', 'liberada', 'en_proceso'].includes(o.status))
        : tab === 'all'
          ? orders
          : orders.filter((o) => o.status === tab);
    return list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [orders, tab]);

  const kpis = useMemo(() => {
    if (!orders || !products || !movements || !consumptions || !counts) return null;
    return computeKpis({ products, movements, orders, consumptions, counts });
  }, [orders, products, movements, consumptions, counts]);

  const canManage = user ? can(user.role, 'production.manage') : false;
  const openOrders = (orders ?? []).filter((o) => ['borrador', 'liberada', 'en_proceso'].includes(o.status));
  const inProcess = openOrders.filter((o) => o.status === 'en_proceso').length;
  const closed = (orders ?? []).filter((o) => o.status === 'cerrada');

  return (
    <>
      <PageHeader
        title="Producción"
        subtitle={`${openOrders.length} órdenes abiertas · ${closed.length} cerradas`}
        actions={
          canManage ? (
            <Button variant="primary" icon={<Plus size={16} />} onClick={() => navigate('/produccion/nueva')}>
              Nueva orden
            </Button>
          ) : undefined
        }
      />

      <div className="kpi-grid">
        <StatCard
          label="Órdenes abiertas"
          value={openOrders.length}
          icon={<Factory size={18} />}
          tone="info"
          foot={<span>{inProcess} en proceso</span>}
        />
        <StatCard
          label="Cumplimiento"
          value={`${kpis?.productionCompliance ?? 0}%`}
          icon={<CheckCircle2 size={18} />}
          tone={(kpis?.productionCompliance ?? 0) >= 95 ? 'ok' : 'warn'}
          foot={<span>producido vs. programado</span>}
        />
        <StatCard
          label="Desperdicio"
          value={`${kpis?.wastePct ?? 0}%`}
          icon={<XCircle size={18} />}
          tone="warn"
          foot={<span>merma sobre consumo total</span>}
        />
        <StatCard
          label="Costo de producción"
          value={money(closed.reduce((a, o) => a + o.totalCost, 0))}
          icon={<Clock size={18} />}
          tone="brand"
          foot={<span>órdenes cerradas</span>}
        />
      </div>

      <Card>
        <div className="card-pad" style={{ paddingBottom: 0 }}>
          <Tabs
            active={tab}
            onChange={setTab}
            tabs={[
              { id: 'open', label: 'Abiertas', count: openOrders.length },
              { id: 'en_proceso', label: 'En proceso', count: inProcess },
              { id: 'cerrada', label: 'Cerradas', count: closed.length },
              { id: 'all', label: 'Todas', count: orders?.length ?? 0 },
            ]}
          />
        </div>

        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Orden</th>
                <th>Producto terminado</th>
                <th>Estado</th>
                <th className="num">Programado</th>
                <th className="num">Producido</th>
                <th style={{ width: 130 }}>Avance</th>
                <th className="num">Costo total</th>
                <th>Programada</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <EmptyRow colSpan={9} message="Sin órdenes de producción. Cree una orden para empezar." />
              ) : (
                filtered.map((o) => {
                  const product = (products ?? []).find((p) => p.id === o.productId);
                  const meta = ORDER_STATUS[o.status];
                  const pct = o.plannedQty > 0 ? Math.min(100, (o.producedQty / o.plannedQty) * 100) : 0;
                  return (
                    <tr key={o.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/produccion/${o.id}`)}>
                      <td className="mono strong">{o.code}</td>
                      <td>
                        <div className="cell-main">
                          <span className="name">{product?.name ?? '—'}</span>
                          <span className="sku">
                            {product?.sku} · BOM v{o.bomVersion}
                          </span>
                        </div>
                      </td>
                      <td>
                        <Badge tone={meta.tone}>{meta.label}</Badge>
                      </td>
                      <td className="num">{fmtQty(o.plannedQty)}</td>
                      <td className="num strong">{fmtQty(o.producedQty)}</td>
                      <td>
                        <Progress value={pct} />
                        <div className="small faint" style={{ marginTop: 3 }}>
                          {Math.round(pct)}%
                        </div>
                      </td>
                      <td className="num">{money(o.totalCost)}</td>
                      <td className="small muted">{dateLong(o.scheduledDate)}</td>
                      <td>
                        <ArrowRight size={15} className="faint" />
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="table-foot">
          <span className="row" style={{ gap: 6 }}>
            <PlayCircle size={13} /> Flujo: borrador → liberada → en proceso → cerrada
          </span>
        </div>
      </Card>
    </>
  );
}

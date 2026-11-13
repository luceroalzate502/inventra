import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  AlertTriangle,
  ArrowRight,
  CalendarDays,
  Calculator,
  CheckCircle2,
  ClipboardList,
  Factory,
  PackageSearch,
  Plus,
  ShoppingCart,
} from 'lucide-react';
import { db } from '../db/schema';
import { useApp } from '../context/AppContext';
import { can } from '../domain/permissions';
import { buildMrp } from '../domain/mrp';
import { buildDailyDemand, todayKey } from '../domain/productionDaily';
import { ORDER_STATUS, PRODUCT_TYPES, typeLabel } from '../domain/types';
import type { ProductType } from '../domain/types';
import { dateLong, money, pct, qty as fmtQty } from '../domain/format';
import {
  Badge,
  Button,
  Card,
  CardHead,
  EmptyRow,
  Input,
  PageHeader,
  Progress,
  SearchInput,
  Select,
  StatCard,
  Tabs,
  cx,
} from '../components/ui';

export function Mrp() {
  const navigate = useNavigate();
  const { user } = useApp();
  const [tab, setTab] = useState('all');
  const [type, setType] = useState<'all' | ProductType>('all');
  const [search, setSearch] = useState('');
  const [safetyStock, setSafetyStock] = useState(true);
  const [includeDaily, setIncludeDaily] = useState(true);
  const [dailyDate, setDailyDate] = useState(todayKey());

  const orders = useLiveQuery(() => db.productionOrders.toArray(), []);
  const boms = useLiveQuery(() => db.boms.toArray(), []);
  const bomItems = useLiveQuery(() => db.bomItems.toArray(), []);
  const products = useLiveQuery(() => db.products.toArray(), []);
  const records = useLiveQuery(() => db.productionRecords.toArray(), []);

  const dailyDemand = useMemo(
    () => (includeDaily ? buildDailyDemand(records ?? [], dailyDate) : []),
    [records, includeDaily, dailyDate],
  );
  const dailyPending = useMemo(() => dailyDemand.reduce((acc, d) => acc + d.qty, 0), [dailyDemand]);

  const plan = useMemo(() => {
    if (!orders || !boms || !bomItems || !products) return null;
    const extraDemand = dailyDemand.map((d) => ({
      productId: d.productId,
      qty: d.qty,
      code: `PROG ${dailyDate}`,
      label: products.find((p) => p.id === d.productId)?.name,
    }));
    return buildMrp(orders, boms, bomItems, products, { safetyStock, extraDemand });
  }, [orders, boms, bomItems, products, safetyStock, dailyDemand, dailyDate]);

  const rows = useMemo(() => {
    if (!plan) return [];
    const term = search.trim().toLowerCase();
    return plan.rows
      .filter((r) => (tab === 'all' ? true : tab === 'shortage' ? r.netRequired > 0.0001 : r.netRequired <= 0.0001))
      .filter((r) => (type === 'all' ? true : r.type === type))
      .filter(
        (r) =>
          !term ||
          r.sku.toLowerCase().includes(term) ||
          r.name.toLowerCase().includes(term) ||
          r.orders.some((o) => o.code.toLowerCase().includes(term)),
      );
  }, [plan, tab, type, search]);

  const canManage = user ? can(user.role, 'production.manage') : false;
  const hasDaily = includeDaily && dailyDemand.length > 0;
  const noDemand = plan !== null && plan.orders.length === 0 && !hasDaily;

  return (
    <>
      <PageHeader
        title="MRP"
        subtitle="Planificación de requerimientos según órdenes abiertas, programa diario y BOM"
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
          value={plan?.orders.length ?? 0}
          icon={<Factory size={18} />}
          tone="info"
          foot={<span>{plan?.missingBom.length ?? 0} sin BOM válida</span>}
        />
        <StatCard
          label="Componentes"
          value={plan?.components ?? 0}
          icon={<ClipboardList size={18} />}
          tone="brand"
          foot={<span>{plan?.coveredCount ?? 0} cubiertos por stock</span>}
        />
        <StatCard
          label="Faltantes"
          value={plan?.shortageCount ?? 0}
          icon={<AlertTriangle size={18} />}
          tone={(plan?.shortageCount ?? 0) > 0 ? 'danger' : 'ok'}
          foot={<span>requieren compra o producción</span>}
        />
        <StatCard
          label="Compra estimada"
          value={money(plan?.netValue ?? 0)}
          icon={<ShoppingCart size={18} />}
          tone="warn"
          foot={<span>requerimiento neto valorizado</span>}
        />
      </div>

      <Card>
        <CardHead
          title="Requerimientos netos"
          subtitle="Demanda bruta, stock disponible y faltantes por componente"
          icon={<PackageSearch size={18} color="var(--brand-3)" />}
          actions={
            <label className="switch" style={{ whiteSpace: 'nowrap' }}>
              <input
                type="checkbox"
                checked={safetyStock}
                onChange={(e) => setSafetyStock(e.target.checked)}
              />
              Incluir stock mínimo
            </label>
          }
        />

        <div className="card-pad" style={{ paddingBottom: 0, display: 'grid', gap: 12 }}>
          <div className="field-row">
            <SearchInput
              value={search}
              onChange={setSearch}
              placeholder="Buscar componente, SKU u orden…"
            />
            <Select
              value={type}
              onChange={(e) => setType(e.target.value as 'all' | ProductType)}
              style={{ width: 230 }}
            >
              <option value="all">Todos los tipos</option>
              {PRODUCT_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </Select>
          </div>

          <div
            className="row wrap"
            style={{
              gap: 12,
              alignItems: 'center',
              padding: '10px 12px',
              borderRadius: 10,
              background: 'var(--surface-2)',
              border: '1px solid var(--line)',
            }}
          >
            <CalendarDays size={16} color="var(--brand-3)" />
            <label className="switch" style={{ whiteSpace: 'nowrap' }}>
              <input
                type="checkbox"
                checked={includeDaily}
                onChange={(e) => setIncludeDaily(e.target.checked)}
              />
              Incluir programa diario
            </label>
            <Input
              type="date"
              value={dailyDate}
              onChange={(e) => setDailyDate(e.target.value)}
              disabled={!includeDaily}
              style={{ width: 150 }}
            />
            <span className="small muted" style={{ flex: 1, minWidth: 180 }}>
              {includeDaily
                ? `${dailyDemand.length} producto(s) · ${fmtQty(dailyPending)} und pendientes (programado − conforme)`
                : 'Demanda del programa diario excluida del cálculo.'}
            </span>
          </div>

          <Tabs
            active={tab}
            onChange={setTab}
            tabs={[
              { id: 'all', label: 'Todos', count: plan?.components ?? 0 },
              { id: 'shortage', label: 'Faltantes', count: plan?.shortageCount ?? 0 },
              { id: 'covered', label: 'Cubiertos', count: plan?.coveredCount ?? 0 },
            ]}
          />
        </div>

        {noDemand && (
          <div
            style={{
              margin: '12px 18px 0',
              padding: '12px 14px',
              borderRadius: 10,
              background: 'var(--surface-2)',
              border: '1px dashed var(--line-strong)',
              display: 'flex',
              gap: 12,
              alignItems: 'center',
              flexWrap: 'wrap',
            }}
          >
            <Calculator size={18} color="var(--brand-3)" />
            <div className="small muted" style={{ flex: 1, minWidth: 200, lineHeight: 1.55 }}>
              El MRP se alimenta de las órdenes de producción abiertas y, opcionalmente, del programa
              diario pendiente. Cree una orden o registre producción con BOM activa para calcular los
              materiales necesarios.
            </div>
            {canManage && (
              <Button size="sm" variant="secondary" icon={<Plus size={14} />} onClick={() => navigate('/produccion/nueva')}>
                Nueva orden
              </Button>
            )}
          </div>
        )}

        {plan && plan.missingBom.length > 0 && (
          <div
            style={{
              margin: '12px 18px 0',
              padding: '12px 14px',
              borderRadius: 10,
              background: 'var(--warn-soft)',
              color: 'var(--warn)',
              display: 'flex',
              gap: 10,
              alignItems: 'flex-start',
            }}
          >
            <AlertTriangle size={17} style={{ flexShrink: 0, marginTop: 1 }} />
            <div className="small" style={{ lineHeight: 1.55 }}>
              <strong>{plan.missingBom.length} orden(es) sin BOM válida:</strong>{' '}
              {plan.missingBom.map((o) => o.code).join(', ')}. Estas órdenes no aportan requerimientos
              hasta que su lista de materiales esté activa.
            </div>
          </div>
        )}

        {plan && plan.missingDaily.length > 0 && (
          <div
            style={{
              margin: '12px 18px 0',
              padding: '12px 14px',
              borderRadius: 10,
              background: 'var(--warn-soft)',
              color: 'var(--warn)',
              display: 'flex',
              gap: 10,
              alignItems: 'flex-start',
            }}
          >
            <AlertTriangle size={17} style={{ flexShrink: 0, marginTop: 1 }} />
            <div className="small" style={{ lineHeight: 1.55 }}>
              <strong>{plan.missingDaily.length} producto(s) del programa diario sin BOM activa:</strong>{' '}
              {plan.missingDaily.map((d) => `${d.label ?? d.productId} (${fmtQty(d.qty)} und)`).join(', ')}.
              Su demanda no aporta requerimientos hasta que la lista de materiales esté activa.
            </div>
          </div>
        )}

        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Componente</th>
                <th>Tipo</th>
                <th className="num">Req. bruto</th>
                <th className="num">Stock</th>
                <th className="num">Mínimo</th>
                <th className="num">Req. neto</th>
                <th style={{ width: 130 }}>Cobertura</th>
                <th className="num">Valor estimado</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <EmptyRow
                  colSpan={9}
                  message={
                    noDemand
                      ? 'Sin órdenes abiertas: aún no hay requerimientos que planificar.'
                      : 'Sin componentes para los filtros seleccionados.'
                  }
                />
              ) : (
                rows.map((row) => {
                  const shortage = row.netRequired > 0.0001;
                  return (
                    <tr key={row.componentId}>
                      <td>
                        <div className="cell-main">
                          <span className="name">{row.name}</span>
                          <span className="sku">
                            {row.sku} · {row.location}
                          </span>
                        </div>
                      </td>
                      <td className="small muted">{typeLabel(row.type)}</td>
                      <td className="num">
                        {fmtQty(row.grossRequired)} <span className="faint">{row.uom}</span>
                      </td>
                      <td className="num">{fmtQty(row.stock)}</td>
                      <td className="num">{fmtQty(row.minStock)}</td>
                      <td className={cx('num', shortage && 'strong')} style={{ color: shortage ? 'var(--danger)' : 'var(--ok)' }}>
                        {fmtQty(row.netRequired)} <span className="faint">{row.uom}</span>
                      </td>
                      <td>
                        <Progress
                          value={Math.min(100, row.coverage)}
                          color={shortage ? 'var(--danger)' : 'var(--ok)'}
                        />
                        <div className="small faint" style={{ marginTop: 3 }}>
                          {pct(Math.min(100, row.coverage))}
                        </div>
                      </td>
                      <td className="num">{money(row.estimatedCost)}</td>
                      <td>
                        {shortage ? (
                          <Badge tone="danger" dot>
                            Faltante
                          </Badge>
                        ) : (
                          <Badge tone="ok" dot>
                            Cubierto
                          </Badge>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="table-foot">
          <span>
            MRP = demanda de órdenes abiertas + programa diario pendiente × BOM (con merma) + stock
            mínimo − stock disponible
          </span>
        </div>
      </Card>

      {includeDaily && dailyDemand.length > 0 && (
        <Card>
          <CardHead
            title="Programa diario pendiente"
            subtitle={`Demanda del ${dateLong(dailyDate)} aún no producida (programado − conforme)`}
            icon={<CalendarDays size={18} color="var(--brand-3)" />}
          />
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Producto terminado</th>
                  <th className="num">Pendiente</th>
                  <th className="num">Registros</th>
                  <th>BOM</th>
                </tr>
              </thead>
              <tbody>
                {dailyDemand.map((d) => {
                  const product = products?.find((p) => p.id === d.productId);
                  const hasBom = boms?.some((b) => b.productId === d.productId && b.status === 'activo') ?? false;
                  return (
                    <tr key={d.productId}>
                      <td>
                        <div className="cell-main">
                          <span className="name">{product?.name ?? 'Producto eliminado'}</span>
                          <span className="sku">{product?.sku ?? '—'}</span>
                        </div>
                      </td>
                      <td className="num strong">
                        {fmtQty(d.qty)} <span className="faint">{product?.uom ?? ''}</span>
                      </td>
                      <td className="num">{d.records.length}</td>
                      <td>
                        {hasBom ? (
                          <Badge tone="ok" dot>
                            Activa
                          </Badge>
                        ) : (
                          <Badge tone="warn" dot>
                            Sin BOM
                          </Badge>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="table-foot">
            <span>
              <CheckCircle2 size={13} style={{ verticalAlign: -2, marginRight: 4 }} />
              La demanda diaria se suma a las órdenes abiertas; se recalcula con cada captura de turno.
            </span>
          </div>
        </Card>
      )}

      <Card>
        <CardHead
          title="Órdenes que alimentan el cálculo"
          subtitle={`${plan?.orders.length ?? 0} órdenes abiertas consideradas`}
          icon={<Factory size={18} color="var(--brand-3)" />}
        />
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Orden</th>
                <th>Producto terminado</th>
                <th className="num">Programado</th>
                <th>Estado</th>
                <th>Fecha programada</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(plan?.orders.length ?? 0) === 0 ? (
                <EmptyRow colSpan={6} message="Sin órdenes abiertas. Cree una orden de producción para iniciar el MRP." />
              ) : (
                plan?.orders.map((order) => {
                  const product = products?.find((p) => p.id === order.productId);
                  const meta = ORDER_STATUS[order.status];
                  return (
                    <tr
                      key={order.id}
                      style={{ cursor: 'pointer' }}
                      onClick={() => navigate(`/produccion/${order.id}`)}
                    >
                      <td className="mono strong">{order.code}</td>
                      <td>
                        <div className="cell-main">
                          <span className="name">{product?.name ?? 'Producto eliminado'}</span>
                          <span className="sku">
                            {product?.sku ?? '—'} · BOM v{order.bomVersion}
                          </span>
                        </div>
                      </td>
                      <td className="num">
                        {fmtQty(order.plannedQty)} {product?.uom ?? ''}
                      </td>
                      <td>
                        <Badge tone={meta.tone}>{meta.label}</Badge>
                      </td>
                      <td className="small muted">{dateLong(order.scheduledDate)}</td>
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
          <span>
            <CheckCircle2 size={13} style={{ verticalAlign: -2, marginRight: 4 }} />
            Solo se consideran órdenes en borrador, liberadas o en proceso.
          </span>
        </div>
      </Card>
    </>
  );
}

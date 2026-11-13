import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ClipboardList,
  Factory,
  PlayCircle,
  PlusCircle,
  RotateCcw,
  XCircle,
} from 'lucide-react';
import { db } from '../db/schema';
import { useApp } from '../context/AppContext';
import { can } from '../domain/permissions';
import {
  cancelOrder,
  closeOrder,
  consumeTheoretical,
  explode,
  loadExplosion,
  registerConsumptions,
  releaseOrder,
  startOrder,
} from '../domain/production';
import type { BomExplosion, ConsumptionInput } from '../domain/production';
import { MOVEMENT_META, ORDER_STATUS } from '../domain/types';
import { dateLong, dateTime, money, qty as fmtQty } from '../domain/format';
import {
  Badge,
  Button,
  Card,
  CardHead,
  ConfirmDialog,
  EmptyState,
  Field,
  Input,
  Loading,
  Modal,
  PageHeader,
  Progress,
  StatCard,
} from '../components/ui';

export function ProductionOrderDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user, toast } = useApp();

  const order = useLiveQuery(() => (id ? db.productionOrders.get(id) : undefined), [id]);
  const products = useLiveQuery(() => db.products.toArray(), []);
  const bom = useLiveQuery(() => (order ? db.boms.get(order.bomId) : undefined), [order?.bomId]);
  const bomItems = useLiveQuery(
    () => (order ? db.bomItems.where('bomId').equals(order.bomId).toArray() : []),
    [order?.bomId],
  );
  const consumptions = useLiveQuery(
    () => (id ? db.consumptions.where('orderId').equals(id).toArray() : []),
    [id],
  );
  const movements = useLiveQuery(
    () => (id ? db.movements.where('orderId').equals(id).toArray() : []),
    [id],
  );

  const [consumeOpen, setConsumeOpen] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [releaseOpen, setReleaseOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [rows, setRows] = useState<{ componentId: string; real: string; waste: string }[]>([]);
  const [produced, setProduced] = useState('');
  const [rejected, setRejected] = useState('0');

  const explosion: BomExplosion | null = useMemo(() => {
    if (!order || !bom || !products || !bomItems) return null;
    return explode(bom, bomItems, products, order.plannedQty);
  }, [order, bom, products, bomItems]);

  if (!order) return <Loading rows={5} />;

  const product = (products ?? []).find((p) => p.id === order.productId);
  const meta = ORDER_STATUS[order.status];
  const canManage = user ? can(user.role, 'production.manage') : false;
  const consumedByComponent = new Map<string, number>();
  for (const c of consumptions ?? []) {
    consumedByComponent.set(c.productId, (consumedByComponent.get(c.productId) ?? 0) + c.realQty + c.wasteQty);
  }

  const openConsume = async () => {
    if (!order) return;
    const exp = await loadExplosion(order.bomId, order.plannedQty);
    setRows(
      exp.items.map((i) => {
        const consumed = consumedByComponent.get(i.componentId) ?? 0;
        const remaining = Math.max(0, i.required - consumed);
        return { componentId: i.componentId, real: remaining.toFixed(3), waste: '0' };
      }),
    );
    setConsumeOpen(true);
  };

  const confirmConsume = async () => {
    if (!user) return;
    setBusy(true);
    try {
      const entries: ConsumptionInput[] = rows
        .map((r) => ({
          productId: r.componentId,
          realQty: Number(r.real) || 0,
          wasteQty: Number(r.waste) || 0,
        }))
        .filter((r) => r.realQty + r.wasteQty > 0);
      if (entries.length === 0) {
        toast('Nada que consumir', 'warn', 'Ingrese cantidades mayores que cero.');
        setBusy(false);
        return;
      }
      await registerConsumptions(order.id, entries, user);
      toast('Consumo registrado', 'success', 'El inventario de componentes fue descontado.');
      setConsumeOpen(false);
    } catch (err) {
      toast('No se pudo registrar', 'error', err instanceof Error ? err.message : undefined);
    } finally {
      setBusy(false);
    }
  };

  const confirmClose = async () => {
    if (!user) return;
    setBusy(true);
    try {
      await closeOrder(
        order.id,
        { producedQty: Number(produced) || 0, rejectedQty: Number(rejected) || 0 },
        user,
      );
      toast('Orden cerrada', 'success', 'El producto terminado ingresó al inventario.');
      setCloseOpen(false);
    } catch (err) {
      toast('No se pudo cerrar', 'error', err instanceof Error ? err.message : undefined);
    } finally {
      setBusy(false);
    }
  };

  const doRelease = async () => {
    if (!user) return;
    setBusy(true);
    try {
      await releaseOrder(order.id, user);
      toast('Orden liberada', 'success', 'Materiales verificados y orden lista para iniciar.');
      setReleaseOpen(false);
    } catch (err) {
      toast('No se pudo liberar', 'error', err instanceof Error ? err.message : undefined);
    } finally {
      setBusy(false);
    }
  };

  const doStart = async () => {
    if (!user) return;
    try {
      await startOrder(order.id, user);
      toast('Producción iniciada', 'info', 'Registre el consumo real de materiales.');
    } catch (err) {
      toast('No se pudo iniciar', 'error', err instanceof Error ? err.message : undefined);
    }
  };

  const doConsumeTheoretical = async () => {
    if (!user) return;
    setBusy(true);
    try {
      await consumeTheoretical(order.id, user);
      toast('Consumo teórico aplicado', 'success', 'Se descontaron las cantidades del BOM.');
      setConsumeOpen(false);
    } catch (err) {
      toast('No se pudo consumir', 'error', err instanceof Error ? err.message : undefined);
    } finally {
      setBusy(false);
    }
  };

  const doCancel = async () => {
    if (!user) return;
    setBusy(true);
    try {
      await cancelOrder(order.id, user);
      toast('Orden cancelada', 'warn');
      setCancelOpen(false);
    } catch (err) {
      toast('No se pudo cancelar', 'error', err instanceof Error ? err.message : undefined);
    } finally {
      setBusy(false);
    }
  };

  const pct = order.plannedQty > 0 ? Math.min(100, (order.producedQty / order.plannedQty) * 100) : 0;
  const totalConsumedCost = (consumptions ?? []).reduce((a, c) => a + c.totalCost, 0);

  return (
    <>
      <PageHeader
        title={`Orden ${order.code}`}
        subtitle={product ? `${product.sku} · ${product.name}` : ''}
        back={
          <Button variant="ghost" size="sm" icon={<ArrowLeft size={16} />} onClick={() => navigate('/produccion')}>
            Producción
          </Button>
        }
        actions={
          canManage ? (
            <>
              {order.status === 'borrador' && (
                <Button variant="primary" icon={<CheckCircle2 size={16} />} onClick={() => setReleaseOpen(true)}>
                  Liberar
                </Button>
              )}
              {order.status === 'liberada' && (
                <Button variant="primary" icon={<PlayCircle size={16} />} onClick={doStart}>
                  Iniciar producción
                </Button>
              )}
              {(order.status === 'liberada' || order.status === 'en_proceso') && (
                <Button variant="secondary" icon={<PlusCircle size={15} />} onClick={openConsume}>
                  Registrar consumo
                </Button>
              )}
              {(order.status === 'liberada' || order.status === 'en_proceso') && (
                <Button
                  variant="secondary"
                  icon={<Factory size={15} />}
                  onClick={() => {
                    setProduced(String(order.plannedQty));
                    setRejected('0');
                    setCloseOpen(true);
                  }}
                >
                  Cerrar orden
                </Button>
              )}
              {['borrador', 'liberada'].includes(order.status) && (
                <Button variant="ghost" icon={<XCircle size={15} />} onClick={() => setCancelOpen(true)} className="desktop-only">
                  Cancelar
                </Button>
              )}
            </>
          ) : undefined
        }
      />

      <div className="kpi-grid">
        <StatCard
          label="Cantidad programada"
          value={fmtQty(order.plannedQty)}
          icon={<ClipboardList size={18} />}
          tone="info"
          foot={<Badge tone={meta.tone}>{meta.label}</Badge>}
        />
        <StatCard
          label="Producido"
          value={fmtQty(order.producedQty)}
          icon={<Factory size={18} />}
          tone="ok"
          foot={<span>{order.rejectedQty} rechazadas</span>}
        />
        <StatCard
          label="Costo materiales"
          value={money(totalConsumedCost || order.materialsCost)}
          icon={<RotateCcw size={18} />}
          tone="warn"
          foot={<span>consumo real registrado</span>}
        />
        <StatCard
          label="Costo unitario"
          value={money(order.producedQty > 0 ? order.totalCost / order.producedQty : 0)}
          icon={<CheckCircle2 size={18} />}
          tone="brand"
          foot={<span>materiales + mano de obra</span>}
        />
      </div>

      <div className="grid grid-2" style={{ marginBottom: 16 }}>
        <Card>
          <CardHead title="Información de la orden" subtitle="Trazabilidad del proceso" />
          <div className="card-pad">
            <div className="meta-grid">
              <div>
                <div className="meta-label">Producto</div>
                <div className="meta-value">{product?.name}</div>
              </div>
              <div>
                <div className="meta-label">Lista de materiales</div>
                <div className="meta-value mono">
                  {bom?.code ?? '—'} · v{order.bomVersion}
                </div>
              </div>
              <div>
                <div className="meta-label">Programada</div>
                <div className="meta-value">{dateLong(order.scheduledDate)}</div>
              </div>
              <div>
                <div className="meta-label">Responsable</div>
                <div className="meta-value">{order.userName}</div>
              </div>
              <div>
                <div className="meta-label">Creada</div>
                <div className="meta-value">{dateTime(order.createdAt)}</div>
              </div>
              <div>
                <div className="meta-label">Cerrada</div>
                <div className="meta-value">{order.closedAt ? dateTime(order.closedAt) : '—'}</div>
              </div>
            </div>
            {order.notes && (
              <div className="mt-16">
                <div className="meta-label">Observaciones</div>
                <div className="small">{order.notes}</div>
              </div>
            )}
          </div>
        </Card>

        <Card>
          <CardHead title="Avance y costos" subtitle="Ejecución de la orden" />
          <div className="card-pad" style={{ display: 'grid', gap: 14 }}>
            <div>
              <div className="row-between small mb-8">
                <span className="muted">Avance de producción</span>
                <strong>{Math.round(pct)}%</strong>
              </div>
              <Progress value={pct} />
            </div>
            <div className="row-between">
              <span className="small muted">Materiales</span>
              <span className="bold">{money(order.materialsCost)}</span>
            </div>
            <div className="row-between">
              <span className="small muted">Mano de obra</span>
              <span className="bold">{money(order.laborCost)}</span>
            </div>
            <div className="row-between" style={{ borderTop: '1px dashed var(--line-strong)', paddingTop: 10 }}>
              <span className="small muted">Costo total</span>
              <span className="bold" style={{ fontSize: 17 }}>{money(order.totalCost)}</span>
            </div>
            <div className="row-between">
              <span className="small muted">Unidades rechazadas</span>
              <span className="bold" style={{ color: order.rejectedQty > 0 ? 'var(--danger)' : 'var(--muted)' }}>
                {fmtQty(order.rejectedQty)}
              </span>
            </div>
          </div>
        </Card>
      </div>

      <Card className="mb-16">
        <CardHead
          title="Materiales: teórico vs. real"
          subtitle="Explosión de BOM y consumo registrado"
          actions={
            (order.status === 'liberada' || order.status === 'en_proceso') && canManage ? (
              <Button size="sm" variant="secondary" icon={<PlusCircle size={14} />} onClick={openConsume}>
                Consumir
              </Button>
            ) : undefined
          }
        />
        {!explosion || explosion.items.length === 0 ? (
          <EmptyState icon={<AlertTriangle size={22} />} title="Sin lista de materiales" />
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Componente</th>
                  <th className="num">Teórico</th>
                  <th className="num">Consumido</th>
                  <th className="num">Merma</th>
                  <th className="num">Variación</th>
                  <th className="num">Costo real</th>
                  <th className="num">Stock</th>
                </tr>
              </thead>
              <tbody>
                {explosion.items.map((item) => {
                  const real = (consumptions ?? [])
                    .filter((c) => c.productId === item.componentId)
                    .reduce((a, c) => a + c.realQty, 0);
                  const waste = (consumptions ?? [])
                    .filter((c) => c.productId === item.componentId)
                    .reduce((a, c) => a + c.wasteQty, 0);
                  const cost = (consumptions ?? [])
                    .filter((c) => c.productId === item.componentId)
                    .reduce((a, c) => a + c.totalCost, 0);
                  const variance = real + waste - item.required;
                  const comp = (products ?? []).find((p) => p.id === item.componentId);
                  return (
                    <tr key={item.componentId}>
                      <td>
                        <div className="cell-main">
                          <span className="name">{item.name}</span>
                          <span className="sku">{item.sku}</span>
                        </div>
                      </td>
                      <td className="num">
                        {fmtQty(item.required)} {item.uom}
                      </td>
                      <td className="num strong">{real > 0 ? `${fmtQty(real)} ${item.uom}` : '—'}</td>
                      <td className="num">{waste > 0 ? fmtQty(waste) : '—'}</td>
                      <td className="num">
                        {real + waste > 0 ? (
                          <span style={{ color: Math.abs(variance) < 0.001 ? 'var(--ok)' : variance > 0 ? 'var(--warn)' : 'var(--info)', fontWeight: 600 }}>
                            {variance > 0 ? '+' : ''}
                            {fmtQty(variance)}
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="num">{cost > 0 ? money(cost) : '—'}</td>
                      <td className="num">
                        <Badge tone={(comp?.stock ?? 0) > 0 ? 'ok' : 'danger'}>
                          {fmtQty(comp?.stock ?? 0)}
                        </Badge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card>
        <CardHead title="Trazabilidad" subtitle="Movimientos generados por esta orden" />
        {(movements ?? []).length === 0 ? (
          <EmptyState icon={<ClipboardList size={22} />} title="Sin movimientos" message="Al consumir materiales o cerrar la orden se generarán aquí." />
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Movimiento</th>
                  <th>Producto</th>
                  <th className="num">Cantidad</th>
                  <th className="num">Costo</th>
                  <th>Lote</th>
                  <th>Fecha</th>
                  <th>Responsable</th>
                </tr>
              </thead>
              <tbody>
                {(movements ?? [])
                  .slice()
                  .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
                  .map((m) => (
                    <tr key={m.id}>
                      <td>
                        <Badge tone={m.direction === 1 ? 'ok' : 'danger'}>{MOVEMENT_META[m.type].label}</Badge>
                      </td>
                      <td>
                        <div className="cell-main">
                          <span className="name">{m.productName}</span>
                          <span className="sku">{m.productSku}</span>
                        </div>
                      </td>
                      <td className="num">{fmtQty(m.qty)}</td>
                      <td className="num">{money(m.totalCost)}</td>
                      <td className="mono small">{m.lotCode ?? '—'}</td>
                      <td className="small">{dateTime(m.createdAt)}</td>
                      <td className="small muted">{m.userName}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Modal consumo */}
      <Modal
        open={consumeOpen}
        onClose={() => setConsumeOpen(false)}
        title="Registrar consumo de materiales"
        subtitle="Las cantidades se descuentan del inventario al confirmar"
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConsumeOpen(false)} disabled={busy}>
              Cancelar
            </Button>
            <Button variant="secondary" onClick={doConsumeTheoretical} disabled={busy}>
              Usar consumo teórico
            </Button>
            <Button variant="primary" onClick={confirmConsume} disabled={busy}>
              {busy ? 'Registrando…' : 'Confirmar consumo'}
            </Button>
          </>
        }
      >
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Componente</th>
                <th className="num">Teórico</th>
                <th className="num" style={{ width: 120 }}>Consumo real</th>
                <th className="num" style={{ width: 110 }}>Merma</th>
                <th className="num">Stock</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, idx) => {
                const comp = (products ?? []).find((p) => p.id === r.componentId);
                const item = explosion?.items.find((i) => i.componentId === r.componentId);
                return (
                  <tr key={r.componentId}>
                    <td>
                      <div className="cell-main">
                        <span className="name">{comp?.name}</span>
                        <span className="sku">{comp?.sku}</span>
                      </div>
                    </td>
                    <td className="num">
                      {fmtQty(item?.required ?? 0)} {comp?.uom}
                    </td>
                    <td>
                      <Input
                        type="number"
                        min={0}
                        step="0.001"
                        value={r.real}
                        onChange={(e) =>
                          setRows((prev) =>
                            prev.map((x, i) => (i === idx ? { ...x, real: e.target.value } : x)),
                          )
                        }
                        style={{ textAlign: 'right' }}
                      />
                    </td>
                    <td>
                      <Input
                        type="number"
                        min={0}
                        step="0.001"
                        value={r.waste}
                        onChange={(e) =>
                          setRows((prev) =>
                            prev.map((x, i) => (i === idx ? { ...x, waste: e.target.value } : x)),
                          )
                        }
                        style={{ textAlign: 'right' }}
                      />
                    </td>
                    <td className="num">
                      <Badge tone={(comp?.stock ?? 0) >= (Number(r.real) + Number(r.waste)) ? 'ok' : 'danger'}>
                        {fmtQty(comp?.stock ?? 0)}
                      </Badge>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="small muted">
          Si un componente no se consume, deje la cantidad en cero. La merma también descuenta inventario.
        </p>
      </Modal>

      {/* Modal cierre */}
      <Modal
        open={closeOpen}
        onClose={() => setCloseOpen(false)}
        title="Cerrar orden de producción"
        subtitle="El producto terminado ingresará al inventario con el costo real"
        footer={
          <>
            <Button variant="ghost" onClick={() => setCloseOpen(false)} disabled={busy}>
              Cancelar
            </Button>
            <Button variant="primary" icon={<CheckCircle2 size={15} />} onClick={confirmClose} disabled={busy}>
              {busy ? 'Cerrando…' : 'Cerrar orden'}
            </Button>
          </>
        }
      >
        <div className="field-row">
          <Field label="Unidades fabricadas *">
            <Input type="number" min={1} value={produced} onChange={(e) => setProduced(e.target.value)} />
          </Field>
          <Field label="Unidades rechazadas">
            <Input type="number" min={0} value={rejected} onChange={(e) => setRejected(e.target.value)} />
          </Field>
        </div>

        <div className="row" style={{ gap: 8, background: 'var(--surface-2)', borderRadius: 10, padding: 12 }}>
          <AlertTriangle size={15} color="var(--warn)" />
          <span className="small muted">
            El costo unitario se calcula como (materiales consumidos + mano de obra) ÷ unidades fabricadas.
          </span>
        </div>

        {Number(produced) > 0 && (
          <div className="row-between small">
            <span className="muted">Costo unitario estimado</span>
            <strong>
              {money((totalConsumedCost + order.laborCost) / (Number(produced) || 1))}
            </strong>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={releaseOpen}
        title="Liberar orden de producción"
        message="Se validará la disponibilidad de todos los materiales de la lista. Si hay faltantes, la orden no se libera."
        confirmLabel="Liberar orden"
        busy={busy}
        onCancel={() => setReleaseOpen(false)}
        onConfirm={doRelease}
      >
        {explosion && !explosion.available && (
          <div style={{ display: 'grid', gap: 4 }}>
            <Badge tone="danger">
              <AlertTriangle size={12} /> {explosion.shortages.length} faltantes
            </Badge>
            {explosion.shortages.map((s) => (
              <div key={s.componentId} className="small muted">
                {s.sku}: faltan {fmtQty(s.shortage)} {s.uom}
              </div>
            ))}
          </div>
        )}
      </ConfirmDialog>

      <ConfirmDialog
        open={cancelOpen}
        title="Cancelar orden"
        message="La orden quedará cancelada. Los consumos ya registrados no se revierten automáticamente."
        confirmLabel="Cancelar orden"
        tone="danger"
        withReason
        busy={busy}
        onCancel={() => setCancelOpen(false)}
        onConfirm={doCancel}
      />
    </>
  );
}

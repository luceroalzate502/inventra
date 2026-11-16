import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  CheckCircle2,
  FileSpreadsheet,
  FileText,
  PackageCheck,
  Plus,
  ShoppingCart,
  Trash2,
  Truck,
  XCircle,
} from 'lucide-react';
import { db } from '../db/schema';
import { useApp } from '../context/AppContext';
import { dateTime, money, qty as fmtQty } from '../domain/format';
import {
  cancelDispatch,
  confirmDispatch,
  createDispatch,
  dispatchTotals,
  updateDispatch,
} from '../domain/dispatch';
import { exportExcel, exportPdf } from '../domain/export';
import { DISPATCH_STATUS } from '../domain/types';
import type { Dispatch, DispatchItem } from '../domain/types';
import {
  Badge,
  Button,
  Card,
  CardHead,
  ConfirmDialog,
  EmptyRow,
  Field,
  Input,
  Modal,
  PageHeader,
  SearchInput,
  Select,
  StatCard,
  Textarea,
} from '../components/ui';

interface NewDispatchForm {
  date: string;
  customer: string;
  orderRef: string;
  vehicle: string;
  driver: string;
  destination: string;
  notes: string;
}

interface NewItem {
  productId: string;
  requestedQty: string;
  lotCode: string;
}

const today = () => {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
};

const emptyForm = (): NewDispatchForm => ({
  date: today(),
  customer: '',
  orderRef: '',
  vehicle: '',
  driver: '',
  destination: '',
  notes: '',
});

const emptyItem = (): NewItem => ({ productId: '', requestedQty: '', lotCode: '' });

export function Dispatches() {
  const { user, settings, toast } = useApp();
  const dispatches = useLiveQuery(() => db.dispatches.toArray(), []) ?? [];
  const products = useLiveQuery(() => db.products.toArray(), []) ?? [];

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | Dispatch['status']>('all');
  const [newOpen, setNewOpen] = useState(false);
  const [form, setForm] = useState<NewDispatchForm>(emptyForm);
  const [newItems, setNewItems] = useState<NewItem[]>([emptyItem()]);
  const [detailOpen, setDetailOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draftItems, setDraftItems] = useState<DispatchItem[]>([]);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const activeProducts = products.filter((p) => p.status === 'activo');
  const selected = dispatches.find((d) => d.id === selectedId) ?? null;

  const set = <K extends keyof NewDispatchForm>(key: K, value: NewDispatchForm[K]) =>
    setForm((f) => ({ ...f, [key]: value }));
  const setItem = <K extends keyof NewItem>(index: number, key: K, value: NewItem[K]) =>
    setNewItems((rows) => rows.map((row, i) => (i === index ? { ...row, [key]: value } : row)));

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return dispatches
      .filter((d) => (statusFilter === 'all' ? true : d.status === statusFilter))
      .filter(
        (d) =>
          !term ||
          d.code.toLowerCase().includes(term) ||
          d.customer.toLowerCase().includes(term) ||
          d.orderRef.toLowerCase().includes(term) ||
          d.destination.toLowerCase().includes(term),
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [dispatches, search, statusFilter]);

  const pending = dispatches.filter((d) => d.status === 'borrador' || d.status === 'picking').length;
  const dispatched = dispatches.filter((d) => d.status === 'despachado').length;
  const pendingUnits = dispatches
    .filter((d) => d.status === 'borrador' || d.status === 'picking')
    .reduce((a, d) => a + d.items.reduce((b, i) => b + i.requestedQty, 0), 0);

  const patchDraft = (index: number, patch: Partial<DispatchItem>) =>
    setDraftItems((items) => items.map((item, i) => (i === index ? { ...item, ...patch } : item)));

  const openDetail = (dispatch: Dispatch) => {
    setSelectedId(dispatch.id);
    setDraftItems(dispatch.items.map((item) => ({ ...item })));
    setDetailOpen(true);
  };

  const addNewItem = () => setNewItems((rows) => [...rows, emptyItem()]);
  const removeNewItem = (index: number) =>
    setNewItems((rows) => (rows.length === 1 ? [emptyItem()] : rows.filter((_, i) => i !== index)));

  const saveNew = async () => {
    if (!user) return;
    if (!form.customer.trim()) {
      toast('Cliente requerido', 'warn', 'Indique el cliente o destino del despacho.');
      return;
    }
    const items = newItems.filter((row) => row.productId && Number(row.requestedQty) > 0);
    if (items.length === 0) {
      toast('Picking vacío', 'warn', 'Agregue al menos un producto con cantidad.');
      return;
    }
    setBusy(true);
    try {
      const dispatch = await createDispatch(
        {
          date: form.date,
          customer: form.customer,
          orderRef: form.orderRef,
          vehicle: form.vehicle,
          driver: form.driver,
          destination: form.destination,
          notes: form.notes,
          items: items.map((row) => ({
            productId: row.productId,
            requestedQty: Number(row.requestedQty) || 0,
            lotCode: row.lotCode.trim().toUpperCase() || undefined,
          })),
        },
        user,
      );
      toast('Despacho creado', 'success', `${dispatch.code} · ${dispatch.customer}`);
      setNewOpen(false);
      setForm(emptyForm());
      setNewItems([emptyItem()]);
      openDetail(dispatch);
    } catch (error) {
      toast('No se pudo crear el despacho', 'error', error instanceof Error ? error.message : undefined);
    } finally {
      setBusy(false);
    }
  };

  const savePicking = async (status: Dispatch['status'] = 'picking') => {
    if (!user || !selected) return;
    setBusy(true);
    try {
      const next = await updateDispatch(selected.id, { items: draftItems, status }, user);
      setDraftItems(next.items.map((item) => ({ ...item })));
      toast('Picking guardado', 'success', `${next.code} · ${next.items.length} línea(s)`);
    } catch (error) {
      toast('No se pudo guardar el picking', 'error', error instanceof Error ? error.message : undefined);
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    if (!user || !selected) return;
    setBusy(true);
    try {
      await updateDispatch(selected.id, { items: draftItems, status: 'picking' }, user);
      const confirmed = await confirmDispatch(selected.id, user);
      toast('Despacho confirmado', 'success', `${confirmed.code} · ${confirmed.customer} · inventario descontado`);
      setDetailOpen(false);
    } catch (error) {
      toast('No se pudo confirmar el despacho', 'error', error instanceof Error ? error.message : undefined);
    } finally {
      setBusy(false);
    }
  };

  const doCancel = async (reason: string) => {
    if (!user || !selected) return;
    setBusy(true);
    try {
      await cancelDispatch(selected.id, user, reason);
      toast('Despacho anulado', 'success', selected.code);
      setCancelOpen(false);
      setDetailOpen(false);
    } catch (error) {
      toast('No se pudo anular', 'error', error instanceof Error ? error.message : undefined);
    } finally {
      setBusy(false);
    }
  };

  const exportRemision = () => {
    if (!selected) return;
    exportPdf({
      filename: `remision-${selected.code}`,
      title: `Remisión ${selected.code}`,
      subtitle: `${selected.customer}${selected.orderRef ? ` · Pedido ${selected.orderRef}` : ''} · ${selected.date}`,
      company: settings?.companyName ?? 'INVENTRA',
      user: user?.name,
      columns: ['SKU', 'Producto', 'Lote', 'Cantidad', 'UOM'],
      rows: draftItems.map((item) => [
        item.sku,
        item.name,
        item.lotCode ?? '—',
        fmtQty(item.pickedQty || item.requestedQty),
        item.uom,
      ]),
      totals: [
        `Total unidades: ${fmtQty(draftItems.reduce((a, i) => a + (i.pickedQty || i.requestedQty), 0))}`,
        `Transporte: ${selected.vehicle || '—'} · Conductor: ${selected.driver || '—'}`,
        `Destino: ${selected.destination || selected.customer}`,
      ],
    });
  };

  const exportPacking = () => {
    if (!selected) return;
    exportExcel(`packing-list-${selected.code}.xlsx`, [
      {
        name: 'Packing list',
        rows: draftItems.map((item) => ({
          Despacho: selected.code,
          Cliente: selected.customer,
          Pedido: selected.orderRef,
          SKU: item.sku,
          Producto: item.name,
          Lote: item.lotCode ?? '',
          Solicitado: item.requestedQty,
          Pickeado: item.pickedQty,
          UOM: item.uom,
        })),
        widths: [14, 24, 16, 16, 30, 20, 12, 12, 8],
      },
    ]);
  };

  const detailTotals = selected
    ? dispatchTotals({ ...selected, items: draftItems }, products)
    : { units: 0, requested: 0, value: 0 };

  const canConfirm =
    selected !== null &&
    draftItems.length > 0 &&
    draftItems.every((item) => item.pickedQty > 0 && Math.abs(item.pickedQty - item.requestedQty) < 0.0001);

  return (
    <>
      <PageHeader
        title="Despachos"
        subtitle="Picking list contra pedido, remisión y packing list"
        actions={
          <Button variant="primary" icon={<Plus size={16} />} onClick={() => setNewOpen(true)}>
            Nuevo despacho
          </Button>
        }
      />

      <div className="kpi-grid">
        <StatCard
          label="Despachos"
          value={dispatches.length}
          icon={<Truck size={18} />}
          tone="brand"
          foot={<span>{dispatched} confirmados</span>}
        />
        <StatCard
          label="Pendientes"
          value={pending}
          icon={<ShoppingCart size={18} />}
          tone={pending > 0 ? 'warn' : 'ok'}
          foot={<span>borrador o en picking</span>}
        />
        <StatCard
          label="Unidades por despachar"
          value={fmtQty(pendingUnits)}
          icon={<PackageCheck size={18} />}
          tone="info"
          foot={<span>solicitadas en picking</span>}
        />
        <StatCard
          label="Valor despachado"
          value={money(
            dispatches
              .filter((d) => d.status === 'despachado')
              .reduce((a, d) => a + dispatchTotals(d, products).value, 0),
          )}
          icon={<FileText size={18} />}
          tone="ok"
          foot={<span>costo de salida acumulado</span>}
        />
      </div>

      <Card>
        <CardHead
          title="Órdenes de despacho"
          subtitle="Toque un despacho para hacer picking y confirmar la salida"
          icon={<Truck size={18} color="var(--brand-3)" />}
          actions={
            <div className="row" style={{ gap: 8 }}>
              <SearchInput value={search} onChange={setSearch} placeholder="Buscar código, cliente u pedido…" />
              <Select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as 'all' | Dispatch['status'])}
                style={{ width: 160 }}
              >
                <option value="all">Todos</option>
                {Object.entries(DISPATCH_STATUS).map(([value, meta]) => (
                  <option key={value} value={value}>
                    {meta.label}
                  </option>
                ))}
              </Select>
            </div>
          }
        />
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Despacho</th>
                <th>Cliente / pedido</th>
                <th>Fecha</th>
                <th className="num">Líneas</th>
                <th className="num">Unidades</th>
                <th className="num">Valor</th>
                <th>Estado</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <EmptyRow colSpan={8} message="Sin despachos para los filtros seleccionados. Cree el primero con “Nuevo despacho”." />
              ) : (
                filtered.map((dispatch) => {
                  const totals = dispatchTotals(dispatch, products);
                  const meta = DISPATCH_STATUS[dispatch.status];
                  return (
                    <tr key={dispatch.id} style={{ cursor: 'pointer' }} onClick={() => openDetail(dispatch)}>
                      <td>
                        <div className="cell-main">
                          <span className="name mono">{dispatch.code}</span>
                          <span className="sku">{dispatch.userName}</span>
                        </div>
                      </td>
                      <td>
                        <div className="cell-main">
                          <span className="name">{dispatch.customer}</span>
                          <span className="sku">
                            {dispatch.orderRef ? `Pedido ${dispatch.orderRef}` : 'Sin pedido'} · {dispatch.destination || '—'}
                          </span>
                        </div>
                      </td>
                      <td className="small muted">{dispatch.date}</td>
                      <td className="num">{dispatch.items.length}</td>
                      <td className="num strong">{fmtQty(totals.requested)}</td>
                      <td className="num">{money(totals.value)}</td>
                      <td>
                        <Badge tone={meta.tone} dot>{meta.label}</Badge>
                      </td>
                      <td>
                        <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); openDetail(dispatch); }}>
                          Abrir
                        </Button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* ----------------------------- Nuevo despacho ----------------------------- */}
      <Modal
        open={newOpen}
        onClose={() => setNewOpen(false)}
        title="Nuevo despacho"
        subtitle="Picking list contra pedido del cliente"
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => setNewOpen(false)} disabled={busy}>
              Cancelar
            </Button>
            <Button variant="primary" onClick={saveNew} disabled={busy}>
              {busy ? <span className="spinner" /> : null} Crear despacho
            </Button>
          </>
        }
      >
        <div className="form-grid">
          <div className="field-row">
            <Field label="Cliente *">
              <Input value={form.customer} onChange={(e) => set('customer', e.target.value)} placeholder="Cliente / razón social" />
            </Field>
            <Field label="Pedido / referencia">
              <Input value={form.orderRef} onChange={(e) => set('orderRef', e.target.value)} placeholder="PED-2026-001" className="mono" />
            </Field>
          </div>
          <div className="field-row-3">
            <Field label="Fecha">
              <Input type="date" value={form.date} onChange={(e) => set('date', e.target.value)} />
            </Field>
            <Field label="Vehículo">
              <Input value={form.vehicle} onChange={(e) => set('vehicle', e.target.value)} placeholder="Placa / tipo" />
            </Field>
            <Field label="Conductor">
              <Input value={form.driver} onChange={(e) => set('driver', e.target.value)} placeholder="Nombre" />
            </Field>
          </div>
          <Field label="Destino">
            <Input value={form.destination} onChange={(e) => set('destination', e.target.value)} placeholder="Ciudad / dirección de entrega" />
          </Field>

          <div className="row-between" style={{ marginTop: 4 }}>
            <div className="meta-label">Picking list</div>
            <Button size="sm" variant="secondary" icon={<Plus size={14} />} onClick={addNewItem}>
              Agregar línea
            </Button>
          </div>

          <div style={{ display: 'grid', gap: 10 }}>
            {newItems.map((item, index) => {
              const product = products.find((p) => p.id === item.productId);
              return (
                <div
                  key={index}
                  style={{
                    border: '1px solid var(--line)',
                    borderRadius: 11,
                    padding: 12,
                    display: 'grid',
                    gap: 10,
                    background: 'var(--surface-2)',
                  }}
                >
                  <div className="field-row">
                    <Field label="Producto">
                      <Select
                        value={item.productId}
                        onChange={(e) => setItem(index, 'productId', e.target.value)}
                      >
                        <option value="">Seleccione…</option>
                        {activeProducts.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.sku} · {p.name} ({fmtQty(p.stock)} {p.uom})
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="Cantidad">
                      <Input
                        type="number"
                        min={0}
                        value={item.requestedQty}
                        onChange={(e) => setItem(index, 'requestedQty', e.target.value)}
                        placeholder="0"
                      />
                    </Field>
                  </div>
                  <div className="field-row">
                    <Field label="Lote (opcional)">
                      <Input
                        value={item.lotCode}
                        onChange={(e) => setItem(index, 'lotCode', e.target.value.toUpperCase())}
                        placeholder="L-20260101-T1-INY01"
                        className="mono"
                      />
                    </Field>
                    <div className="row-between" style={{ alignItems: 'flex-end' }}>
                      <span className="small faint">
                        {product ? `Stock total: ${fmtQty(product.stock)} ${product.uom}` : 'Seleccione un producto'}
                      </span>
                      <Button size="sm" variant="ghost" icon={<Trash2 size={14} />} onClick={() => removeNewItem(index)}>
                        Quitar
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <Field label="Notas">
            <Textarea value={form.notes} onChange={(e) => set('notes', e.target.value)} placeholder="Instrucciones de carga, sellos, observaciones…" />
          </Field>
        </div>
      </Modal>

      {/* ------------------------------- Detalle -------------------------------- */}
      <Modal
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
        title={selected ? `Despacho ${selected.code}` : 'Despacho'}
        subtitle={selected ? `${selected.customer}${selected.orderRef ? ` · Pedido ${selected.orderRef}` : ''} · ${selected.date}` : undefined}
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => setDetailOpen(false)} disabled={busy}>
              Cerrar
            </Button>
            {selected && selected.status !== 'despachado' && selected.status !== 'anulado' && (
              <>
                <Button variant="secondary" onClick={() => savePicking('picking')} disabled={busy}>
                  Guardar picking
                </Button>
                <Button variant="danger" onClick={() => setCancelOpen(true)} disabled={busy}>
                  Anular
                </Button>
                <Button variant="primary" icon={<CheckCircle2 size={16} />} onClick={confirm} disabled={busy || !canConfirm}>
                  {busy ? <span className="spinner" /> : null} Confirmar despacho
                </Button>
              </>
            )}
            {selected && (
              <>
                <Button variant="secondary" icon={<FileText size={16} />} onClick={exportRemision}>
                  Remisión PDF
                </Button>
                <Button variant="secondary" icon={<FileSpreadsheet size={16} />} onClick={exportPacking}>
                  Packing list
                </Button>
              </>
            )}
          </>
        }
      >
        {!selected ? (
          <div className="loc-empty">Seleccione un despacho.</div>
        ) : (
          <div className="form-grid">
            <div className="meta-grid">
              <div>
                <div className="meta-label">Estado</div>
                <div className="meta-value">
                  <Badge tone={DISPATCH_STATUS[selected.status].tone} dot>{DISPATCH_STATUS[selected.status].label}</Badge>
                </div>
              </div>
              <div>
                <div className="meta-label">Vehículo</div>
                <div className="meta-value">{selected.vehicle || '—'}</div>
              </div>
              <div>
                <div className="meta-label">Conductor</div>
                <div className="meta-value">{selected.driver || '—'}</div>
              </div>
              <div>
                <div className="meta-label">Destino</div>
                <div className="meta-value">{selected.destination || '—'}</div>
              </div>
              <div>
                <div className="meta-label">Creado</div>
                <div className="meta-value">{dateTime(selected.createdAt)}</div>
              </div>
              <div>
                <div className="meta-label">Valor</div>
                <div className="meta-value">{money(detailTotals.value)}</div>
              </div>
            </div>

            {selected.status === 'despachado' && (
              <div className="scan-feedback ok">
                <CheckCircle2 size={16} /> Despacho confirmado. Las salidas de inventario ya fueron registradas.
              </div>
            )}
            {selected.status === 'anulado' && (
              <div className="scan-feedback err">
                <XCircle size={16} /> Despacho anulado. No genera movimientos de inventario.
              </div>
            )}

            <div className="row-between">
              <div className="meta-label">Picking</div>
              <span className="small faint">
                {draftItems.filter((i) => i.pickedQty > 0).length} de {draftItems.length} líneas con cantidad
              </span>
            </div>

            <div style={{ display: 'grid', gap: 10 }}>
              {draftItems.map((item, index) => {
                const product = products.find((p) => p.id === item.productId);
                const available = product?.stock ?? 0;
                const disabled = selected.status === 'despachado' || selected.status === 'anulado';
                return (
                  <div
                    key={`${item.productId}-${index}`}
                    style={{
                      border: '1px solid var(--line)',
                      borderRadius: 11,
                      padding: 12,
                      display: 'grid',
                      gap: 10,
                      background: 'var(--surface-2)',
                    }}
                  >
                    <div className="row-between" style={{ alignItems: 'flex-start' }}>
                      <div style={{ minWidth: 0 }}>
                        <div className="bold">{item.name}</div>
                        <div className="small faint">
                          {item.sku} · solicitado {fmtQty(item.requestedQty)} {item.uom} · disponible {fmtQty(available)}
                        </div>
                      </div>
                      <Badge tone={item.pickedQty > 0 ? 'ok' : 'muted'} dot>
                        {item.pickedQty > 0 ? 'Pickeado' : 'Pendiente'}
                      </Badge>
                    </div>

                    <div className="field-row">
                      <Field label="Lote">
                        <Input
                          value={item.lotCode ?? ''}
                          onChange={(e) => patchDraft(index, { lotCode: e.target.value.toUpperCase() || undefined })}
                          placeholder="Lote"
                          className="mono"
                          disabled={disabled}
                        />
                      </Field>
                      <Field label="Cantidad pickeada">
                        <Input
                          type="number"
                          min={0}
                          value={item.pickedQty || ''}
                          onChange={(e) => patchDraft(index, { pickedQty: Number(e.target.value) || 0 })}
                          disabled={disabled}
                        />
                      </Field>
                    </div>
                  </div>
                );
              })}
            </div>

            {!canConfirm && selected.status !== 'despachado' && selected.status !== 'anulado' && (
              <div className="small muted">
                Para confirmar, todas las líneas deben tener la cantidad pickeada exacta. El sistema valida stock
                disponible y lote no bloqueado por PNC.
              </div>
            )}

            <div className="row-between" style={{ borderTop: '1px dashed var(--line-strong)', paddingTop: 12 }}>
              <span className="bold">Total solicitado</span>
              <span className="bold">{fmtQty(detailTotals.requested)} und</span>
            </div>
            <div className="row-between">
              <span className="muted small">Total pickeado</span>
              <span className="bold">{fmtQty(detailTotals.units)} und</span>
            </div>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={cancelOpen}
        title="Anular despacho"
        message="El despacho quedará anulado y no podrá confirmarse. Indique el motivo."
        confirmLabel="Anular despacho"
        tone="danger"
        withReason
        reasonLabel="Motivo de anulación"
        busy={busy}
        onConfirm={doCancel}
        onCancel={() => setCancelOpen(false)}
      />
    </>
  );
}

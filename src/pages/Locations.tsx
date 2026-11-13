import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  ArrowLeftRight,
  Boxes,
  CheckCircle2,
  Layers,
  MapPin,
  Plus,
  Warehouse,
} from 'lucide-react';
import { db } from '../db/schema';
import { useApp } from '../context/AppContext';
import { dateTime, qty as fmtQty } from '../domain/format';
import { createLocation, ensureBaseLocations, occupancyRows, transferStock, updateLocation } from '../domain/warehouse';
import { LOCATION_TYPES } from '../domain/types';
import type { LocationType, WarehouseLocation } from '../domain/types';
import {
  Badge,
  Button,
  Card,
  CardHead,
  EmptyRow,
  Field,
  Input,
  Modal,
  PageHeader,
  Progress,
  SearchInput,
  Select,
  StatCard,
  Textarea,
} from '../components/ui';

interface LocationForm {
  code: string;
  name: string;
  type: LocationType;
  zone: string;
  capacity: string;
  notes: string;
  status: WarehouseLocation['status'];
}

const EMPTY_LOCATION: LocationForm = {
  code: '',
  name: '',
  type: 'rack',
  zone: 'Almacén',
  capacity: '0',
  notes: '',
  status: 'activa',
};

interface TransferForm {
  productId: string;
  qty: string;
  fromLocationId: string;
  toLocationId: string;
  lotCode: string;
  notes: string;
}

export function Locations() {
  const { user, toast } = useApp();
  const locations = useLiveQuery(() => db.locations.toArray(), []) ?? [];
  const stock = useLiveQuery(() => db.locationStock.toArray(), []) ?? [];
  const products = useLiveQuery(() => db.products.toArray(), []) ?? [];
  const transfers = useLiveQuery(() => db.transfers.toArray(), []) ?? [];

  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | LocationType>('all');
  const [locOpen, setLocOpen] = useState(false);
  const [editing, setEditing] = useState<WarehouseLocation | null>(null);
  const [form, setForm] = useState<LocationForm>(EMPTY_LOCATION);
  const [transferOpen, setTransferOpen] = useState(false);
  const [transfer, setTransfer] = useState<TransferForm>({
    productId: '',
    qty: '',
    fromLocationId: '',
    toLocationId: '',
    lotCode: '',
    notes: '',
  });
  const [busy, setBusy] = useState(false);

  const set = <K extends keyof LocationForm>(key: K, value: LocationForm[K]) =>
    setForm((f) => ({ ...f, [key]: value }));
  const setTransferField = <K extends keyof TransferForm>(key: K, value: TransferForm[K]) =>
    setTransfer((f) => ({ ...f, [key]: value }));

  const occupancy = useMemo(() => occupancyRows(locations, stock, products), [locations, stock, products]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return occupancy.filter((row) => {
      if (typeFilter !== 'all' && row.location.type !== typeFilter) return false;
      if (!term) return true;
      return (
        row.location.code.toLowerCase().includes(term) ||
        row.location.name.toLowerCase().includes(term) ||
        row.location.zone.toLowerCase().includes(term) ||
        row.products.some(
          (p) => p.product.sku.toLowerCase().includes(term) || p.product.name.toLowerCase().includes(term),
        )
      );
    });
  }, [occupancy, search, typeFilter]);

  const usedLocations = occupancy.filter((r) => r.used > 0.0001).length;
  const storedReferences = new Set(stock.filter((s) => s.qty > 0.0001).map((s) => s.productId)).size;
  const totalUnits = stock.reduce((a, s) => a + Math.max(0, s.qty), 0);
  const recentTransfers = transfers.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 8);

  const activeProducts = products.filter((p) => p.status === 'activo');
  const activeLocations = locations.filter((l) => l.status === 'activa');

  const sourceQty = useMemo(() => {
    if (!transfer.productId || !transfer.fromLocationId) return 0;
    return stock
      .filter(
        (s) =>
          s.productId === transfer.productId &&
          s.locationId === transfer.fromLocationId &&
          (!transfer.lotCode || (s.lotCode ?? '') === transfer.lotCode.trim().toUpperCase()),
      )
      .reduce((a, s) => a + Math.max(0, s.qty), 0);
  }, [stock, transfer.productId, transfer.fromLocationId, transfer.lotCode]);

  const openNew = () => {
    setEditing(null);
    setForm(EMPTY_LOCATION);
    setLocOpen(true);
  };

  const openEdit = (location: WarehouseLocation) => {
    setEditing(location);
    setForm({
      code: location.code,
      name: location.name,
      type: location.type,
      zone: location.zone,
      capacity: String(location.capacity),
      notes: location.notes,
      status: location.status,
    });
    setLocOpen(true);
  };

  const openTransfer = () => {
    const curado = locations.find((l) => l.type === 'curado');
    const pt = locations.find((l) => l.type === 'pt');
    setTransfer({
      productId: activeProducts[0]?.id ?? '',
      qty: '',
      fromLocationId: curado?.id ?? activeLocations[0]?.id ?? '',
      toLocationId: pt?.id ?? activeLocations.find((l) => l.id !== curado?.id)?.id ?? '',
      lotCode: '',
      notes: '',
    });
    setTransferOpen(true);
  };

  const createBase = async () => {
    if (!user) return;
    setBusy(true);
    try {
      const created = await ensureBaseLocations(user);
      toast(
        created > 0 ? 'Mapa 5S creado' : 'Las ubicaciones ya existen',
        created > 0 ? 'success' : 'info',
        created > 0 ? `${created} ubicaciones base disponibles.` : 'No se crearon ubicaciones duplicadas.',
      );
    } catch (error) {
      toast('No se pudo crear el mapa 5S', 'error', error instanceof Error ? error.message : undefined);
    } finally {
      setBusy(false);
    }
  };

  const saveLocation = async () => {
    if (!user) return;
    if (!form.code.trim() || !form.name.trim()) {
      toast('Datos incompletos', 'warn', 'Código y nombre son obligatorios.');
      return;
    }
    setBusy(true);
    try {
      if (editing) {
        const next = await updateLocation(
          editing.id,
          {
            code: form.code,
            name: form.name,
            type: form.type,
            zone: form.zone,
            capacity: Number(form.capacity) || 0,
            notes: form.notes,
            status: form.status,
          },
          user,
        );
        toast('Ubicación actualizada', 'success', `${next.code} · ${next.name}`);
      } else {
        const next = await createLocation(
          {
            code: form.code,
            name: form.name,
            type: form.type,
            zone: form.zone,
            capacity: Number(form.capacity) || 0,
            notes: form.notes,
          },
          user,
        );
        toast('Ubicación creada', 'success', `${next.code} · ${next.name}`);
      }
      setLocOpen(false);
    } catch (error) {
      toast('No se pudo guardar la ubicación', 'error', error instanceof Error ? error.message : undefined);
    } finally {
      setBusy(false);
    }
  };

  const saveTransfer = async () => {
    if (!user) return;
    if (!transfer.productId || !transfer.fromLocationId || !transfer.toLocationId) {
      toast('Datos incompletos', 'warn', 'Seleccione producto, ubicación origen y destino.');
      return;
    }
    setBusy(true);
    try {
      const row = await transferStock(
        {
          productId: transfer.productId,
          qty: Number(transfer.qty) || 0,
          fromLocationId: transfer.fromLocationId,
          toLocationId: transfer.toLocationId,
          lotCode: transfer.lotCode.trim().toUpperCase() || undefined,
          notes: transfer.notes,
        },
        user,
      );
      toast('Traslado registrado', 'success', `${row.code} · ${fmtQty(row.qty)} ${row.uom} · ${row.fromLocationName} → ${row.toLocationName}`);
      setTransferOpen(false);
    } catch (error) {
      toast('No se pudo trasladar', 'error', error instanceof Error ? error.message : undefined);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Ubicaciones y 5S"
        subtitle="Trazabilidad interna: curado, racks, estibas, pasillos y zona de despacho"
        actions={
          <div className="row wrap" style={{ gap: 8 }}>
            {locations.length === 0 && (
              <Button variant="secondary" icon={<Layers size={16} />} onClick={createBase} disabled={busy}>
                Crear mapa 5S base
              </Button>
            )}
            <Button variant="secondary" icon={<ArrowLeftRight size={16} />} onClick={openTransfer} disabled={activeLocations.length < 2}>
              Trasladar
            </Button>
            <Button variant="primary" icon={<Plus size={16} />} onClick={openNew}>
              Nueva ubicación
            </Button>
          </div>
        }
      />

      <div className="kpi-grid">
        <StatCard
          label="Ubicaciones"
          value={locations.length}
          icon={<MapPin size={18} />}
          tone="brand"
          foot={<span>{activeLocations.length} activas · {usedLocations} con stock</span>}
        />
        <StatCard
          label="Referencias almacenadas"
          value={storedReferences}
          icon={<Boxes size={18} />}
          tone="info"
          foot={<span>{fmtQty(totalUnits)} unidades ubicadas</span>}
        />
        <StatCard
          label="Traslados internos"
          value={transfers.length}
          icon={<ArrowLeftRight size={18} />}
          tone="ok"
          foot={<span>trazabilidad curado → PT</span>}
        />
        <StatCard
          label="Ocupación"
          value={`${occupancy.filter((r) => r.location.capacity > 0 && r.pct >= 80).length}`}
          icon={<Warehouse size={18} />}
          tone={occupancy.some((r) => r.location.capacity > 0 && r.pct >= 90) ? 'warn' : 'muted'}
          foot={<span>ubicaciones sobre 80% de capacidad</span>}
        />
      </div>

      <Card>
        <CardHead
          title="Mapa visual de ubicaciones"
          subtitle="Toque una ubicación para editarla · el color identifica el tipo 5S"
          icon={<MapPin size={18} color="var(--brand-3)" />}
          actions={
            <Badge tone="muted">
              {filtered.length} de {locations.length}
            </Badge>
          }
        />
        <div className="card-pad" style={{ display: 'grid', gap: 12 }}>
          <div className="field-row">
            <SearchInput value={search} onChange={setSearch} placeholder="Buscar código, zona, producto…" />
            <Select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value as 'all' | LocationType)}
              style={{ width: 230 }}
            >
              <option value="all">Todos los tipos</option>
              {LOCATION_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </Select>
          </div>
        </div>

        {locations.length === 0 ? (
          <div className="card-pad">
            <div
              style={{
                padding: 22,
                borderRadius: 12,
                border: '1px dashed var(--line-strong)',
                background: 'var(--surface-2)',
                display: 'grid',
                gap: 10,
                justifyItems: 'center',
                textAlign: 'center',
              }}
            >
              <Layers size={26} color="var(--brand-3)" />
              <div className="bold">Aún no hay ubicaciones configuradas</div>
              <div className="small muted" style={{ maxWidth: 420, lineHeight: 1.55 }}>
                Cree el mapa 5S base con curado, producto terminado, racks, zona de despacho y devoluciones.
                Después podrá ajustar códigos, zonas y capacidades.
              </div>
              <Button variant="primary" icon={<Layers size={16} />} onClick={createBase} disabled={busy}>
                Crear mapa 5S base
              </Button>
            </div>
          </div>
        ) : filtered.length === 0 ? (
          <div className="card-pad">
            <div className="loc-empty">Sin ubicaciones para los filtros seleccionados.</div>
          </div>
        ) : (
          <div className="card-pad">
            <div className="location-grid">
              {filtered.map((row) => {
                const meta = LOCATION_TYPES.find((t) => t.value === row.location.type);
                return (
                  <div
                    key={row.location.id}
                    className={`location-card${row.location.status === 'inactiva' ? ' inactive' : ''}`}
                    onClick={() => openEdit(row.location)}
                    style={{ borderTopColor: meta?.color, borderTopWidth: 3 }}
                  >
                    <div className="loc-top">
                      <div style={{ minWidth: 0 }}>
                        <div className="loc-code" style={{ color: meta?.color }}>{row.location.code}</div>
                        <div className="bold" style={{ marginTop: 2 }}>{row.location.name}</div>
                        <div className="loc-zone">{row.location.zone}</div>
                      </div>
                      <Badge tone={row.location.status === 'activa' ? 'ok' : 'muted'}>
                        {row.location.status}
                      </Badge>
                    </div>

                    <div className="row-between small">
                      <span className="muted">{meta?.label ?? row.location.type}</span>
                      <span className="bold">{fmtQty(row.used)} und</span>
                    </div>
                    {row.location.capacity > 0 ? (
                      <div>
                        <Progress
                          value={Math.min(100, row.pct)}
                          color={row.pct >= 90 ? 'var(--danger)' : row.pct >= 80 ? 'var(--warn)' : meta?.color}
                        />
                        <div className="small faint" style={{ marginTop: 3 }}>
                          {row.pct}% de {fmtQty(row.location.capacity)} und
                        </div>
                      </div>
                    ) : (
                      <div className="small faint">Sin capacidad definida</div>
                    )}

                    {row.products.length === 0 ? (
                      <div className="loc-empty">Ubicación libre</div>
                    ) : (
                      <div className="loc-products">
                        {row.products.slice(0, 4).map((p, index) => (
                          <div className="loc-product" key={`${p.product.id}-${p.lotCode ?? index}`}>
                            <span className="truncate">
                              {p.product.sku}
                              {p.lotCode ? <span className="faint"> · {p.lotCode}</span> : null}
                            </span>
                            <strong>{fmtQty(p.qty)}</strong>
                          </div>
                        ))}
                        {row.products.length > 4 && (
                          <div className="small faint">+{row.products.length - 4} referencia(s) más</div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </Card>

      <Card>
        <CardHead
          title="Traslados internos recientes"
          subtitle="Movimientos entre curado, racks, estibas y producto terminado"
          icon={<ArrowLeftRight size={18} color="var(--brand-3)" />}
          actions={
            <Button size="sm" variant="secondary" icon={<ArrowLeftRight size={14} />} onClick={openTransfer} disabled={activeLocations.length < 2}>
              Nuevo traslado
            </Button>
          }
        />
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Traslado</th>
                <th>Producto</th>
                <th>Origen</th>
                <th>Destino</th>
                <th className="num">Cantidad</th>
                <th>Lote</th>
                <th>Responsable</th>
                <th>Fecha</th>
              </tr>
            </thead>
            <tbody>
              {recentTransfers.length === 0 ? (
                <EmptyRow colSpan={8} message="Sin traslados registrados. Use “Trasladar” para mover stock entre ubicaciones." />
              ) : (
                recentTransfers.map((t) => (
                  <tr key={t.id}>
                    <td className="mono strong">{t.code}</td>
                    <td>
                      <div className="cell-main">
                        <span className="name">{t.productName}</span>
                        <span className="sku">{t.productSku}</span>
                      </div>
                    </td>
                    <td className="small">{t.fromLocationName}</td>
                    <td className="small">{t.toLocationName}</td>
                    <td className="num strong">{fmtQty(t.qty)} <span className="faint">{t.uom}</span></td>
                    <td className="small mono">{t.lotCode ?? '—'}</td>
                    <td className="small muted">{t.userName}</td>
                    <td className="small muted">{dateTime(t.createdAt)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="table-foot">
          <span>
            <CheckCircle2 size={13} style={{ verticalAlign: -2, marginRight: 4 }} />
            Los traslados actualizan el stock por ubicación y mantienen el saldo total del producto.
          </span>
        </div>
      </Card>

      <Modal
        open={locOpen}
        onClose={() => setLocOpen(false)}
        title={editing ? 'Editar ubicación' : 'Nueva ubicación'}
        subtitle="Codificación 5S: tipo, zona y capacidad visual"
        footer={
          <>
            <Button variant="ghost" onClick={() => setLocOpen(false)} disabled={busy}>
              Cancelar
            </Button>
            <Button variant="primary" onClick={saveLocation} disabled={busy}>
              {busy ? <span className="spinner" /> : null} Guardar ubicación
            </Button>
          </>
        }
      >
        <div className="form-grid">
          <div className="field-row">
            <Field label="Código *">
              <Input value={form.code} onChange={(e) => set('code', e.target.value.toUpperCase())} placeholder="RACK-A1" className="mono" />
            </Field>
            <Field label="Nombre *">
              <Input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Rack A1" />
            </Field>
          </div>
          <div className="field-row">
            <Field label="Tipo 5S">
              <Select value={form.type} onChange={(e) => set('type', e.target.value as LocationType)}>
                {LOCATION_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Zona">
              <Input value={form.zone} onChange={(e) => set('zone', e.target.value)} placeholder="Planta, Almacén, Andén…" />
            </Field>
          </div>
          <div className="field-row">
            <Field label="Capacidad (unidades)" hint="0 = sin límite visual">
              <Input type="number" min={0} value={form.capacity} onChange={(e) => set('capacity', e.target.value)} />
            </Field>
            <Field label="Estado">
              <Select value={form.status} onChange={(e) => set('status', e.target.value as WarehouseLocation['status'])}>
                <option value="activa">Activa</option>
                <option value="inactiva">Inactiva</option>
              </Select>
            </Field>
          </div>
          <Field label="Notas">
            <Textarea value={form.notes} onChange={(e) => set('notes', e.target.value)} placeholder="Pasillo, restricciones, señalización…" />
          </Field>
        </div>
      </Modal>

      <Modal
        open={transferOpen}
        onClose={() => setTransferOpen(false)}
        title="Traslado interno de stock"
        subtitle="Curado → PT, PT → rack, rack → despacho o devoluciones"
        footer={
          <>
            <Button variant="ghost" onClick={() => setTransferOpen(false)} disabled={busy}>
              Cancelar
            </Button>
            <Button variant="primary" onClick={saveTransfer} disabled={busy}>
              {busy ? <span className="spinner" /> : null} Registrar traslado
            </Button>
          </>
        }
      >
        <div className="form-grid">
          <Field label="Producto *">
            <Select value={transfer.productId} onChange={(e) => setTransferField('productId', e.target.value)}>
              <option value="">Seleccione…</option>
              {activeProducts.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.sku} · {p.name} ({fmtQty(p.stock)} {p.uom})
                </option>
              ))}
            </Select>
          </Field>
          <div className="field-row">
            <Field label="Ubicación origen *">
              <Select value={transfer.fromLocationId} onChange={(e) => setTransferField('fromLocationId', e.target.value)}>
                <option value="">Seleccione…</option>
                {activeLocations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.code} · {l.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Ubicación destino *">
              <Select value={transfer.toLocationId} onChange={(e) => setTransferField('toLocationId', e.target.value)}>
                <option value="">Seleccione…</option>
                {activeLocations
                  .filter((l) => l.id !== transfer.fromLocationId)
                  .map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.code} · {l.name}
                    </option>
                  ))}
              </Select>
            </Field>
          </div>
          <div className="field-row">
            <Field label="Cantidad *" hint={`Disponible en origen: ${fmtQty(sourceQty)}`}>
              <Input type="number" min={0} value={transfer.qty} onChange={(e) => setTransferField('qty', e.target.value)} placeholder="0" />
            </Field>
            <Field label="Lote (opcional)" hint="Vacío = FIFO entre lotes del origen">
              <Input value={transfer.lotCode} onChange={(e) => setTransferField('lotCode', e.target.value.toUpperCase())} placeholder="L-20260101-T1-INY01" className="mono" />
            </Field>
          </div>
          <Field label="Notas">
            <Textarea value={transfer.notes} onChange={(e) => setTransferField('notes', e.target.value)} placeholder="Motivo del traslado, operador, observaciones…" />
          </Field>
        </div>
      </Modal>
    </>
  );
}

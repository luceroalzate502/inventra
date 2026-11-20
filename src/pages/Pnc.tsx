import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  FileWarning,
  Plus,
  ShieldAlert,
  Sparkles,
} from 'lucide-react';
import { db } from '../db/schema';
import { useApp } from '../context/AppContext';
import { dateTime, money, qty as fmtQty } from '../domain/format';
import { analyzePnc, closePnc, createPnc, pncByDefect, pncSummary, segregatePnc } from '../domain/pnc';
import { DEFECT_TYPES, PNC_STATUS, ROOT_CAUSES, shiftsFromSettings } from '../domain/types';
import type { DefectType, NonConformity, PncStatus, Shift } from '../domain/types';
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
  SearchInput,
  Select,
  StatCard,
  Textarea,
} from '../components/ui';
import { HBars } from '../components/charts';

interface PncForm {
  date: string;
  productId: string;
  lotCode: string;
  qty: string;
  defectType: DefectType;
  source: NonConformity['source'];
  machineId: string;
  shift: string;
  containment: string;
  notes: string;
}

interface KaizenForm {
  rootCause: string;
  rootCauseDetail: string;
  correctiveAction: string;
  responsible: string;
  kaizenNotes: string;
}

const today = () => {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
};

const emptyForm = (): PncForm => ({
  date: today(),
  productId: '',
  lotCode: '',
  qty: '',
  defectType: 'rechupado',
  source: 'produccion',
  machineId: '',
  shift: '',
  containment: 'Lote segregado y bloqueado para despacho.',
  notes: '',
});

const emptyKaizen = (): KaizenForm => ({
  rootCause: '',
  rootCauseDetail: '',
  correctiveAction: '',
  responsible: '',
  kaizenNotes: '',
});

export function Pnc() {
  const { user, toast, settings } = useApp();
  const pncs = useLiveQuery(() => db.pnc.toArray(), []) ?? [];
  const products = useLiveQuery(() => db.products.toArray(), []) ?? [];
  const machines = useLiveQuery(() => db.machines.toArray(), []) ?? [];

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | PncStatus>('all');
  const [newOpen, setNewOpen] = useState(false);
  const [form, setForm] = useState<PncForm>(emptyForm);
  const [detailOpen, setDetailOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [kaizen, setKaizen] = useState<KaizenForm>(emptyKaizen);
  const [disposition, setDisposition] = useState<'cerrado' | 'reprocesado' | 'desechado'>('cerrado');
  const [closeNotes, setCloseNotes] = useState('');
  const [busy, setBusy] = useState(false);

  const activeProducts = products.filter((p) => p.status === 'activo');
  const selected = pncs.find((p) => p.id === selectedId) ?? null;

  const set = <K extends keyof PncForm>(key: K, value: PncForm[K]) =>
    setForm((f) => ({ ...f, [key]: value }));
  const setKaizenField = <K extends keyof KaizenForm>(key: K, value: KaizenForm[K]) =>
    setKaizen((f) => ({ ...f, [key]: value }));

  const summary = useMemo(() => pncSummary(pncs), [pncs]);
  const defectRows = useMemo(
    () =>
      pncByDefect(pncs, products)
        .map((row) => ({
          label: DEFECT_TYPES.find((d) => d.value === row.type)?.label ?? row.type,
          value: row.qty,
          extra: `${row.count} caso(s) · ${money(row.cost)}`,
        }))
        .sort((a, b) => b.value - a.value),
    [pncs, products],
  );

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return pncs
      .filter((p) => (statusFilter === 'all' ? true : p.status === statusFilter))
      .filter(
        (p) =>
          !term ||
          p.code.toLowerCase().includes(term) ||
          p.productSku.toLowerCase().includes(term) ||
          p.productName.toLowerCase().includes(term) ||
          p.lotCode.toLowerCase().includes(term),
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [pncs, search, statusFilter]);

  const openDetail = (pnc: NonConformity) => {
    setSelectedId(pnc.id);
    setKaizen({
      rootCause: pnc.rootCause,
      rootCauseDetail: pnc.rootCauseDetail,
      correctiveAction: pnc.correctiveAction,
      responsible: pnc.responsible,
      kaizenNotes: pnc.kaizenNotes,
    });
    setDisposition('cerrado');
    setCloseNotes('');
    setDetailOpen(true);
  };

  const saveNew = async () => {
    if (!user) return;
    if (!form.productId || !form.lotCode.trim() || Number(form.qty) <= 0) {
      toast('Datos incompletos', 'warn', 'Seleccione producto, lote y cantidad no conforme.');
      return;
    }
    setBusy(true);
    try {
      const pnc = await createPnc(
        {
          date: form.date,
          productId: form.productId,
          lotCode: form.lotCode,
          qty: Number(form.qty) || 0,
          defectType: form.defectType,
          source: form.source,
          machineId: form.machineId || undefined,
          shift: form.shift ? (Number(form.shift) as Shift) : undefined,
          containment: form.containment,
          notes: form.notes,
          status: 'segregado',
        },
        user,
      );
      toast('PNC creado y lote bloqueado', 'success', `${pnc.code} · lote ${pnc.lotCode}`);
      setNewOpen(false);
      setForm(emptyForm());
      openDetail(pnc);
    } catch (error) {
      toast('No se pudo crear el PNC', 'error', error instanceof Error ? error.message : undefined);
    } finally {
      setBusy(false);
    }
  };

  const segregate = async () => {
    if (!user || !selected) return;
    setBusy(true);
    try {
      const next = await segregatePnc(selected.id, user, kaizen.kaizenNotes);
      toast('PNC segregado', 'success', `${next.code} · lote ${next.lotCode} bloqueado`);
    } catch (error) {
      toast('No se pudo segregar', 'error', error instanceof Error ? error.message : undefined);
    } finally {
      setBusy(false);
    }
  };

  const saveKaizen = async () => {
    if (!user || !selected) return;
    setBusy(true);
    try {
      const next = await analyzePnc(selected.id, kaizen, user);
      toast('Análisis Kaizen guardado', 'success', `${next.code} · causa: ${next.rootCause}`);
    } catch (error) {
      toast('No se pudo guardar el análisis', 'error', error instanceof Error ? error.message : undefined);
    } finally {
      setBusy(false);
    }
  };

  const close = async () => {
    if (!user || !selected) return;
    setBusy(true);
    try {
      const next = await closePnc(selected.id, disposition, closeNotes, user);
      toast('PNC cerrado', 'success', `${next.code} · ${PNC_STATUS[next.status].label}`);
      setCloseNotes('');
      setDetailOpen(false);
    } catch (error) {
      toast('No se pudo cerrar el PNC', 'error', error instanceof Error ? error.message : undefined);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Producto no conforme y Kaizen"
        subtitle="Segregación de lotes, bloqueo de despacho y análisis de causa raíz"
        actions={
          <Button variant="primary" icon={<Plus size={16} />} onClick={() => setNewOpen(true)}>
            Registrar PNC
          </Button>
        }
      />

      <div className="kpi-grid">
        <StatCard
          label="PNC registrados"
          value={summary.total}
          icon={<FileWarning size={18} />}
          tone="brand"
          foot={<span>{summary.open} abiertos o en análisis</span>}
        />
        <StatCard
          label="Lotes bloqueados"
          value={summary.blocked}
          icon={<ShieldAlert size={18} />}
          tone={summary.blocked > 0 ? 'danger' : 'ok'}
          foot={<span>no despachables hasta cierre</span>}
        />
        <StatCard
          label="Unidades no conformes"
          value={fmtQty(summary.qty)}
          icon={<AlertTriangle size={18} />}
          tone={summary.qty > 0 ? 'warn' : 'ok'}
          foot={<span>acumulado histórico</span>}
        />
        <StatCard
          label="Costo no conforme"
          value={money(summary.cost)}
          icon={<ClipboardCheck size={18} />}
          tone="info"
          foot={<span>valorizado al costo estándar</span>}
        />
      </div>

      <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1.6fr) minmax(280px, 1fr)' }}>
        <Card>
          <CardHead
            title="Registros PNC"
            subtitle="Toque un registro para segregar, analizar causa raíz o cerrar"
            icon={<FileWarning size={18} color="var(--brand-3)" />}
            actions={
              <div className="row" style={{ gap: 8 }}>
                <SearchInput value={search} onChange={setSearch} placeholder="Buscar código, lote o producto…" />
                <Select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value as 'all' | PncStatus)}
                  style={{ width: 170 }}
                >
                  <option value="all">Todos</option>
                  {Object.entries(PNC_STATUS).map(([value, meta]) => (
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
                  <th>PNC</th>
                  <th>Producto / lote</th>
                  <th>Defecto</th>
                  <th className="num">Cantidad</th>
                  <th className="num">Costo</th>
                  <th>Fuente</th>
                  <th>Estado</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <EmptyRow colSpan={8} message="Sin registros PNC para los filtros seleccionados." />
                ) : (
                  filtered.map((pnc) => {
                    const defect = DEFECT_TYPES.find((d) => d.value === pnc.defectType);
                    return (
                      <tr key={pnc.id} style={{ cursor: 'pointer' }} onClick={() => openDetail(pnc)}>
                        <td>
                          <div className="cell-main">
                            <span className="name mono">{pnc.code}</span>
                            <span className="sku">{pnc.date}</span>
                          </div>
                        </td>
                        <td>
                          <div className="cell-main">
                            <span className="name">{pnc.productName}</span>
                            <span className="sku">
                              {pnc.productSku} · lote <span className="mono">{pnc.lotCode}</span>
                            </span>
                          </div>
                        </td>
                        <td>
                          <Badge tone="warn">{defect?.label ?? pnc.defectType}</Badge>
                        </td>
                        <td className="num strong">{fmtQty(pnc.qty)}</td>
                        <td className="num">{money(pnc.qty * pnc.unitCost)}</td>
                        <td className="small muted">{pnc.source}</td>
                        <td>
                          <Badge tone={PNC_STATUS[pnc.status].tone} dot>
                            {PNC_STATUS[pnc.status].label}
                          </Badge>
                        </td>
                        <td>
                          <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); openDetail(pnc); }}>
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
          <div className="table-foot">
            <span>
              <ShieldAlert size={13} style={{ verticalAlign: -2, marginRight: 4 }} />
              Un PNC segregado bloquea el lote: no se puede despachar ni recibir hasta que se cierre o reprocese.
            </span>
          </div>
        </Card>

        <div style={{ display: 'grid', gap: 16, alignContent: 'start' }}>
          <Card>
            <CardHead title="Defectos más frecuentes" subtitle="Unidades no conformes por tipo" icon={<AlertTriangle size={18} color="var(--brand-3)" />} />
            <div className="card-pad">
              {defectRows.length === 0 ? (
                <div className="loc-empty">Sin defectos registrados.</div>
              ) : (
                <HBars rows={defectRows} color="var(--warn)" formatValue={(n) => `${fmtQty(n)} und`} />
              )}
            </div>
          </Card>

          <Card>
            <CardHead title="Flujo Kaizen" subtitle="Contención → causa raíz → acción → cierre" icon={<Sparkles size={18} color="var(--brand-3)" />} />
            <div className="card-pad" style={{ display: 'grid', gap: 12 }}>
              {[
                { title: '1. Contener y segregar', text: 'Bloquear el lote y evitar que llegue al cliente.' },
                { title: '2. Analizar causa raíz', text: 'Máquina, molde, material, método, mano de obra o medición.' },
                { title: '3. Acción correctiva', text: 'Responsable y fecha de implementación.' },
                { title: '4. Verificar y cerrar', text: 'Reprocesar, desechar o liberar con evidencia.' },
              ].map((step) => (
                <div key={step.title} className="row" style={{ alignItems: 'flex-start', gap: 10 }}>
                  <CheckCircle2 size={16} color="var(--brand-2)" style={{ marginTop: 2, flexShrink: 0 }} />
                  <div>
                    <div className="bold small">{step.title}</div>
                    <div className="small muted">{step.text}</div>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>

      {/* -------------------------------- Nuevo PNC ------------------------------- */}
      <Modal
        open={newOpen}
        onClose={() => setNewOpen(false)}
        title="Registrar producto no conforme"
        subtitle="El lote se segrega y bloquea automáticamente"
        footer={
          <>
            <Button variant="ghost" onClick={() => setNewOpen(false)} disabled={busy}>
              Cancelar
            </Button>
            <Button variant="primary" icon={<ShieldAlert size={16} />} onClick={saveNew} disabled={busy}>
              {busy ? <span className="spinner" /> : null} Crear y bloquear lote
            </Button>
          </>
        }
      >
        <div className="form-grid">
          <div className="field-row">
            <Field label="Producto *">
              <Select value={form.productId} onChange={(e) => set('productId', e.target.value)}>
                <option value="">Seleccione…</option>
                {activeProducts.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.sku} · {p.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Lote *" hint="El lote quedará bloqueado para despacho">
              <Input value={form.lotCode} onChange={(e) => set('lotCode', e.target.value.toUpperCase())} placeholder="L-20260101-T1-INY01" className="mono" />
            </Field>
          </div>
          <div className="field-row-3">
            <Field label="Cantidad *">
              <Input type="number" min={0} value={form.qty} onChange={(e) => set('qty', e.target.value)} placeholder="0" />
            </Field>
            <Field label="Defecto">
              <Select value={form.defectType} onChange={(e) => set('defectType', e.target.value as DefectType)}>
                {DEFECT_TYPES.map((d) => (
                  <option key={d.value} value={d.value}>
                    {d.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Fecha">
              <Input type="date" value={form.date} onChange={(e) => set('date', e.target.value)} />
            </Field>
          </div>
          <div className="field-row-3">
            <Field label="Fuente">
              <Select value={form.source} onChange={(e) => set('source', e.target.value as NonConformity['source'])}>
                <option value="produccion">Producción</option>
                <option value="almacen">Almacén</option>
                <option value="cliente">Cliente / devolución</option>
                <option value="inspeccion">Inspección</option>
              </Select>
            </Field>
            <Field label="Máquina (opcional)">
              <Select value={form.machineId} onChange={(e) => set('machineId', e.target.value)}>
                <option value="">Sin máquina</option>
                {machines.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.code} · {m.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Turno (opcional)">
              <Select value={form.shift} onChange={(e) => set('shift', e.target.value)}>
                <option value="">Sin turno</option>
                {shiftsFromSettings(settings).map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Field label="Contención inmediata">
            <Textarea value={form.containment} onChange={(e) => set('containment', e.target.value)} />
          </Field>
          <Field label="Notas / observaciones">
            <Textarea value={form.notes} onChange={(e) => set('notes', e.target.value)} placeholder="Descripción del defecto, piezas afectadas, evidencia…" />
          </Field>
        </div>
      </Modal>

      {/* ------------------------------- Detalle PNC ------------------------------ */}
      <Modal
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
        title={selected ? `PNC ${selected.code}` : 'PNC'}
        subtitle={selected ? `${selected.productName} · lote ${selected.lotCode}` : undefined}
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => setDetailOpen(false)} disabled={busy}>
              Cerrar
            </Button>
            {selected && !['cerrado', 'reprocesado', 'desechado'].includes(selected.status) && (
              <>
                <Button variant="secondary" icon={<ShieldAlert size={16} />} onClick={segregate} disabled={busy}>
                  Segregar lote
                </Button>
                <Button variant="primary" icon={<Sparkles size={16} />} onClick={saveKaizen} disabled={busy}>
                  {busy ? <span className="spinner" /> : null} Guardar Kaizen
                </Button>
              </>
            )}
          </>
        }
      >
        {!selected ? (
          <div className="loc-empty">Seleccione un PNC.</div>
        ) : (
          <div className="form-grid">
            <div className="meta-grid">
              <div>
                <div className="meta-label">Estado</div>
                <div className="meta-value">
                  <Badge tone={PNC_STATUS[selected.status].tone} dot>{PNC_STATUS[selected.status].label}</Badge>
                </div>
              </div>
              <div>
                <div className="meta-label">Defecto</div>
                <div className="meta-value">{DEFECT_TYPES.find((d) => d.value === selected.defectType)?.label ?? selected.defectType}</div>
              </div>
              <div>
                <div className="meta-label">Cantidad</div>
                <div className="meta-value">{fmtQty(selected.qty)} und</div>
              </div>
              <div>
                <div className="meta-label">Costo</div>
                <div className="meta-value">{money(selected.qty * selected.unitCost)}</div>
              </div>
              <div>
                <div className="meta-label">Fuente</div>
                <div className="meta-value">{selected.source}</div>
              </div>
              <div>
                <div className="meta-label">Registrado</div>
                <div className="meta-value">{dateTime(selected.createdAt)}</div>
              </div>
            </div>

            <div className="scan-feedback err">
              <ShieldAlert size={16} /> {selected.containment}
            </div>

            <div className="meta-label">Análisis Kaizen · causa raíz y acción correctiva</div>
            <div className="field-row">
              <Field label="Causa raíz (Ishikawa)">
                <Select value={kaizen.rootCause} onChange={(e) => setKaizenField('rootCause', e.target.value)}>
                  <option value="">Seleccione…</option>
                  {ROOT_CAUSES.map((cause) => (
                    <option key={cause} value={cause}>
                      {cause}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Responsable">
                <Input value={kaizen.responsible} onChange={(e) => setKaizenField('responsible', e.target.value)} placeholder="Nombre / cargo" />
              </Field>
            </div>
            <Field label="Detalle de la causa">
              <Textarea
                value={kaizen.rootCauseDetail}
                onChange={(e) => setKaizenField('rootCauseDetail', e.target.value)}
                placeholder="¿Por qué ocurrió? Use los 5 porqués…"
              />
            </Field>
            <Field label="Acción correctiva *" hint="Mínimo 8 caracteres">
              <Textarea
                value={kaizen.correctiveAction}
                onChange={(e) => setKaizenField('correctiveAction', e.target.value)}
                placeholder="Ajuste de parámetros, cambio de molde, capacitación, inspección…"
              />
            </Field>
            <Field label="Notas Kaizen">
              <Textarea
                value={kaizen.kaizenNotes}
                onChange={(e) => setKaizenField('kaizenNotes', e.target.value)}
                placeholder="Lecciones aprendidas, verificación de eficacia…"
              />
            </Field>

            {!['cerrado', 'reprocesado', 'desechado'].includes(selected.status) && (
              <>
                <div className="meta-label" style={{ borderTop: '1px dashed var(--line-strong)', paddingTop: 12 }}>
                  Cierre y disposición final
                </div>
                <div className="field-row">
                  <Field label="Disposición">
                    <Select value={disposition} onChange={(e) => setDisposition(e.target.value as 'cerrado' | 'reprocesado' | 'desechado')}>
                      <option value="cerrado">Cerrar con evidencia</option>
                      <option value="reprocesado">Reprocesado (libera lote)</option>
                      <option value="desechado">Desechado / scrap</option>
                    </Select>
                  </Field>
                  <Field label="Nota de cierre *">
                    <Input value={closeNotes} onChange={(e) => setCloseNotes(e.target.value)} placeholder="Disposición, cantidad final, evidencia…" />
                  </Field>
                </div>
                <Button variant="danger" icon={<CheckCircle2 size={16} />} onClick={close} disabled={busy || !closeNotes.trim()}>
                  Cerrar PNC
                </Button>
              </>
            )}

            {selected.closedAt && (
              <div className="scan-feedback ok">
                <CheckCircle2 size={16} /> Cerrado el {dateTime(selected.closedAt)} · {selected.disposition}
              </div>
            )}
          </div>
        )}
      </Modal>
    </>
  );
}

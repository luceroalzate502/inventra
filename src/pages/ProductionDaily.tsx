import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  Factory,
  Gauge,
  Minus,
  Package,
  Plus,
  Save,
  Zap,
} from 'lucide-react';
import { db } from '../db/schema';
import { useApp } from '../context/AppContext';
import { dateTime, pct, qty as fmtQty } from '../domain/format';
import {
  createProductionRecord,
  recordMetrics,
  summarize,
  summarizeByShift,
  todayKey,
  validateProductionRecord,
} from '../domain/productionDaily';
import { MACHINE_TYPES, SCRAP_REASONS, buildShifts, DEFAULT_SHIFT_MINUTES, DEFAULT_SHIFT_START_HOUR, shiftLabel } from '../domain/types';
import type { Machine, ProductionRecord, Shift } from '../domain/types';
import {
  Badge,
  Button,
  Card,
  CardHead,
  EmptyRow,
  Field,
  Input,
  PageHeader,
  Progress,
  Select,
  StatCard,
  Textarea,
  cx,
} from '../components/ui';

const currentShift = (): Shift => {
  const h = new Date().getHours();
  if (h >= 6 && h < 12) return 1;
  if (h >= 12 && h < 18) return 2;
  if (h >= 18) return 3;
  return 4;
};

function NumberStepper({
  value,
  onChange,
  step = 1,
  min = 0,
  suffix,
}: {
  value: string;
  onChange: (v: string) => void;
  step?: number;
  min?: number;
  suffix?: string;
}) {
  const num = Number(value) || 0;
  const bump = (delta: number) => onChange(String(Math.max(min, num + delta)));
  return (
    <div className="stepper">
      <button type="button" onClick={() => bump(-step)} aria-label="Restar">
        <Minus size={18} />
      </button>
      <div className="stepper-input">
        <input
          type="number"
          min={min}
          step={step}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          inputMode="decimal"
        />
        {suffix && <span>{suffix}</span>}
      </div>
      <button type="button" onClick={() => bump(step)} aria-label="Sumar">
        <Plus size={18} />
      </button>
    </div>
  );
}

export function ProductionDaily() {
  const { user, toast, settings } = useApp();
  const [date, setDate] = useState(todayKey());
  const [shift, setShift] = useState<Shift>(currentShift());
  const [machineId, setMachineId] = useState('');
  const [productId, setProductId] = useState('');
  const [orderId, setOrderId] = useState('');
  const [plannedQty, setPlannedQty] = useState('1000');
  const [goodQty, setGoodQty] = useState('');
  const [scrapQty, setScrapQty] = useState('');
  const [shots, setShots] = useState('');
  const [cavities, setCavities] = useState('8');
  const [plannedMinutes, setPlannedMinutes] = useState(String(settings?.shiftDurationMinutes ?? DEFAULT_SHIFT_MINUTES));
  const [downtimeMinutes, setDowntimeMinutes] = useState('0');
  const [idealCycleSeconds, setIdealCycleSeconds] = useState('18');
  const [scrapReason, setScrapReason] = useState(SCRAP_REASONS[0]);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  const machines = useLiveQuery(() => db.machines.toArray(), []) ?? [];
  const products = useLiveQuery(() => db.products.toArray(), []) ?? [];
  const orders = useLiveQuery(() => db.productionOrders.toArray(), []) ?? [];
  const records = useLiveQuery(() => db.productionRecords.toArray(), []) ?? [];

  const shifts = useMemo(
    () =>
      buildShifts(
        settings?.shiftDurationMinutes ?? DEFAULT_SHIFT_MINUTES,
        settings?.shiftStartHour ?? DEFAULT_SHIFT_START_HOUR,
      ),
    [settings?.shiftDurationMinutes, settings?.shiftStartHour],
  );

  const activeMachines = machines.filter((m) => m.status === 'activa');
  const finishedProducts = products.filter((p) => p.status === 'activo' && (p.type === 'PT' || p.type === 'PP'));
  const machine = machines.find((m) => m.id === machineId) ?? null;
  const product = products.find((p) => p.id === productId) ?? null;
  const openOrders = orders.filter(
    (o) => ['borrador', 'liberada', 'en_proceso'].includes(o.status) && (!productId || o.productId === productId),
  );

  useEffect(() => {
    if (!machineId && activeMachines.length > 0) {
      const first = activeMachines[0];
      setMachineId(first.id);
      setCavities(String(first.cavities || 1));
      setIdealCycleSeconds(String(first.idealCycleSeconds || 18));
    }
  }, [activeMachines, machineId]);

  useEffect(() => {
    if (!productId && finishedProducts.length > 0) setProductId(finishedProducts[0].id);
  }, [finishedProducts, productId]);

  useEffect(() => {
    setPlannedMinutes(String(shifts.find((s) => s.value === shift)?.minutes ?? DEFAULT_SHIFT_MINUTES));
    // Se ajusta al cambiar la duración configurada en Ajustes.
  }, [settings?.shiftDurationMinutes]);

  const selectMachine = (m: Machine) => {
    setMachineId(m.id);
    setCavities(String(m.cavities || 1));
    setIdealCycleSeconds(String(m.idealCycleSeconds || 18));
    setPlannedMinutes(String(shifts.find((s) => s.value === shift)?.minutes ?? DEFAULT_SHIFT_MINUTES));
  };

  const selectShift = (s: Shift) => {
    setShift(s);
    setPlannedMinutes(String(shifts.find((x) => x.value === s)?.minutes ?? DEFAULT_SHIFT_MINUTES));
  };

  const dayRecords = useMemo(() => records.filter((r) => r.date === date), [records, date]);
  const shiftRecords = useMemo(
    () => dayRecords.filter((r) => r.shift === shift).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [dayRecords, shift],
  );
  const daySummary = useMemo(() => summarize(dayRecords), [dayRecords]);
  const shiftSummary = useMemo(() => summarizeByShift(dayRecords, shifts), [dayRecords, shifts]);

  const preview = useMemo(() => {
    const temp: ProductionRecord = {
      id: 'preview',
      code: 'PR-VISTA',
      date,
      shift,
      machineId,
      machineCode: machine?.code ?? '',
      machineName: machine?.name ?? '',
      productId,
      productSku: product?.sku ?? '',
      productName: product?.name ?? '',
      orderId: orderId || undefined,
      plannedQty: Number(plannedQty) || 0,
      goodQty: Number(goodQty) || 0,
      scrapQty: Number(scrapQty) || 0,
      shots: Number(shots) || 0,
      cavities: Number(cavities) || 1,
      plannedMinutes: Number(plannedMinutes) || 0,
      downtimeMinutes: Number(downtimeMinutes) || 0,
      idealCycleSeconds: Number(idealCycleSeconds) || 0,
      scrapReason,
      notes,
      status: 'abierto',
      lotCode: '',
      userId: '',
      userName: '',
      createdAt: '',
    };
    return recordMetrics(temp);
  }, [
    date, shift, machine, product, productId, orderId, plannedQty, goodQty, scrapQty, shots, cavities,
    plannedMinutes, downtimeMinutes, idealCycleSeconds, scrapReason, notes, machineId,
  ]);

  const resetQty = () => {
    setGoodQty('');
    setScrapQty('');
    setShots('');
    setDowntimeMinutes('0');
    setNotes('');
  };

  const save = async (validate: boolean) => {
    if (!user) return;
    if (!machine) {
      toast('Seleccione una máquina', 'warn');
      return;
    }
    if (!product) {
      toast('Seleccione un producto', 'warn');
      return;
    }
    setBusy(true);
    try {
      const record = await createProductionRecord(
        {
          date,
          shift,
          machineId: machine.id,
          productId: product.id,
          orderId: orderId || undefined,
          plannedQty: Number(plannedQty) || 0,
          goodQty: Number(goodQty) || 0,
          scrapQty: Number(scrapQty) || 0,
          shots: Number(shots) || 0,
          cavities: Number(cavities) || 1,
          plannedMinutes: Number(plannedMinutes) || 0,
          downtimeMinutes: Number(downtimeMinutes) || 0,
          idealCycleSeconds: Number(idealCycleSeconds) || 0,
          scrapReason,
          notes,
        },
        user,
      );
      if (validate) {
        await validateProductionRecord(record.id, user);
        toast(
          'Turno validado e ingresado a almacén',
          'success',
          `${record.goodQty} und conformes${record.scrapQty > 0 ? ` · ${record.scrapQty} scrap segregado` : ''}`,
        );
      } else {
        toast('Turno guardado', 'success', `${record.code} · pendiente de validar`);
      }
      resetQty();
    } catch (error) {
      toast('No se pudo registrar', 'error', error instanceof Error ? error.message : undefined);
    } finally {
      setBusy(false);
    }
  };

  const validateRecord = async (record: ProductionRecord) => {
    if (!user) return;
    setBusy(true);
    try {
      await validateProductionRecord(record.id, user);
      toast('Registro validado', 'success', `${record.code} · entrada automática al almacén`);
    } catch (error) {
      toast('No se pudo validar', 'error', error instanceof Error ? error.message : undefined);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Registro diario de producción"
        subtitle="Captura táctil por turno, máquina y molde"
        actions={
          <div className="row" style={{ gap: 8 }}>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ width: 150 }} />
            <Badge tone="brand">{shiftLabel(shift, shifts)}</Badge>
          </div>
        }
      />

      <div className="kpi-grid">
        <StatCard
          label="OEE del día"
          value={pct(daySummary.oee)}
          icon={<Gauge size={18} />}
          tone={daySummary.oee >= 70 ? 'ok' : daySummary.oee >= 50 ? 'warn' : 'danger'}
          foot={<span>A {pct(daySummary.availability)} · R {pct(daySummary.performance)} · C {pct(daySummary.quality)}</span>}
        />
        <StatCard
          label="Producción conforme"
          value={fmtQty(daySummary.good)}
          icon={<Package size={18} />}
          tone="ok"
          foot={<span>{fmtQty(daySummary.planned)} programadas · {pct(daySummary.compliance)} cumplimiento</span>}
        />
        <StatCard
          label="Scrap del día"
          value={pct(daySummary.scrapPct)}
          icon={<AlertTriangle size={18} />}
          tone={daySummary.scrapPct <= 3 ? 'ok' : daySummary.scrapPct <= 6 ? 'warn' : 'danger'}
          foot={<span>{fmtQty(daySummary.scrap)} piezas no conformes</span>}
        />
        <StatCard
          label="Registros abiertos"
          value={dayRecords.filter((r) => r.status === 'abierto').length}
          icon={<ClipboardCheck size={18} />}
          tone="info"
          foot={<span>{dayRecords.length} capturas hoy</span>}
        />
      </div>

      <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1.55fr) minmax(290px, 1fr)' }}>
        <Card>
          <CardHead title="Captura rápida" subtitle="Toque el turno y la máquina; luego registre golpes y piezas" icon={<Factory size={18} color="var(--brand-3)" />} />
          <div className="card-pad form-grid">
            <div>
              <div className="meta-label" style={{ marginBottom: 8 }}>Turno</div>
              <div className="shift-grid">
                {shifts.map((s) => (
                  <button
                    key={s.value}
                    type="button"
                    className={cx('shift-btn', shift === s.value && 'active')}
                    onClick={() => selectShift(s.value)}
                  >
                    <strong>{s.short}</strong>
                    <span>{s.start}–{s.end}</span>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className="meta-label" style={{ marginBottom: 8 }}>Máquina</div>
              <div className="machine-grid">
                {activeMachines.length === 0 ? (
                  <div className="small muted">No hay máquinas activas. Configúrelas en “Máquinas”.</div>
                ) : (
                  activeMachines.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      className={cx('machine-btn', machineId === m.id && 'active')}
                      onClick={() => selectMachine(m)}
                    >
                      <span className="machine-code">{m.code}</span>
                      <strong>{m.name}</strong>
                      <span className="small muted">
                        {MACHINE_TYPES.find((t) => t.value === m.type)?.short} · {m.cavities} cav · {m.idealCycleSeconds}s
                      </span>
                    </button>
                  ))
                )}
              </div>
            </div>

            <div className="field-row">
              <Field label="Producto terminado">
                <Select value={productId} onChange={(e) => { setProductId(e.target.value); setOrderId(''); }}>
                  <option value="">Seleccione…</option>
                  {finishedProducts.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.sku} · {p.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Orden de producción (opcional)">
                <Select value={orderId} onChange={(e) => setOrderId(e.target.value)}>
                  <option value="">Sin orden asociada</option>
                  {openOrders.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.code} · {fmtQty(o.plannedQty)} und
                    </option>
                  ))}
                </Select>
              </Field>
            </div>

            <div className="field-row">
              <Field label="Piezas programadas">
                <NumberStepper value={plannedQty} onChange={setPlannedQty} step={100} min={0} suffix="und" />
              </Field>
              <Field label="Golpes / inyecciones">
                <NumberStepper value={shots} onChange={setShots} step={10} min={0} suffix="golpes" />
              </Field>
            </div>

            <div className="field-row">
              <Field label="Piezas conformes" hint="Entran al inventario al validar el turno">
                <NumberStepper value={goodQty} onChange={setGoodQty} step={10} min={0} suffix="und" />
              </Field>
              <Field label="Scrap / merma" hint="Se segrega y genera un PNC automático">
                <NumberStepper value={scrapQty} onChange={setScrapQty} step={1} min={0} suffix="und" />
              </Field>
            </div>

            <div className="field-row-3">
              <Field label="Minutos planificados">
                <Input type="number" min={0} value={plannedMinutes} onChange={(e) => setPlannedMinutes(e.target.value)} />
              </Field>
              <Field label="Minutos de paro">
                <Input type="number" min={0} value={downtimeMinutes} onChange={(e) => setDowntimeMinutes(e.target.value)} />
              </Field>
              <Field label="Cavidades">
                <Input type="number" min={1} value={cavities} onChange={(e) => setCavities(e.target.value)} />
              </Field>
            </div>

            <div className="field-row">
              <Field label="Ciclo ideal (segundos por golpe)">
                <Input type="number" min={0} step="0.1" value={idealCycleSeconds} onChange={(e) => setIdealCycleSeconds(e.target.value)} />
              </Field>
              <Field label="Motivo principal del scrap">
                <Select value={scrapReason} onChange={(e) => setScrapReason(e.target.value)}>
                  {SCRAP_REASONS.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>

            <Field label="Notas del turno">
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Paros, ajustes de molde, cambios de color, novedades…" />
            </Field>

            <div className="row wrap" style={{ gap: 8 }}>
              <Button variant="secondary" icon={<Save size={16} />} onClick={() => save(false)} disabled={busy}>
                Guardar turno
              </Button>
              <Button variant="primary" icon={<CheckCircle2 size={16} />} onClick={() => save(true)} disabled={busy}>
                {busy ? <span className="spinner" /> : null} Guardar y validar turno
              </Button>
            </div>
          </div>
        </Card>

        <div style={{ display: 'grid', gap: 16, alignContent: 'start' }}>
          <Card>
            <CardHead title="OEE en tiempo real" subtitle="Vista previa de la captura actual" icon={<Zap size={18} color="var(--brand-3)" />} />
            <div className="card-pad" style={{ display: 'grid', gap: 14 }}>
              <div className="row-between">
                <span className="small muted">Disponibilidad</span>
                <strong>{pct(preview.availability)}</strong>
              </div>
              <Progress value={preview.availability} color="var(--info)" />
              <div className="row-between">
                <span className="small muted">Rendimiento</span>
                <strong>{pct(preview.performance)}</strong>
              </div>
              <Progress value={preview.performance} color="var(--brand-2)" />
              <div className="row-between">
                <span className="small muted">Calidad</span>
                <strong>{pct(preview.quality)}</strong>
              </div>
              <Progress value={preview.quality} color="var(--ok)" />
              <div className="row-between" style={{ borderTop: '1px dashed var(--line-strong)', paddingTop: 12 }}>
                <span className="bold">OEE</span>
                <span className="bold" style={{ fontSize: 22, color: preview.oee >= 70 ? 'var(--ok)' : preview.oee >= 50 ? 'var(--warn)' : 'var(--danger)' }}>
                  {pct(preview.oee)}
                </span>
              </div>
              <div className="row-between small muted">
                <span>Scrap del turno</span>
                <span className="bold" style={{ color: preview.scrapPct <= 3 ? 'var(--ok)' : 'var(--danger)' }}>{pct(preview.scrapPct)}</span>
              </div>
              <div className="row-between small muted">
                <span>Piezas por golpe</span>
                <span>{preview.piecesPerShot || '—'}</span>
              </div>
              <div className="row-between small muted">
                <span>Tiempo efectivo</span>
                <span>{preview.runMinutes} min</span>
              </div>
            </div>
          </Card>

          <Card>
            <CardHead title="Resumen por turno" subtitle="OEE y scrap del día seleccionado" />
            <div className="card-pad" style={{ display: 'grid', gap: 10 }}>
              {shiftSummary.map((s) => (
                <div key={s.shift.value} className="row-between" style={{ gap: 10 }}>
                  <div>
                    <div className="bold small">{s.shift.label}</div>
                    <div className="small faint">{s.records} registro(s) · {fmtQty(s.good)} und</div>
                  </div>
                  <div className="right">
                    <Badge tone={s.oee >= 70 ? 'ok' : s.oee >= 50 ? 'warn' : 'muted'}>{pct(s.oee)}</Badge>
                    <div className="small faint">scrap {pct(s.scrapPct)}</div>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>

      <Card>
        <CardHead
          title={`Registros · ${shiftLabel(shift, shifts)}`}
          subtitle={`${shiftRecords.length} captura(s) del ${date}`}
          icon={<ClipboardCheck size={18} color="var(--brand-3)" />}
        />
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Registro</th>
                <th>Máquina</th>
                <th>Producto</th>
                <th className="num">Conformes</th>
                <th className="num">Scrap</th>
                <th className="num">OEE</th>
                <th>Estado</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {shiftRecords.length === 0 ? (
                <EmptyRow colSpan={8} message="Sin registros para este turno. Use la captura rápida para agregar producción." />
              ) : (
                shiftRecords.map((r) => {
                  const m = recordMetrics(r);
                  return (
                    <tr key={r.id}>
                      <td>
                        <div className="cell-main">
                          <span className="name mono">{r.code}</span>
                          <span className="sku">{dateTime(r.createdAt)}</span>
                        </div>
                      </td>
                      <td className="small">{r.machineCode}</td>
                      <td>
                        <div className="cell-main">
                          <span className="name">{r.productName}</span>
                          <span className="sku">{r.productSku}</span>
                        </div>
                      </td>
                      <td className="num strong">{fmtQty(r.goodQty)}</td>
                      <td className="num" style={{ color: r.scrapQty > 0 ? 'var(--danger)' : undefined }}>{fmtQty(r.scrapQty)}</td>
                      <td className="num">
                        <Badge tone={m.oee >= 70 ? 'ok' : m.oee >= 50 ? 'warn' : 'danger'}>{pct(m.oee)}</Badge>
                      </td>
                      <td>
                        {r.status === 'validado' ? (
                          <Badge tone="ok" dot>Validado</Badge>
                        ) : (
                          <Badge tone="warn" dot>Abierto</Badge>
                        )}
                      </td>
                      <td>
                        {r.status === 'abierto' && (
                          <Button size="sm" variant="secondary" onClick={() => validateRecord(r)} disabled={busy}>
                            Validar
                          </Button>
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
            <CheckCircle2 size={13} style={{ verticalAlign: -2, marginRight: 4 }} />
            Al validar, las piezas conformes generan una entrada PROD_IN y el scrap un PNC segregado.
          </span>
        </div>
      </Card>
    </>
  );
}

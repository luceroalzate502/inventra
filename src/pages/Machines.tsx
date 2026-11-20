import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Factory, Gauge, Plus, Settings2, Wrench } from 'lucide-react';
import { db } from '../db/schema';
import { useApp } from '../context/AppContext';
import { uid } from '../domain/format';
import { summarize } from '../domain/productionDaily';
import { MACHINE_TYPES } from '../domain/types';
import type { Machine, MachineType } from '../domain/types';
import { pct, qty as fmtQty } from '../domain/format';
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
  Select,
  StatCard,
  Textarea,
} from '../components/ui';

interface FormState {
  code: string;
  name: string;
  type: MachineType;
  brand: string;
  cavities: string;
  idealCycleSeconds: string;
  status: Machine['status'];
  notes: string;
}

const EMPTY: FormState = {
  code: '',
  name: '',
  type: 'inyectora',
  brand: '',
  cavities: '8',
  idealCycleSeconds: '18',
  status: 'activa',
  notes: '',
};

export function Machines() {
  const { user, toast } = useApp();
  const machines = useLiveQuery(() => db.machines.toArray(), []) ?? [];
  const records = useLiveQuery(() => db.productionRecords.toArray(), []) ?? [];
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Machine | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [busy, setBusy] = useState(false);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const metrics = useMemo(() => {
    const since = Date.now() - 30 * 86400000;
    const recent = records.filter((r) => new Date(r.createdAt).getTime() >= since);
    return new Map(machines.map((m) => [m.id, summarize(recent.filter((r) => r.machineId === m.id))]));
  }, [machines, records]);

  const active = machines.filter((m) => m.status === 'activa').length;
  const maintenance = machines.filter((m) => m.status === 'mantenimiento').length;

  const openNew = () => {
    setEditing(null);
    setForm(EMPTY);
    setOpen(true);
  };

  const openEdit = (machine: Machine) => {
    setEditing(machine);
    setForm({
      code: machine.code,
      name: machine.name,
      type: machine.type,
      brand: machine.brand,
      cavities: String(machine.cavities),
      idealCycleSeconds: String(machine.idealCycleSeconds),
      status: machine.status,
      notes: machine.notes,
    });
    setOpen(true);
  };

  const save = async () => {
    if (!user) return;
    if (!form.code.trim() || !form.name.trim()) {
      toast('Datos incompletos', 'warn', 'Código y nombre son obligatorios.');
      return;
    }
    setBusy(true);
    try {
      const code = form.code.trim().toUpperCase();
      const duplicate = await db.machines.where('code').equals(code).first();
      if (duplicate && duplicate.id !== editing?.id) {
        toast('Código duplicado', 'error', `Ya existe la máquina ${code}.`);
        setBusy(false);
        return;
      }
      const now = new Date().toISOString();
      if (editing) {
        const before = await db.machines.get(editing.id);
        const next: Machine = {
          ...editing,
          code,
          name: form.name.trim(),
          type: form.type,
          brand: form.brand.trim(),
          cavities: Math.max(1, Number(form.cavities) || 1),
          idealCycleSeconds: Math.max(0, Number(form.idealCycleSeconds) || 0),
          status: form.status,
          notes: form.notes.trim(),
          updatedAt: now,
        };
        await db.transaction('rw', [db.machines, db.audit], async () => {
          await db.machines.put(next);
          await db.audit.add({
            id: uid(),
            entity: 'machine',
            entityId: next.id,
            action: 'actualizar',
            summary: `Máquina ${next.code} actualizada`,
            before,
            after: next,
            userId: user.id,
            userName: user.name,
            at: now,
          });
        });
        toast('Máquina actualizada', 'success', `${next.code} · ${next.name}`);
      } else {
        const machine: Machine = {
          id: uid(),
          code,
          name: form.name.trim(),
          type: form.type,
          brand: form.brand.trim(),
          cavities: Math.max(1, Number(form.cavities) || 1),
          idealCycleSeconds: Math.max(0, Number(form.idealCycleSeconds) || 0),
          status: form.status,
          notes: form.notes.trim(),
          createdAt: now,
          updatedAt: now,
        };
        await db.transaction('rw', [db.machines, db.audit, db.outbox], async () => {
          await db.machines.add(machine);
          await db.audit.add({
            id: uid(),
            entity: 'machine',
            entityId: machine.id,
            action: 'crear',
            summary: `Máquina ${machine.code} creada (${machine.name})`,
            after: machine,
            userId: user.id,
            userName: user.name,
            at: now,
          });
          await db.outbox.add({
            entity: 'machine',
            entityId: machine.id,
            action: 'upsert',
            payload: machine,
            at: now,
            synced: 0,
          });
        });
        toast('Máquina creada', 'success', `${machine.code} · ${machine.name}`);
      }
      setOpen(false);
    } catch (error) {
      toast('No se pudo guardar', 'error', error instanceof Error ? error.message : undefined);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Máquinas de planta"
        subtitle="Inyectoras, sopladoras y extrusoras disponibles para el registro por turno"
        actions={
          <Button variant="primary" icon={<Plus size={16} />} onClick={openNew}>
            Nueva máquina
          </Button>
        }
      />

      <div className="kpi-grid">
        <StatCard label="Máquinas" value={machines.length} icon={<Factory size={18} />} tone="brand" foot={<span>{active} activas</span>} />
        <StatCard label="En mantenimiento" value={maintenance} icon={<Wrench size={18} />} tone={maintenance > 0 ? 'warn' : 'ok'} foot={<span>fuera de captura</span>} />
        <StatCard
          label="OEE promedio 30 días"
          value={pct(
            machines.length
              ? Array.from(metrics.values()).reduce((a, m) => a + m.oee, 0) / Math.max(1, machines.length)
              : 0,
          )}
          icon={<Gauge size={18} />}
          tone="info"
          foot={<span>disponibilidad × rendimiento × calidad</span>}
        />
        <StatCard label="Registros 30 días" value={records.filter((r) => new Date(r.createdAt).getTime() >= Date.now() - 30 * 86400000).length} icon={<Settings2 size={18} />} tone="muted" foot={<span>capturas por turno</span>} />
      </div>

      <Card>
        <CardHead title="Catálogo de máquinas" subtitle="Cavidades y ciclo ideal alimentan el cálculo de OEE" icon={<Factory size={18} color="var(--brand-3)" />} />
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Máquina</th>
                <th>Tipo</th>
                <th className="num">Cavidades</th>
                <th className="num">Ciclo ideal</th>
                <th className="num">OEE 30d</th>
                <th className="num">Scrap 30d</th>
                <th>Estado</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {machines.length === 0 ? (
                <EmptyRow colSpan={8} message="Sin máquinas registradas. Cree la primera para capturar producción." />
              ) : (
                machines
                  .slice()
                  .sort((a, b) => a.code.localeCompare(b.code))
                  .map((machine) => {
                    const m = metrics.get(machine.id);
                    return (
                      <tr key={machine.id} style={{ cursor: 'pointer' }} onClick={() => openEdit(machine)}>
                        <td>
                          <div className="cell-main">
                            <span className="name">{machine.name}</span>
                            <span className="sku">
                              {machine.code}
                              {machine.brand ? ` · ${machine.brand}` : ''}
                            </span>
                          </div>
                        </td>
                        <td className="small muted">
                          {MACHINE_TYPES.find((t) => t.value === machine.type)?.label ?? machine.type}
                        </td>
                        <td className="num">{fmtQty(machine.cavities)}</td>
                        <td className="num">{machine.idealCycleSeconds ? `${machine.idealCycleSeconds} s` : '—'}</td>
                        <td className="num">
                          <Badge tone={(m?.oee ?? 0) >= 70 ? 'ok' : (m?.oee ?? 0) >= 50 ? 'warn' : 'muted'}>
                            {m ? pct(m.oee) : '—'}
                          </Badge>
                        </td>
                        <td className="num">{m ? pct(m.scrapPct) : '—'}</td>
                        <td>
                          <Badge tone={machine.status === 'activa' ? 'ok' : machine.status === 'mantenimiento' ? 'warn' : 'muted'}>
                            {machine.status}
                          </Badge>
                        </td>
                        <td>
                          <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); openEdit(machine); }}>
                            Editar
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

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? 'Editar máquina' : 'Nueva máquina'}
        subtitle="Los parámetros técnicos se usan para calcular rendimiento y OEE"
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
              Cancelar
            </Button>
            <Button variant="primary" onClick={save} disabled={busy}>
              {busy ? <span className="spinner" /> : null} Guardar máquina
            </Button>
          </>
        }
      >
        <div className="form-grid">
          <div className="field-row">
            <Field label="Código *">
              <Input value={form.code} onChange={(e) => set('code', e.target.value.toUpperCase())} placeholder="INY-01" className="mono" />
            </Field>
            <Field label="Nombre *">
              <Input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Inyectora 1" />
            </Field>
          </div>
          <div className="field-row">
            <Field label="Tipo">
              <Select value={form.type} onChange={(e) => set('type', e.target.value as MachineType)}>
                {MACHINE_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Marca">
              <Input value={form.brand} onChange={(e) => set('brand', e.target.value)} placeholder="Haitian, Sidel…" />
            </Field>
          </div>
          <div className="field-row-3">
            <Field label="Cavidades" hint="Piezas por ciclo">
              <Input type="number" min={1} value={form.cavities} onChange={(e) => set('cavities', e.target.value)} />
            </Field>
            <Field label="Ciclo ideal (s)" hint="Segundos por golpe">
              <Input type="number" min={0} step="0.1" value={form.idealCycleSeconds} onChange={(e) => set('idealCycleSeconds', e.target.value)} />
            </Field>
            <Field label="Estado">
              <Select value={form.status} onChange={(e) => set('status', e.target.value as Machine['status'])}>
                <option value="activa">Activa</option>
                <option value="mantenimiento">Mantenimiento</option>
                <option value="inactiva">Inactiva</option>
              </Select>
            </Field>
          </div>
          <Field label="Notas">
            <Textarea value={form.notes} onChange={(e) => set('notes', e.target.value)} placeholder="Observaciones técnicas, molde asignado…" />
          </Field>
        </div>
      </Modal>
    </>
  );
}

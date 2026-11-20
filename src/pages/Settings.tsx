import { useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  Building2,
  Clock,
  Cloud,
  Database,
  Download,
  HardDrive,
  Moon,
  Palette,
  RefreshCw,
  Save,
  ShieldAlert,
  Sun,
  Upload,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { db } from '../db/schema';
import { useApp } from '../context/AppContext';
import { dateTime, uid } from '../domain/format';
import { recalculateStock } from '../domain/movements';
import { isValidWhatsApp, DEFAULT_WHATSAPP_NUMBER } from '../domain/whatsapp';
import { resetSyncTracking } from '../sync/engine';
import { useSyncStatus } from '../sync/useSync';
import type { Settings as AppSettings } from '../domain/types';
import { getShiftDurations, SHIFT_VALUES } from '../domain/types';
import {
  Badge,
  Button,
  Card,
  CardHead,
  ConfirmDialog,
  Field,
  Input,
  PageHeader,
  Select,
  StatCard,
  cx,
} from '../components/ui';

const TABLES = [
  'users',
  'products',
  'movements',
  'lots',
  'boms',
  'bomItems',
  'productionOrders',
  'consumptions',
  'audit',
  'counts',
  'settings',
  'counters',
  'outbox',
  'machines',
  'productionRecords',
  'pnc',
  'locations',
  'locationStock',
  'transfers',
  'dispatches',
  'messages',
  'permissions',
] as const;

interface SettingsForm {
  companyName: string;
  nit: string;
  warehouseManager: string;
  whatsappNumber: string;
  sessionMinutes: string;
  shiftDurations: string[];
  shiftStartHour: string;
  allowNegativeStock: boolean;
  lowStockAlert: boolean;
  decimals: string;
}

interface BackupFile {
  app?: string;
  version?: number;
  exportedAt?: string;
  data?: Record<string, unknown[]>;
}

const EMPTY_FORM: SettingsForm = {
  companyName: '',
  nit: '',
  warehouseManager: '',
  whatsappNumber: '',
  sessionMinutes: '60',
  shiftDurations: ['360', '360', '360', '360'],
  shiftStartHour: '6',
  allowNegativeStock: false,
  lowStockAlert: true,
  decimals: '2',
};

export function Settings() {
  const { user, settings, theme, toggleTheme, reloadSettings, logout, toast } = useApp();
  const [form, setForm] = useState<SettingsForm>(EMPTY_FORM);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [recalcOpen, setRecalcOpen] = useState(false);
  const [pendingRestore, setPendingRestore] = useState<BackupFile | null>(null);
  const [lastBackup, setLastBackup] = useState<string | null>(() => localStorage.getItem('inventra.lastBackup'));
  const fileRef = useRef<HTMLInputElement>(null);

  const productCount = useLiveQuery(() => db.products.count(), []) ?? 0;
  const movementCount = useLiveQuery(() => db.movements.count(), []) ?? 0;
  const userCount = useLiveQuery(() => db.users.count(), []) ?? 0;
  const sync = useSyncStatus();
  const pendingSync = sync.pending;

  useEffect(() => {
    if (!settings) return;
    setForm({
      companyName: settings.companyName,
      nit: settings.nit,
      warehouseManager: settings.warehouseManager,
      whatsappNumber: settings.whatsappNumber ?? DEFAULT_WHATSAPP_NUMBER,
      sessionMinutes: String(settings.sessionMinutes),
      shiftDurations: getShiftDurations(settings).map(String),
      shiftStartHour: String(settings.shiftStartHour ?? 6),
      allowNegativeStock: settings.allowNegativeStock,
      lowStockAlert: settings.lowStockAlert,
      decimals: String(settings.decimals),
    });
  }, [settings]);

  const set = <K extends keyof SettingsForm>(key: K, value: SettingsForm[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const setShiftDuration = (index: number, value: string) =>
    setForm((f) => ({
      ...f,
      shiftDurations: f.shiftDurations.map((current, i) => (i === index ? value : current)),
    }));

  const save = async () => {
    if (!user) return;
    const e: Record<string, string> = {};
    if (form.companyName.trim().length < 3) e.companyName = 'Indique la razón social.';
    if (!form.nit.trim()) e.nit = 'El NIT es obligatorio.';
    if (form.whatsappNumber.trim() && !isValidWhatsApp(form.whatsappNumber)) {
      e.whatsappNumber = 'Use el indicativo del país y entre 10 y 15 dígitos.';
    }
    const minutes = Number(form.sessionMinutes);
    if (!Number.isFinite(minutes) || minutes < 5 || minutes > 480) {
      e.sessionMinutes = 'Entre 5 y 480 minutos.';
    }
    const decimals = Number(form.decimals);
    if (!Number.isFinite(decimals) || decimals < 0 || decimals > 4) {
      e.decimals = 'Entre 0 y 4 decimales.';
    }
    const shiftMinutes = form.shiftDurations.map(Number);
    SHIFT_VALUES.forEach((_, index) => {
      const value = shiftMinutes[index];
      if (!Number.isFinite(value) || value < 30 || value > 1440) {
        e[`shiftDurations.${index}`] = 'Entre 30 y 1440 minutos.';
      }
    });
    const shiftStart = Number(form.shiftStartHour);
    if (!Number.isFinite(shiftStart) || shiftStart < 0 || shiftStart > 23) {
      e.shiftStartHour = 'Entre 0 y 23 horas.';
    }
    setErrors(e);
    if (Object.keys(e).length > 0) return;

    setBusy(true);
    try {
      const next: AppSettings = {
        key: 'global',
        companyName: form.companyName.trim(),
        nit: form.nit.trim(),
        currency: 'COP',
        allowNegativeStock: form.allowNegativeStock,
        sessionMinutes: minutes,
        lowStockAlert: form.lowStockAlert,
        decimals,
        warehouseManager: form.warehouseManager.trim(),
        shiftDurationsMinutes: shiftMinutes,
        // Se mantiene el valor antiguo para bases y clientes que aún no conocen los 4 turnos.
        shiftDurationMinutes: shiftMinutes[0],
        shiftStartHour: shiftStart,
        whatsappNumber: form.whatsappNumber.trim() || undefined,
      };
      const before = settings;
      await db.settings.put(next);
      await db.audit.add({
        id: uid(),
        entity: 'settings',
        entityId: 'global',
        action: 'actualizar',
        summary: 'Configuración general actualizada',
        before,
        after: next,
        userId: user.id,
        userName: user.name,
        at: new Date().toISOString(),
      });
      await reloadSettings();
      toast('Configuración guardada', 'success', 'Los cambios aplican a todos los módulos.');
    } catch (err) {
      toast('No fue posible guardar', 'error', err instanceof Error ? err.message : 'Intente nuevamente.');
    } finally {
      setBusy(false);
    }
  };

  const backup = async () => {
    if (!user) return;
    setBusy(true);
    try {
      const data: Record<string, unknown[]> = {};
      for (const name of TABLES) data[name] = await db.table(name).toArray();
      const payload = {
        app: 'Invencodi',
        version: 1,
        exportedAt: new Date().toISOString(),
        company: settings?.companyName ?? '',
        exportedBy: user.name,
        data,
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `invencodi-respaldo-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      const stamp = new Date().toISOString();
      localStorage.setItem('inventra.lastBackup', stamp);
      setLastBackup(stamp);
      await db.audit.add({
        id: uid(),
        entity: 'system',
        entityId: 'backup',
        action: 'crear',
        summary: `Respaldo completo generado (${TABLES.length} tablas)`,
        userId: user.id,
        userName: user.name,
        at: new Date().toISOString(),
      });
      toast('Respaldo generado', 'success', 'Archivo JSON descargado con toda la información.');
    } finally {
      setBusy(false);
    }
  };

  const readBackup = async (file: File) => {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as BackupFile;
      if (
        (parsed.app !== 'Invencodi' && parsed.app !== 'INVENTRA') ||
        !parsed.data ||
        typeof parsed.data !== 'object'
      ) {
        throw new Error('El archivo no corresponde a un respaldo válido de Invencodi.');
      }
      if (!Array.isArray(parsed.data.users) || !Array.isArray(parsed.data.products)) {
        throw new Error('El respaldo no contiene las tablas mínimas requeridas.');
      }
      setPendingRestore(parsed);
      setRestoreOpen(true);
    } catch (err) {
      toast('Respaldo inválido', 'error', err instanceof Error ? err.message : 'Verifique el archivo.');
    }
  };

  const restore = async () => {
    if (!user || !pendingRestore?.data) return;
    setBusy(true);
    try {
      const data = pendingRestore.data;
      await db.transaction('rw', db.tables, async () => {
        for (const name of TABLES) {
          await db.table(name).clear();
          const rows = data[name];
          if (Array.isArray(rows) && rows.length > 0) await db.table(name).bulkPut(rows);
        }
      });
      await reloadSettings();
      await resetSyncTracking();
      const stillThere = await db.users.get(user.id);
      await db.audit.add({
        id: uid(),
        entity: 'system',
        entityId: 'restore',
        action: 'actualizar',
        summary: `Restauración de respaldo (${pendingRestore.exportedAt ?? 'sin fecha'})`,
        userId: user.id,
        userName: user.name,
        at: new Date().toISOString(),
      });
      setRestoreOpen(false);
      setPendingRestore(null);
      if (!stillThere) {
        logout();
        toast('Datos restaurados', 'warn', 'Su usuario no existe en el respaldo. Inicie sesión nuevamente.');
      } else {
        toast('Datos restaurados', 'success', 'La información fue reemplazada correctamente.');
      }
    } catch (err) {
      toast('No fue posible restaurar', 'error', err instanceof Error ? err.message : 'Intente nuevamente.');
    } finally {
      setBusy(false);
    }
  };

  const recalc = async () => {
    if (!user) return;
    setBusy(true);
    try {
      const fixed = await recalculateStock(user);
      toast(
        'Saldos recalculados',
        'success',
        fixed > 0 ? `${fixed} producto(s) ajustado(s) según sus movimientos.` : 'Todos los saldos ya coincidían.',
      );
      setRecalcOpen(false);
    } catch (err) {
      toast('No fue posible recalcular', 'error', err instanceof Error ? err.message : 'Intente nuevamente.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Configuración"
        subtitle="Parámetros de la empresa, seguridad y respaldo de información"
        actions={
          <Button variant="primary" icon={<Save size={16} />} onClick={save} disabled={busy}>
            {busy ? <span className="spinner" /> : null}
            Guardar cambios
          </Button>
        }
      />

      <div className="kpi-grid">
        <StatCard label="Productos" value={productCount} icon={<Database size={18} />} tone="brand" foot={<span>en el catálogo</span>} />
        <StatCard label="Movimientos" value={movementCount} icon={<RefreshCw size={18} />} tone="info" foot={<span>registros históricos</span>} />
        <StatCard label="Usuarios" value={userCount} icon={<Building2 size={18} />} tone="ok" foot={<span>con acceso</span>} />
        <StatCard
          label="Sincronización"
          value={pendingSync}
          icon={<HardDrive size={18} />}
          tone={pendingSync > 0 ? 'warn' : 'muted'}
          foot={
            <span>
              {sync.connected
                ? pendingSync > 0
                  ? 'pendientes de subir a la nube'
                  : 'todo al día con la nube'
                : 'solo en este equipo'}
            </span>
          }
        />
      </div>

      <div className="grid-2 mb-16">
        <Card>
          <CardHead
            title="Datos de la empresa"
            subtitle="Se usan en encabezados de reportes y comprobantes"
            icon={<Building2 size={18} color="var(--brand-3)" />}
          />
          <div className="card-pad form-grid">
            <Field label="Razón social" error={errors.companyName}>
              <Input
                value={form.companyName}
                onChange={(e) => set('companyName', e.target.value)}
                placeholder="Nombre de la empresa"
              />
            </Field>
            <div className="field-row">
              <Field label="NIT" error={errors.nit}>
                <Input value={form.nit} onChange={(e) => set('nit', e.target.value)} placeholder="900.000.000-0" />
              </Field>
              <Field label="Jefe de almacén">
                <Input
                  value={form.warehouseManager}
                  onChange={(e) => set('warehouseManager', e.target.value)}
                  placeholder="Responsable"
                />
              </Field>
            </div>
            <Field
              label="WhatsApp de contacto"
              error={errors.whatsappNumber}
              hint="Número que abre el botón flotante y el enlace del login. Ej.: +57 324 540 8337."
            >
              <Input
                value={form.whatsappNumber}
                onChange={(e) => set('whatsappNumber', e.target.value)}
                placeholder="+57 300 123 4567"
                inputMode="tel"
              />
            </Field>
            <Field label="Moneda">
              <Select value="COP" disabled>
                <option value="COP">Peso colombiano (COP)</option>
              </Select>
            </Field>
          </div>
        </Card>

        <Card>
          <CardHead
            title="Seguridad y operación"
            subtitle="Reglas de sesión y control de existencias"
            icon={<ShieldAlert size={18} color="var(--brand-3)" />}
          />
          <div className="card-pad form-grid">
            <div className="field-row">
              <Field label="Duración de sesión (min)" error={errors.sessionMinutes} hint="Cierre por inactividad.">
                <Input
                  type="number"
                  min={5}
                  max={480}
                  value={form.sessionMinutes}
                  onChange={(e) => set('sessionMinutes', e.target.value)}
                />
              </Field>
              <Field label="Decimales de cantidad" error={errors.decimals} hint="Para unidades fraccionarias.">
                <Input
                  type="number"
                  min={0}
                  max={4}
                  value={form.decimals}
                  onChange={(e) => set('decimals', e.target.value)}
                />
              </Field>
            </div>
            <div className="form-section-title">Jornada y turnos</div>
            <div className="field-row-4">
              {SHIFT_VALUES.map((turno, index) => (
                <Field
                  key={turno}
                  label={`Turno ${turno} (min)`}
                  error={errors[`shiftDurations.${index}`]}
                  hint={index === 0 ? 'Ej. 360 = 6 horas.' : undefined}
                >
                  <Input
                    type="number"
                    min={30}
                    max={1440}
                    value={form.shiftDurations[index] ?? '360'}
                    onChange={(e) => setShiftDuration(index, e.target.value)}
                  />
                </Field>
              ))}
            </div>
            <div className="field-row">
              <Field
                label="Hora de inicio del turno 1"
                error={errors.shiftStartHour}
                hint="Los turnos se encadenan desde esta hora con la duración indicada para cada uno."
              >
                <Select value={form.shiftStartHour} onChange={(e) => set('shiftStartHour', e.target.value)}>
                  {Array.from({ length: 24 }, (_, h) => (
                    <option key={h} value={String(h)}>
                      {String(h).padStart(2, '0')}:00
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <label className="switch">
              <input
                type="checkbox"
                checked={form.allowNegativeStock}
                onChange={(e) => set('allowNegativeStock', e.target.checked)}
              />
              Permitir stock negativo sin autorización
            </label>
            <label className="switch">
              <input
                type="checkbox"
                checked={form.lowStockAlert}
                onChange={(e) => set('lowStockAlert', e.target.checked)}
              />
              Generar alertas de stock bajo mínimo
            </label>
            <div
              className="small muted"
              style={{ display: 'flex', gap: 8, alignItems: 'flex-start', lineHeight: 1.5 }}
            >
              <Clock size={15} style={{ flex: 'none', marginTop: 2 }} />
              <span>
                Si desactiva el stock negativo, toda salida que supere la existencia requerirá
                autorización de un perfil con permiso <strong>inventory.override</strong>.
              </span>
            </div>
          </div>
        </Card>
      </div>

      <div className="grid-2 mb-16">
        <Card>
          <CardHead
            title="Apariencia"
            subtitle="Tema visual del aplicativo"
            icon={<Palette size={18} color="var(--brand-3)" />}
          />
          <div className="card-pad" style={{ display: 'grid', gap: 14 }}>
            <div className="segmented" style={{ alignSelf: 'flex-start' }}>
              <button className={cx(theme === 'light' && 'active')} onClick={() => theme === 'dark' && toggleTheme()}>
                <Sun size={14} style={{ marginRight: 6, display: 'inline' }} />
                Claro
              </button>
              <button className={cx(theme === 'dark' && 'active')} onClick={() => theme === 'light' && toggleTheme()}>
                <Moon size={14} style={{ marginRight: 6, display: 'inline' }} />
                Oscuro
              </button>
            </div>
            <p className="small muted" style={{ lineHeight: 1.6 }}>
              El tema se guarda en este dispositivo. La interfaz se adapta a teléfonos, tablets y
              equipos de escritorio.
            </p>
            <div className="row wrap" style={{ gap: 6 }}>
              <Badge tone="ok" dot>
                PWA instalable
              </Badge>
              <Badge tone="info" dot>
                Funciona sin conexión
              </Badge>
              <Badge tone={sync.connected ? 'ok' : 'muted'} dot>
                {sync.connected ? 'Nube conectada' : 'Datos locales'}
              </Badge>
            </div>
            <Link
              to="/sincronizacion"
              className="btn btn-ghost"
              style={{ justifySelf: 'start' }}
            >
              <Cloud size={15} />
              {sync.connected ? 'Ver estado de la nube' : 'Compartir datos entre equipos'}
            </Link>
          </div>
        </Card>

        <Card>
          <CardHead
            title="Respaldo y restauración"
            subtitle="Exporte o recupere toda la base de datos local"
            icon={<HardDrive size={18} color="var(--brand-3)" />}
          />
          <div className="card-pad" style={{ display: 'grid', gap: 12 }}>
            <p className="small muted" style={{ lineHeight: 1.6 }}>
              El respaldo incluye usuarios, productos, movimientos, lotes, BOM, órdenes, conteos y
              auditoría. Guárdelo en un lugar seguro.
            </p>
            <div className="row wrap" style={{ gap: 8 }}>
              <Button variant="secondary" icon={<Download size={15} />} onClick={backup} disabled={busy}>
                Descargar respaldo
              </Button>
              <Button
                variant="secondary"
                icon={<Upload size={15} />}
                onClick={() => fileRef.current?.click()}
                disabled={busy}
              >
                Restaurar respaldo
              </Button>
              <input
                ref={fileRef}
                type="file"
                accept="application/json,.json"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void readBackup(file);
                  e.target.value = '';
                }}
              />
            </div>
            <div className="small faint">
              Último respaldo: {lastBackup ? dateTime(lastBackup) : 'sin respaldos en este dispositivo'}
            </div>
          </div>
        </Card>
      </div>

      <Card>
        <CardHead
          title="Mantenimiento"
          subtitle="Herramientas de integridad para el administrador"
          icon={<RefreshCw size={18} color="var(--brand-3)" />}
        />
        <div className="card-pad row-between wrap" style={{ gap: 14 }}>
          <div style={{ maxWidth: 560 }}>
            <div className="bold ink" style={{ marginBottom: 4 }}>
              Recalcular saldos desde los movimientos
            </div>
            <p className="small muted" style={{ lineHeight: 1.6, margin: 0 }}>
              Reconstruye el stock de cada producto sumando sus movimientos históricos. Úselo si
              detecta diferencias por restauraciones o cierres incompletos. La operación queda
              registrada en auditoría.
            </p>
          </div>
          <Button variant="secondary" icon={<RefreshCw size={15} />} onClick={() => setRecalcOpen(true)} disabled={busy}>
            Recalcular saldos
          </Button>
        </div>
      </Card>

      <ConfirmDialog
        open={restoreOpen}
        title="Restaurar respaldo"
        message={
          pendingRestore
            ? `Se reemplazará toda la información actual por la del respaldo${pendingRestore.exportedAt ? ` del ${new Date(pendingRestore.exportedAt).toLocaleString('es-CO')}` : ''}. Esta acción no se puede deshacer.`
            : ''
        }
        confirmLabel="Restaurar datos"
        tone="danger"
        busy={busy}
        onCancel={() => {
          setRestoreOpen(false);
          setPendingRestore(null);
        }}
        onConfirm={restore}
      />

      <ConfirmDialog
        open={recalcOpen}
        title="Recalcular saldos"
        message="El stock de todos los productos se recalculará a partir de la suma de sus movimientos. Los costos promedio no se modifican. ¿Desea continuar?"
        confirmLabel="Recalcular"
        busy={busy}
        onCancel={() => setRecalcOpen(false)}
        onConfirm={recalc}
      />
    </>
  );
}

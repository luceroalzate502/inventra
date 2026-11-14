import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Check,
  Cloud,
  CloudDownload,
  CloudOff,
  CloudUpload,
  Copy,
  Database,
  Download,
  ExternalLink,
  KeyRound,
  Link2,
  RefreshCw,
  ShieldCheck,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { db } from '../db/schema';
import { useApp } from '../context/AppContext';
import { dateTime } from '../domain/format';
import { useSyncStatus } from '../sync/useSync';
import {
  connectCloud,
  disconnectCloud,
  pendingBreakdown,
  pullAllRemote,
  pushAllLocal,
  setAutoSync,
  syncNow,
} from '../sync/engine';
import type { InitialMode } from '../sync/engine';
import {
  DEFAULT_CLOUD_ANON_KEY,
  DEFAULT_CLOUD_URL,
  deviceId,
  deviceSuffix,
  getCloudConfig,
} from '../sync/config';
import type { CloudConfig } from '../sync/config';
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
} from '../components/ui';

interface CloudForm {
  url: string;
  anonKey: string;
  email: string;
  password: string;
}

const EMPTY_FORM: CloudForm = {
  url: DEFAULT_CLOUD_URL,
  anonKey: DEFAULT_CLOUD_ANON_KEY,
  email: '',
  password: '',
};

const MODE_OPTIONS: { value: InitialMode; label: string; hint: string }[] = [
  {
    value: 'auto',
    label: 'Automático (recomendado)',
    hint: 'Sube los datos si el servidor está vacío; descarga si el servidor ya tiene información.',
  },
  {
    value: 'pull',
    label: 'Descargar del servidor',
    hint: 'Reemplaza los datos de este equipo con los que ya están en la nube.',
  },
  {
    value: 'push',
    label: 'Subir este equipo',
    hint: 'Envía los datos de este equipo y los combina con lo que haya en la nube.',
  },
  {
    value: 'both',
    label: 'Combinar cambios',
    hint: 'Sube y baja cambios; en conflictos gana la edición más reciente.',
  },
];

const TABLE_LABELS: Record<string, string> = {
  users: 'Usuarios',
  settings: 'Configuración',
  products: 'Productos',
  movements: 'Movimientos',
  lots: 'Lotes',
  boms: 'Listas de materiales',
  bomItems: 'Componentes de BOM',
  productionOrders: 'Órdenes de producción',
  consumptions: 'Consumos',
  audit: 'Auditoría',
  counts: 'Conteos físicos',
  machines: 'Máquinas',
  productionRecords: 'Producción diaria',
  pnc: 'Producto no conforme',
  locations: 'Ubicaciones 5S',
  locationStock: 'Stock por ubicación',
  transfers: 'Traslados',
  dispatches: 'Despachos',
};

export function CloudPage() {
  const { user, logout, toast } = useApp();
  const status = useSyncStatus();
  const [config, setConfig] = useState<CloudConfig | null>(() => getCloudConfig());
  const [form, setForm] = useState<CloudForm>(EMPTY_FORM);
  const [mode, setMode] = useState<InitialMode>('auto');
  const [busy, setBusy] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [sql, setSql] = useState('');
  const [copied, setCopied] = useState(false);
  const [breakdown, setBreakdown] = useState<{ table: string; count: number }[]>([]);
  const [confirmAction, setConfirmAction] = useState<'disconnect' | 'pull' | 'push' | null>(null);

  useEffect(() => {
    const url = `${import.meta.env.BASE_URL}supabase-schema.sql`;
    fetch(url)
      .then((response) => (response.ok ? response.text() : ''))
      .then((text) => setSql(text))
      .catch(() => setSql(''));
  }, []);

  useEffect(() => {
    void pendingBreakdown().then(setBreakdown);
  }, [status.pending, status.lastSync]);

  const stateMeta = useMemo(() => {
    if (!status.connected) {
      return { tone: 'muted' as const, label: 'Sin configurar', icon: CloudOff };
    }
    if (status.state === 'syncing') return { tone: 'info' as const, label: 'Sincronizando', icon: RefreshCw };
    if (status.state === 'error') return { tone: 'danger' as const, label: 'Con error', icon: AlertTriangle };
    if (status.state === 'offline') return { tone: 'warn' as const, label: 'Sin conexión', icon: WifiOff };
    return { tone: 'ok' as const, label: 'Conectado', icon: Wifi };
  }, [status]);

  const StateIcon = stateMeta.icon;

  const set = <K extends keyof CloudForm>(key: K, value: CloudForm[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const connect = async () => {
    setBusy(true);
    try {
      const result = await connectCloud(form, mode);
      setConfig(getCloudConfig());
      setForm(EMPTY_FORM);
      if (result.ok) {
        toast(
          'Nube conectada',
          'success',
          `${result.pushed} registro(s) enviados y ${result.pulled} recibido(s).`,
        );
      } else {
        toast('Conexión establecida con advertencias', 'warn', result.error ?? 'Revise el estado de la nube.');
      }
      if (user) {
        const stillThere =
          (await db.users.get(user.id)) ??
          (await db.users.where('email').equals(user.email.toLowerCase()).first());
        if (!stillThere) {
          toast('Su usuario no está en la nube', 'warn', 'Inicie sesión con una cuenta del servidor.');
          logout();
        }
      }
    } catch (error) {
      toast(
        'No fue posible conectar',
        'error',
        error instanceof Error ? error.message : 'Revise la URL, la llave y las credenciales.',
      );
    } finally {
      setBusy(false);
    }
  };

  const runSync = async () => {
    setBusy(true);
    try {
      const result = await syncNow('manual');
      if (result.ok) {
        toast(
          'Sincronización completada',
          'success',
          `${result.pushed} enviados · ${result.pulled} recibidos.`,
        );
      } else {
        toast('No fue posible sincronizar', 'warn', result.error ?? 'Revise la conexión.');
      }
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    setBusy(true);
    try {
      await disconnectCloud();
      setConfig(null);
      setConfirmAction(null);
      toast('Nube desconectada', 'success', 'Los datos locales se conservan en este dispositivo.');
    } finally {
      setBusy(false);
    }
  };

  const forceUpload = async () => {
    setBusy(true);
    try {
      const result = await pushAllLocal();
      toast(
        result.ok ? 'Carga completada' : 'No fue posible subir los datos',
        result.ok ? 'success' : 'warn',
        result.ok ? `${result.pushed} registro(s) enviados.` : (result.error ?? 'Intente nuevamente.'),
      );
      setConfirmAction(null);
    } catch (error) {
      toast('No fue posible subir los datos', 'error', error instanceof Error ? error.message : 'Intente nuevamente.');
    } finally {
      setBusy(false);
    }
  };

  const forceDownload = async () => {
    setConfirmAction(null);
    setBusy(true);
    try {
      const result = await pullAllRemote();
      setConfig(getCloudConfig());
      toast(
        result.ok ? 'Datos descargados' : 'No fue posible descargar',
        result.ok ? 'success' : 'warn',
        result.ok ? `${result.pulled} registro(s) recibidos.` : (result.error ?? 'Intente nuevamente.'),
      );
      if (result.ok && user) {
        const stillThere =
          (await db.users.get(user.id)) ??
          (await db.users.where('email').equals(user.email.toLowerCase()).first());
        if (!stillThere) {
          toast('Su usuario no está en la nube', 'warn', 'Inicie sesión con una cuenta del servidor.');
          logout();
        }
      }
    } catch (error) {
      toast('No fue posible descargar', 'error', error instanceof Error ? error.message : 'Intente nuevamente.');
    } finally {
      setBusy(false);
    }
  };

  const copySql = async () => {
    if (!sql) return;
    try {
      await navigator.clipboard.writeText(sql);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
      toast('Script copiado', 'success', 'Péguelo en el editor SQL de Supabase y ejecútelo.');
    } catch {
      downloadSql();
    }
  };

  const downloadSql = () => {
    if (!sql) return;
    const blob = new Blob([sql], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'inventra-supabase.sql';
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const maskedKey = config ? `${config.anonKey.slice(0, 10)}…${config.anonKey.slice(-6)}` : '';
  const shortDevice = deviceId().slice(0, 8);

  return (
    <>
      <PageHeader
        title="Sincronización en la nube"
        subtitle="Comparta los datos entre equipos y siga trabajando sin conexión"
        actions={
          config ? (
            <Button variant="primary" icon={<RefreshCw size={16} />} onClick={runSync} disabled={busy || status.state === 'syncing'}>
              {busy || status.state === 'syncing' ? <span className="spinner" /> : null}
              Sincronizar ahora
            </Button>
          ) : undefined
        }
      />

      <div className="kpi-grid">
        <StatCard
          label="Estado"
          value={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><StateIcon size={18} />{stateMeta.label}</span>}
          icon={<Cloud size={18} />}
          tone={stateMeta.tone}
          foot={<span>{config ? config.email : 'datos solo en este equipo'}</span>}
        />
        <StatCard
          label="Cambios pendientes"
          value={status.pending}
          icon={<CloudUpload size={18} />}
          tone={status.pending > 0 ? 'warn' : 'muted'}
          foot={<span>{!status.connected ? 'se enviarán al conectar la nube' : status.pending > 0 ? 'se enviarán al recuperar conexión' : 'todo al día'}</span>}
        />
        <StatCard
          label="Última sincronización"
          value={status.lastSync ? dateTime(status.lastSync) : '—'}
          icon={<RefreshCw size={18} />}
          tone="info"
          foot={<span>{status.state === 'offline' ? 'sin conexión' : 'automática cada 30 s'}</span>}
        />
        <StatCard
          label="Este equipo"
          value={deviceSuffix()}
          icon={<Database size={18} />}
          tone="brand"
          foot={<span>ID {shortDevice}…</span>}
        />
      </div>

      {status.lastError && (
        <Card className="mb-16">
          <div className="card-pad row" style={{ gap: 10, alignItems: 'flex-start' }}>
            <AlertTriangle size={18} color="var(--danger)" style={{ flex: 'none', marginTop: 2 }} />
            <div>
              <div className="bold ink">Último error de sincronización</div>
              <div className="small muted" style={{ lineHeight: 1.6 }}>{status.lastError}</div>
            </div>
          </div>
        </Card>
      )}

      {!config ? (
        <div className="grid-2 mb-16">
          <Card>
            <CardHead
              title="Conectar con Supabase"
              subtitle="Servidor central gratuito para compartir los datos"
              icon={<Cloud size={18} color="var(--brand-3)" />}
            />
            <div className="card-pad form-grid">
              <Field label="Project URL" hint="Project Settings → API → Project URL">
                <Input
                  value={form.url}
                  onChange={(e) => set('url', e.target.value)}
                  placeholder="https://abcdefgh.supabase.co"
                  autoComplete="url"
                />
              </Field>
              <Field label="Anon public key" hint="Project Settings → API → anon public">
                <Input
                  type={showKey ? 'text' : 'password'}
                  value={form.anonKey}
                  onChange={(e) => set('anonKey', e.target.value)}
                  placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9…"
                  autoComplete="off"
                />
              </Field>
              <label className="switch">
                <input type="checkbox" checked={showKey} onChange={(e) => setShowKey(e.target.checked)} />
                Mostrar llave
              </label>
              <div className="field-row">
                <Field label="Correo de la nube" hint="Cuenta que protegerá los datos compartidos.">
                  <Input
                    type="email"
                    value={form.email}
                    onChange={(e) => set('email', e.target.value)}
                    placeholder="nube@miempresa.co"
                    autoComplete="username"
                  />
                </Field>
                <Field label="Contraseña de la nube" hint="Mínimo 6 caracteres.">
                  <Input
                    type={showPassword ? 'text' : 'password'}
                    value={form.password}
                    onChange={(e) => set('password', e.target.value)}
                    placeholder="••••••••"
                    autoComplete="new-password"
                  />
                </Field>
              </div>
              <label className="switch">
                <input type="checkbox" checked={showPassword} onChange={(e) => setShowPassword(e.target.checked)} />
                Mostrar contraseña
              </label>
              <Field label="Al conectar" hint={MODE_OPTIONS.find((option) => option.value === mode)?.hint}>
                <Select value={mode} onChange={(e) => setMode(e.target.value as InitialMode)}>
                  {MODE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <div className="row wrap" style={{ gap: 8 }}>
                <Button variant="primary" icon={<Link2 size={15} />} onClick={connect} disabled={busy}>
                  {busy ? <span className="spinner" /> : null}
                  Conectar la nube
                </Button>
                <a
                  className="btn btn-ghost"
                  href="https://supabase.com/dashboard"
                  target="_blank"
                  rel="noreferrer"
                >
                  <ExternalLink size={15} />
                  Abrir Supabase
                </a>
              </div>
              <p className="small faint" style={{ lineHeight: 1.6, margin: 0 }}>
                Si la cuenta de nube no existe, se crea automáticamente. Si Supabase exige confirmar el
                correo, confirme el enlace o desactive <strong>Confirm email</strong> en
                Authentication → Providers → Email.
              </p>
            </div>
          </Card>

          <Card>
            <CardHead
              title="Preparar el servidor"
              subtitle="Se hace una sola vez por empresa"
              icon={<ShieldCheck size={18} color="var(--brand-3)" />}
            />
            <div className="card-pad" style={{ display: 'grid', gap: 12 }}>
              <ol className="small muted" style={{ lineHeight: 1.7, paddingLeft: 20, margin: 0 }}>
                <li>Cree una cuenta y un proyecto gratuito en Supabase.</li>
                <li>Abra <strong>SQL Editor</strong>, pegue el script y ejecútelo.</li>
                <li>En <strong>Project Settings → API</strong> copie la URL y la llave anónima.</li>
                <li>Complete el formulario de la izquierda y conecte la nube.</li>
              </ol>
              <div className="row wrap" style={{ gap: 8 }}>
                <Button variant="secondary" icon={copied ? <Check size={15} /> : <Copy size={15} />} onClick={copySql} disabled={!sql}>
                  {copied ? 'Copiado' : 'Copiar script SQL'}
                </Button>
                <Button variant="ghost" icon={<Download size={15} />} onClick={downloadSql} disabled={!sql}>
                  Descargar .sql
                </Button>
              </div>
              {sql ? (
                <pre
                  style={{
                    maxHeight: 260,
                    overflow: 'auto',
                    background: 'var(--surface-2, #0f172a)',
                    color: 'var(--ink-2, #e2e8f0)',
                    borderRadius: 10,
                    padding: 14,
                    fontSize: 11,
                    lineHeight: 1.5,
                    margin: 0,
                  }}
                >
                  {sql}
                </pre>
              ) : (
                <p className="small faint" style={{ margin: 0 }}>
                  El script también está en <code>public/supabase-schema.sql</code> del proyecto.
                </p>
              )}
            </div>
          </Card>
        </div>
      ) : (
        <>
          <div className="grid-2 mb-16">
            <Card>
              <CardHead
                title="Conexión activa"
                subtitle="Este dispositivo comparte datos con la nube"
                icon={<Cloud size={18} color="var(--brand-3)" />}
                actions={<Badge tone={stateMeta.tone} dot>{stateMeta.label}</Badge>}
              />
              <div className="card-pad form-grid">
                <Field label="Project URL">
                  <Input value={config.url} readOnly />
                </Field>
                <Field label="Llave anónima">
                  <Input value={maskedKey} readOnly />
                </Field>
                <Field label="Cuenta de la nube">
                  <Input value={config.email} readOnly />
                </Field>
                <label className="switch">
                  <input
                    type="checkbox"
                    checked={config.autoSync}
                    onChange={(e) => {
                      setAutoSync(e.target.checked);
                      setConfig(getCloudConfig());
                    }}
                  />
                  Sincronización automática (cada 30 s y al recuperar conexión)
                </label>
                <div className="row wrap" style={{ gap: 8 }}>
                  <Button variant="secondary" icon={<RefreshCw size={15} />} onClick={runSync} disabled={busy}>
                    Sincronizar ahora
                  </Button>
                  <Button variant="ghost" icon={<CloudOff size={15} />} onClick={() => setConfirmAction('disconnect')}>
                    Desconectar
                  </Button>
                </div>
                <p className="small faint" style={{ lineHeight: 1.6, margin: 0 }}>
                  La contraseña de la nube no se guarda en el equipo. Supabase conserva una sesión
                  renovable para que la sincronización funcione sin volver a escribirla.
                </p>
              </div>
            </Card>

            <Card>
              <CardHead
                title="Cambios pendientes"
                subtitle="Se envían solos al recuperar la conexión"
                icon={<CloudUpload size={18} color="var(--brand-3)" />}
                actions={<Badge tone={status.pending > 0 ? 'warn' : 'ok'}>{status.pending}</Badge>}
              />
              {breakdown.length === 0 ? (
                <div className="card-pad">
                  <div className="row" style={{ gap: 10, alignItems: 'center' }}>
                    <Check size={18} color="var(--ok)" />
                    <div>
                      <div className="bold ink">Todo sincronizado</div>
                      <div className="small muted">No hay cambios esperando subir a la nube.</div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="table-wrap">
                  <table className="data">
                    <thead>
                      <tr>
                        <th>Tabla</th>
                        <th className="center">Pendientes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {breakdown.map((row) => (
                        <tr key={row.table}>
                          <td>{TABLE_LABELS[row.table] ?? row.table}</td>
                          <td className="center">
                            <Badge tone="warn">{row.count}</Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="card-pad" style={{ borderTop: '1px solid var(--line)' }}>
                <div className="small muted" style={{ lineHeight: 1.6 }}>
                  Los cambios se guardan primero en este dispositivo. Si no hay internet, la app sigue
                  funcionando y los envía cuando vuelve la conexión.
                </div>
              </div>
            </Card>
          </div>

          <Card className="mb-16">
            <CardHead
              title="Acciones avanzadas"
              subtitle="Úselas solo si necesita alinear un equipo con la nube"
              icon={<KeyRound size={18} color="var(--brand-3)" />}
            />
            <div className="card-pad" style={{ display: 'grid', gap: 14 }}>
              <div className="row-between wrap" style={{ gap: 12 }}>
                <div style={{ maxWidth: 620 }}>
                  <div className="bold ink">Descargar datos del servidor</div>
                  <p className="small muted" style={{ lineHeight: 1.6, margin: 0 }}>
                    Reemplaza los datos locales de este equipo con la copia de la nube. Útil para un
                    equipo nuevo o para recuperar información. Los cambios locales pendientes se pierden.
                  </p>
                </div>
                <Button variant="secondary" icon={<CloudDownload size={15} />} onClick={() => setConfirmAction('pull')} disabled={busy}>
                  Descargar del servidor
                </Button>
              </div>
              <div className="row-between wrap" style={{ gap: 12, borderTop: '1px solid var(--line)', paddingTop: 14 }}>
                <div style={{ maxWidth: 620 }}>
                  <div className="bold ink">Subir este equipo</div>
                  <p className="small muted" style={{ lineHeight: 1.6, margin: 0 }}>
                    Fuerza que todo el contenido local se envíe a la nube. Los registros del servidor que
                    no existan aquí se conservan.
                  </p>
                </div>
                <Button variant="secondary" icon={<CloudUpload size={15} />} onClick={() => setConfirmAction('push')} disabled={busy}>
                  Subir este equipo
                </Button>
              </div>
              <div className="row" style={{ gap: 8, alignItems: 'flex-start' }}>
                <ShieldCheck size={16} color="var(--brand-3)" style={{ flex: 'none', marginTop: 2 }} />
                <p className="small muted" style={{ lineHeight: 1.6, margin: 0 }}>
                  Los usuarios, sus roles y los hashes PBKDF2 de las contraseñas también se comparten.
                  Use una contraseña de nube robusta y no publique la URL del proyecto.
                </p>
              </div>
            </div>
          </Card>
        </>
      )}

      <ConfirmDialog
        open={confirmAction === 'disconnect'}
        title="Desconectar la nube"
        message="Este equipo dejará de sincronizarse. Los datos locales se conservan y podrá reconectar cuando quiera."
        confirmLabel="Desconectar"
        tone="danger"
        busy={busy}
        onCancel={() => setConfirmAction(null)}
        onConfirm={disconnect}
      />

      <ConfirmDialog
        open={confirmAction === 'pull'}
        title="Descargar datos del servidor"
        message="Se borrarán los datos locales de este equipo y se reemplazarán por los de la nube. Los cambios pendientes de subir se perderán. ¿Desea continuar?"
        confirmLabel="Descargar y reemplazar"
        tone="danger"
        busy={busy}
        onCancel={() => setConfirmAction(null)}
        onConfirm={forceDownload}
      />

      <ConfirmDialog
        open={confirmAction === 'push'}
        title="Subir este equipo"
        message="Todo el contenido local se enviará a la nube. Los registros del servidor que no existan en este equipo se conservan. ¿Desea continuar?"
        confirmLabel="Subir datos"
        tone="primary"
        busy={busy}
        onCancel={() => setConfirmAction(null)}
        onConfirm={forceUpload}
      />
    </>
  );
}

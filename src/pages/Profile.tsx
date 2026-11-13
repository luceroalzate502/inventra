import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  Calendar,
  CheckCircle2,
  Clock,
  KeyRound,
  Lock,
  LogOut,
  Mail,
  Moon,
  Phone,
  ShieldCheck,
  Sun,
  UserRound,
} from 'lucide-react';
import { db } from '../db/schema';
import { useApp } from '../context/AppContext';
import { hashPin, readSession, verifyPin } from '../domain/auth';
import { dateTime, initials, uid } from '../domain/format';
import { PERMISSION_LABELS, permissionsOf } from '../domain/permissions';
import { ROLES } from '../domain/types';
import {
  Badge,
  Button,
  Card,
  CardHead,
  Field,
  Input,
  PageHeader,
  StatCard,
  cx,
} from '../components/ui';

export function Profile() {
  const { user, theme, toggleTheme, logout, toast } = useApp();
  const record = useLiveQuery(() => (user ? db.users.get(user.id) : undefined), [user?.id]);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);

  const session = readSession();
  const permissions = user ? permissionsOf(user.role) : [];

  const changePassword = async () => {
    if (!user || !record) return;
    if (!current) {
      toast('Ingrese su contraseña actual', 'warn');
      return;
    }
    if (next.length < 6) {
      toast('Contraseña muy corta', 'warn', 'Use al menos 6 caracteres.');
      return;
    }
    if (next !== confirm) {
      toast('Las contraseñas no coinciden', 'warn');
      return;
    }
    setBusy(true);
    try {
      const valid = await verifyPin(current, record.pinHash, record.salt);
      if (!valid) {
        toast('Contraseña actual incorrecta', 'error', 'Verifique e intente nuevamente.');
        return;
      }
      const { hash, salt } = await hashPin(next);
      await db.users.update(record.id, {
        pinHash: hash,
        salt,
        failedAttempts: 0,
        lockedUntil: null,
      });
      await db.audit.add({
        id: uid(),
        entity: 'user',
        entityId: record.id,
        action: 'actualizar',
        summary: `Cambio de contraseña del propio usuario (${record.email})`,
        userId: record.id,
        userName: record.name,
        at: new Date().toISOString(),
      });
      setCurrent('');
      setNext('');
      setConfirm('');
      toast('Contraseña actualizada', 'success', 'Use la nueva clave en su próximo ingreso.');
    } catch (err) {
      toast('No fue posible actualizar', 'error', err instanceof Error ? err.message : 'Intente nuevamente.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader title="Mi perfil" subtitle="Información de la cuenta, seguridad y permisos" />

      <Card className="mb-16">
        <div className="detail-hero">
          <div className="avatar-lg">{initials(record?.name ?? user?.name ?? '')}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="detail-title">{record?.name ?? user?.name}</div>
            <div className="detail-sub">
              {record?.email ?? user?.email}
              {record?.phone ? ` · ${record.phone}` : ''}
            </div>
            <div className="row wrap mt-8" style={{ gap: 6 }}>
              {user && <Badge tone="brand">{ROLES[user.role].label}</Badge>}
              <Badge tone={record?.active === false ? 'danger' : 'ok'} dot>
                {record?.active === false ? 'Inactivo' : 'Cuenta activa'}
              </Badge>
              {record?.lastLoginAt && (
                <Badge tone="muted">
                  <Clock size={11} /> Último ingreso {dateTime(record.lastLoginAt)}
                </Badge>
              )}
            </div>
          </div>
          <Button variant="secondary" icon={<LogOut size={15} />} onClick={logout}>
            Cerrar sesión
          </Button>
        </div>
      </Card>

      <div className="kpi-grid">
        <StatCard
          label="Rol asignado"
          value={user ? ROLES[user.role].short : '—'}
          icon={<ShieldCheck size={18} />}
          tone="brand"
          foot={<span>{permissions.length} permisos</span>}
        />
        <StatCard
          label="Miembro desde"
          value={record ? new Date(record.createdAt).toLocaleDateString('es-CO') : '—'}
          icon={<Calendar size={18} />}
          tone="info"
          foot={<span>fecha de creación</span>}
        />
        <StatCard
          label="Último ingreso"
          value={record?.lastLoginAt ? new Date(record.lastLoginAt).toLocaleDateString('es-CO') : '—'}
          icon={<Clock size={18} />}
          tone="ok"
          foot={<span>{record?.lastLoginAt ? dateTime(record.lastLoginAt) : 'sin registro'}</span>}
        />
        <StatCard
          label="Sesión expira"
          value={session ? new Date(session.expiresAt).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' }) : '—'}
          icon={<Lock size={18} />}
          tone="warn"
          foot={<span>por inactividad</span>}
        />
      </div>

      <div className="grid-2 mb-16">
        <Card>
          <CardHead
            title="Datos de la cuenta"
            subtitle="Información administrada por el área de sistemas"
            icon={<UserRound size={18} color="var(--brand-3)" />}
          />
          <div className="card-pad meta-grid">
            <div>
              <div className="meta-label">Nombre</div>
              <div className="meta-value">{record?.name ?? user?.name ?? '—'}</div>
            </div>
            <div>
              <div className="meta-label">Correo</div>
              <div className="meta-value">{record?.email ?? user?.email ?? '—'}</div>
            </div>
            <div>
              <div className="meta-label">Teléfono</div>
              <div className="meta-value">{record?.phone || 'No registrado'}</div>
            </div>
            <div>
              <div className="meta-label">Rol</div>
              <div className="meta-value">{user ? ROLES[user.role].label : '—'}</div>
            </div>
            <div>
              <div className="meta-label">Estado</div>
              <div className="meta-value">{record?.active === false ? 'Inactivo' : 'Activo'}</div>
            </div>
            <div>
              <div className="meta-label">Creado</div>
              <div className="meta-value">{record ? dateTime(record.createdAt) : '—'}</div>
            </div>
          </div>
          <div className="card-pad" style={{ paddingTop: 0 }}>
            <div className="row wrap small muted" style={{ gap: 14 }}>
              <span className="row" style={{ gap: 6 }}>
                <Mail size={14} /> {record?.email ?? user?.email}
              </span>
              <span className="row" style={{ gap: 6 }}>
                <Phone size={14} /> {record?.phone || 'Sin teléfono'}
              </span>
            </div>
          </div>
        </Card>

        <Card>
          <CardHead
            title="Cambiar contraseña"
            subtitle="Actualice su clave de acceso personal"
            icon={<KeyRound size={18} color="var(--brand-3)" />}
          />
          <div className="card-pad form-grid">
            <Field label="Contraseña actual">
              <Input
                type="password"
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
                placeholder="••••••••"
                autoComplete="current-password"
              />
            </Field>
            <div className="field-row">
              <Field label="Nueva contraseña" hint="Mínimo 6 caracteres.">
                <Input
                  type="password"
                  value={next}
                  onChange={(e) => setNext(e.target.value)}
                  placeholder="••••••••"
                  autoComplete="new-password"
                />
              </Field>
              <Field label="Confirmar contraseña">
                <Input
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  placeholder="••••••••"
                  autoComplete="new-password"
                />
              </Field>
            </div>
            <div className="row-between wrap" style={{ gap: 10 }}>
              <span className="small faint">La clave se guarda cifrada con PBKDF2-SHA256.</span>
              <Button variant="primary" icon={<KeyRound size={15} />} onClick={changePassword} disabled={busy}>
                {busy ? <span className="spinner" /> : null}
                Actualizar contraseña
              </Button>
            </div>
          </div>
        </Card>
      </div>

      <div className="grid-2">
        <Card>
          <CardHead
            title="Permisos de mi rol"
            subtitle={user ? ROLES[user.role].label : ''}
            icon={<ShieldCheck size={18} color="var(--brand-3)" />}
          />
          <div className="card-pad" style={{ display: 'grid', gap: 8 }}>
            {permissions.length === 0 ? (
              <span className="small muted">Este rol no tiene permisos operativos asignados.</span>
            ) : (
              permissions.map((p) => (
                <div key={p} className="row" style={{ gap: 9, fontSize: 12.5 }}>
                  <CheckCircle2 size={15} color="var(--ok)" style={{ flex: 'none' }} />
                  <span>{PERMISSION_LABELS[p]}</span>
                </div>
              ))
            )}
          </div>
        </Card>

        <Card>
          <CardHead
            title="Preferencias y sesión"
            subtitle="Apariencia y cierre seguro"
            icon={<Lock size={18} color="var(--brand-3)" />}
          />
          <div className="card-pad" style={{ display: 'grid', gap: 16 }}>
            <div>
              <div className="meta-label mb-8">Tema de la interfaz</div>
              <div className="segmented">
                <button className={cx(theme === 'light' && 'active')} onClick={() => theme === 'dark' && toggleTheme()}>
                  <Sun size={14} style={{ marginRight: 6, display: 'inline' }} />
                  Claro
                </button>
                <button className={cx(theme === 'dark' && 'active')} onClick={() => theme === 'light' && toggleTheme()}>
                  <Moon size={14} style={{ marginRight: 6, display: 'inline' }} />
                  Oscuro
                </button>
              </div>
            </div>
            <div className="small muted" style={{ lineHeight: 1.6 }}>
              La sesión se renueva con su actividad y expira automáticamente por inactividad. Si usa un
              equipo compartido, cierre sesión al terminar.
            </div>
            <Button variant="danger" icon={<LogOut size={15} />} onClick={logout}>
              Cerrar sesión en este dispositivo
            </Button>
          </div>
        </Card>
      </div>
    </>
  );
}

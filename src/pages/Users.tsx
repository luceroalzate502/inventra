import { Fragment, useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  Check,
  KeyRound,
  Lock,
  Pencil,
  Power,
  PowerOff,
  RotateCcw,
  Save,
  ShieldCheck,
  UserPlus,
  Users as UsersIcon,
  X,
} from 'lucide-react';
import { db } from '../db/schema';
import { useApp } from '../context/AppContext';
import { hashPin } from '../domain/auth';
import { dateTime, initials, uid } from '../domain/format';
import {
  ALL_PERMISSIONS,
  can,
  isPermission,
  isPermissionLocked,
  PERMISSION_GROUPS,
  PERMISSION_LABELS,
  permissionsOf,
} from '../domain/permissions';
import type { Permission, RolePermission } from '../domain/permissions';
import { ROLES } from '../domain/types';
import type { Role, User } from '../domain/types';
import {
  Badge,
  Button,
  Card,
  CardHead,
  ConfirmDialog,
  EmptyState,
  Field,
  IconButton,
  Input,
  Modal,
  PageHeader,
  SearchInput,
  Select,
  StatCard,
  cx,
} from '../components/ui';

const ROLE_ORDER: Role[] = ['admin', 'jefe', 'almacenista', 'produccion', 'consulta'];

const ROLE_TONE: Record<Role, 'brand' | 'info' | 'ok' | 'warn' | 'muted'> = {
  admin: 'brand',
  jefe: 'info',
  almacenista: 'ok',
  produccion: 'warn',
  consulta: 'muted',
};

type Matrix = Record<Role, Partial<Record<Permission, boolean>>>;

const EMPTY_RULES: RolePermission[] = [];

/** Combina los permisos originales de cada rol con las autorizaciones guardadas. */
function buildMatrix(rules: RolePermission[]): Matrix {
  const out = {} as Matrix;
  for (const role of ROLE_ORDER) {
    const defaults = new Set(permissionsOf(role));
    const row: Partial<Record<Permission, boolean>> = {};
    for (const perm of ALL_PERMISSIONS) row[perm] = isPermissionLocked(role, perm) || defaults.has(perm);
    const saved = rules.find((r) => r.role === role);
    if (saved) {
      for (const [key, value] of Object.entries(saved.grants ?? {})) {
        if (isPermission(key) && typeof value === 'boolean') row[key] = value;
      }
    }
    out[role] = row;
  }
  return out;
}

interface UserForm {
  name: string;
  email: string;
  role: Role;
  phone: string;
  active: boolean;
  password: string;
  confirm: string;
}

const EMPTY_FORM: UserForm = {
  name: '',
  email: '',
  role: 'almacenista',
  phone: '',
  active: true,
  password: '',
  confirm: '',
};

export function Users() {
  const { user, toast } = useApp();
  const users = useLiveQuery(() => db.users.toArray(), []) ?? [];
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<'all' | Role>('all');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<User | null>(null);
  const [form, setForm] = useState<UserForm>(EMPTY_FORM);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [resetTarget, setResetTarget] = useState<User | null>(null);
  const [resetPin, setResetPin] = useState('');
  const [resetConfirm, setResetConfirm] = useState('');
  const [toggleTarget, setToggleTarget] = useState<User | null>(null);
  const rules = useLiveQuery(() => db.permissions.toArray(), []) ?? EMPTY_RULES;
  const [matrix, setMatrix] = useState<Matrix>(() => buildMatrix(EMPTY_RULES));
  const [matrixDirty, setMatrixDirty] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);

  useEffect(() => {
    setMatrix(buildMatrix(rules));
    setMatrixDirty(false);
  }, [rules]);

  const canManage = user ? can(user.role, 'users.manage') : false;

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return users
      .filter((u) => roleFilter === 'all' || u.role === roleFilter)
      .filter(
        (u) =>
          !term ||
          u.name.toLowerCase().includes(term) ||
          u.email.toLowerCase().includes(term) ||
          (u.phone ?? '').includes(term),
      )
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [users, roleFilter, search]);

  const stats = {
    total: users.length,
    active: users.filter((u) => u.active).length,
    admins: users.filter((u) => u.role === 'admin').length,
    locked: users.filter((u) => (u.lockedUntil ?? 0) > Date.now()).length,
  };

  const set = <K extends keyof UserForm>(key: K, value: UserForm[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setErrors({});
    setFormOpen(true);
  };

  const openEdit = (u: User) => {
    setEditing(u);
    setForm({
      name: u.name,
      email: u.email,
      role: u.role,
      phone: u.phone ?? '',
      active: u.active,
      password: '',
      confirm: '',
    });
    setErrors({});
    setFormOpen(true);
  };

  const save = async () => {
    if (!user) return;
    const e: Record<string, string> = {};
    if (form.name.trim().length < 3) e.name = 'Indique el nombre completo.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) e.email = 'Correo inválido.';
    if (!editing && form.password.length < 6) e.password = 'Mínimo 6 caracteres.';
    if (form.password && form.password.length < 6) e.password = 'Mínimo 6 caracteres.';
    if (form.password !== form.confirm) e.confirm = 'Las contraseñas no coinciden.';
    if (editing?.id === user.id && (!form.active || form.role !== 'admin')) {
      e.role = 'No puede desactivar ni retirar el rol administrador de su propia cuenta.';
    }
    setErrors(e);
    if (Object.keys(e).length > 0) return;

    setBusy(true);
    try {
      const email = form.email.trim().toLowerCase();
      const duplicate = await db.users.where('email').equals(email).first();
      if (duplicate && duplicate.id !== editing?.id) {
        setErrors({ email: 'Ya existe un usuario con este correo.' });
        return;
      }

      const now = new Date().toISOString();
      if (editing) {
        const patch: Partial<User> = {
          name: form.name.trim(),
          email,
          role: form.role,
          phone: form.phone.trim() || undefined,
          active: form.active,
        };
        if (form.password) {
          const { hash, salt } = await hashPin(form.password);
          patch.pinHash = hash;
          patch.salt = salt;
          patch.failedAttempts = 0;
          patch.lockedUntil = null;
        }
        await db.users.update(editing.id, patch);
        await db.audit.add({
          id: uid(),
          entity: 'user',
          entityId: editing.id,
          action: 'actualizar',
          summary: `Usuario ${email} actualizado${form.password ? ' (contraseña restablecida)' : ''}`,
          before: { name: editing.name, email: editing.email, role: editing.role, active: editing.active },
          after: patch,
          userId: user.id,
          userName: user.name,
          at: now,
        });
        toast('Usuario actualizado', 'success', `${form.name.trim()} · ${ROLES[form.role].label}`);
      } else {
        const { hash, salt } = await hashPin(form.password);
        const created: User = {
          id: uid(),
          name: form.name.trim(),
          email,
          role: form.role,
          pinHash: hash,
          salt,
          active: form.active,
          failedAttempts: 0,
          lockedUntil: null,
          createdAt: now,
          lastLoginAt: null,
          phone: form.phone.trim() || undefined,
        };
        await db.users.add(created);
        await db.audit.add({
          id: uid(),
          entity: 'user',
          entityId: created.id,
          action: 'crear',
          summary: `Usuario ${created.email} creado con rol ${ROLES[created.role].label}`,
          after: { name: created.name, email: created.email, role: created.role, active: created.active },
          userId: user.id,
          userName: user.name,
          at: now,
        });
        toast('Usuario creado', 'success', `${created.name} · ${ROLES[created.role].label}`);
      }
      setFormOpen(false);
    } catch (err) {
      toast('No fue posible guardar', 'error', err instanceof Error ? err.message : 'Intente nuevamente.');
    } finally {
      setBusy(false);
    }
  };

  const resetPassword = async () => {
    if (!user || !resetTarget) return;
    if (resetPin.length < 6) {
      toast('Contraseña muy corta', 'warn', 'Use al menos 6 caracteres.');
      return;
    }
    if (resetPin !== resetConfirm) {
      toast('Las contraseñas no coinciden', 'warn');
      return;
    }
    setBusy(true);
    try {
      const { hash, salt } = await hashPin(resetPin);
      await db.users.update(resetTarget.id, {
        pinHash: hash,
        salt,
        failedAttempts: 0,
        lockedUntil: null,
      });
      await db.audit.add({
        id: uid(),
        entity: 'user',
        entityId: resetTarget.id,
        action: 'actualizar',
        summary: `Contraseña restablecida para ${resetTarget.email}`,
        userId: user.id,
        userName: user.name,
        at: new Date().toISOString(),
      });
      toast('Contraseña restablecida', 'success', `${resetTarget.name} podrá ingresar con la nueva clave.`);
      setResetTarget(null);
      setResetPin('');
      setResetConfirm('');
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async () => {
    if (!user || !toggleTarget) return;
    if (toggleTarget.id === user.id) {
      toast('Acción no permitida', 'warn', 'No puede desactivar su propia cuenta.');
      setToggleTarget(null);
      return;
    }
    setBusy(true);
    try {
      const next = !toggleTarget.active;
      await db.users.update(toggleTarget.id, {
        active: next,
        failedAttempts: 0,
        lockedUntil: null,
      });
      await db.audit.add({
        id: uid(),
        entity: 'user',
        entityId: toggleTarget.id,
        action: 'actualizar',
        summary: `${next ? 'Activación' : 'Desactivación'} del usuario ${toggleTarget.email}`,
        before: { active: toggleTarget.active },
        after: { active: next },
        userId: user.id,
        userName: user.name,
        at: new Date().toISOString(),
      });
      toast(next ? 'Usuario activado' : 'Usuario desactivado', 'success', toggleTarget.name);
      setToggleTarget(null);
    } finally {
      setBusy(false);
    }
  };

  const togglePermission = (role: Role, perm: Permission) => {
    if (isPermissionLocked(role, perm)) return;
    setMatrix((prev) => ({
      ...prev,
      [role]: { ...prev[role], [perm]: !prev[role][perm] },
    }));
    setMatrixDirty(true);
  };

  const saveMatrix = async () => {
    if (!user) return;
    setBusy(true);
    try {
      const before = await db.permissions.toArray();
      const records: RolePermission[] = ROLE_ORDER.map((role) => ({
        role,
        grants: { ...matrix[role] },
      }));
      // `put` activa los hooks de sincronización; `bulkPut` no los ejecuta.
      for (const record of records) await db.permissions.put(record);
      await db.audit.add({
        id: uid(),
        entity: 'permissions',
        entityId: 'global',
        action: 'actualizar',
        summary: 'Autorizaciones de funciones actualizadas manualmente',
        before,
        after: records,
        userId: user.id,
        userName: user.name,
        at: new Date().toISOString(),
      });
      toast(
        'Permisos guardados',
        'success',
        'Los cambios aplican de inmediato a todos los usuarios de cada rol.',
      );
    } catch (err) {
      toast('No fue posible guardar', 'error', err instanceof Error ? err.message : 'Intente nuevamente.');
    } finally {
      setBusy(false);
    }
  };

  const resetMatrix = async () => {
    if (!user) return;
    setBusy(true);
    try {
      const before = await db.permissions.toArray();
      // Borrar uno por uno activa el hook que marca cada rol como eliminado en la nube.
      for (const row of before) await db.permissions.delete(row.role);
      await db.audit.add({
        id: uid(),
        entity: 'permissions',
        entityId: 'global',
        action: 'revertir',
        summary: 'Autorizaciones de funciones restablecidas a los valores originales',
        before,
        after: [],
        userId: user.id,
        userName: user.name,
        at: new Date().toISOString(),
      });
      setResetOpen(false);
      toast('Permisos restablecidos', 'success', 'Cada rol volvió a sus funciones originales.');
    } catch (err) {
      toast('No fue posible restablecer', 'error', err instanceof Error ? err.message : 'Intente nuevamente.');
    } finally {
      setBusy(false);
    }
  };

  if (!canManage) {
    return (
      <Card>
        <EmptyState
          icon={<Lock size={24} />}
          title="Acceso restringido"
          message="Solo los administradores pueden gestionar usuarios y roles."
        />
      </Card>
    );
  }

  return (
    <>
      <PageHeader
        title="Usuarios y roles"
        subtitle="Control de acceso, perfiles y permisos del sistema"
        actions={
          <Button variant="primary" icon={<UserPlus size={16} />} onClick={openCreate}>
            Nuevo usuario
          </Button>
        }
      />

      <div className="kpi-grid">
        <StatCard label="Usuarios" value={stats.total} icon={<UsersIcon size={18} />} tone="brand" foot={<span>en el sistema</span>} />
        <StatCard label="Activos" value={stats.active} icon={<Power size={18} />} tone="ok" foot={<span>pueden iniciar sesión</span>} />
        <StatCard label="Administradores" value={stats.admins} icon={<ShieldCheck size={18} />} tone="info" foot={<span>acceso total</span>} />
        <StatCard label="Bloqueados" value={stats.locked} icon={<Lock size={18} />} tone={stats.locked > 0 ? 'danger' : 'muted'} foot={<span>por intentos fallidos</span>} />
      </div>

      <Card className="mb-16">
        <div className="card-pad" style={{ display: 'grid', gap: 12 }}>
          <div className="row wrap" style={{ gap: 10 }}>
            <SearchInput value={search} onChange={setSearch} placeholder="Buscar por nombre, correo o teléfono…" />
            <Select
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value as 'all' | Role)}
              style={{ maxWidth: 220 }}
            >
              <option value="all">Todos los roles</option>
              {ROLE_ORDER.map((r) => (
                <option key={r} value={r}>
                  {ROLES[r].label}
                </option>
              ))}
            </Select>
          </div>
        </div>

        {rows.length === 0 ? (
          <EmptyState
            icon={<UsersIcon size={24} />}
            title="Sin usuarios"
            message="No hay usuarios que coincidan con los filtros seleccionados."
            action={
              <Button variant="primary" icon={<UserPlus size={15} />} onClick={openCreate}>
                Crear usuario
              </Button>
            }
          />
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Usuario</th>
                  <th>Rol</th>
                  <th>Estado</th>
                  <th>Teléfono</th>
                  <th>Último ingreso</th>
                  <th>Creado</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((u) => {
                  const locked = (u.lockedUntil ?? 0) > Date.now();
                  return (
                    <tr key={u.id}>
                      <td>
                        <div className="row" style={{ gap: 10 }}>
                          <div className="avatar">{initials(u.name)}</div>
                          <div className="cell-main">
                            <span className="name">
                              {u.name}
                              {u.id === user?.id && <span className="faint small"> · usted</span>}
                            </span>
                            <span className="sku">{u.email}</span>
                          </div>
                        </div>
                      </td>
                      <td>
                        <Badge tone={ROLE_TONE[u.role]}>{ROLES[u.role].label}</Badge>
                      </td>
                      <td>
                        {locked ? (
                          <Badge tone="danger" dot>
                            Bloqueado
                          </Badge>
                        ) : u.active ? (
                          <Badge tone="ok" dot>
                            Activo
                          </Badge>
                        ) : (
                          <Badge tone="muted" dot>
                            Inactivo
                          </Badge>
                        )}
                      </td>
                      <td className="small muted">{u.phone || '—'}</td>
                      <td className="small muted">{u.lastLoginAt ? dateTime(u.lastLoginAt) : 'Sin ingreso'}</td>
                      <td className="small muted">{dateTime(u.createdAt)}</td>
                      <td>
                        <div className="row" style={{ gap: 4, justifyContent: 'flex-end' }}>
                          <IconButton label="Editar usuario" onClick={() => openEdit(u)}>
                            <Pencil size={15} />
                          </IconButton>
                          <IconButton
                            label="Restablecer contraseña"
                            onClick={() => {
                              setResetTarget(u);
                              setResetPin('');
                              setResetConfirm('');
                            }}
                          >
                            <KeyRound size={15} />
                          </IconButton>
                          <IconButton
                            label={u.active ? 'Desactivar usuario' : 'Activar usuario'}
                            onClick={() => setToggleTarget(u)}
                            disabled={u.id === user?.id}
                          >
                            {u.active ? <PowerOff size={15} /> : <Power size={15} />}
                          </IconButton>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="table-foot">
          <span>{rows.length} de {users.length} usuarios</span>
          <span className="small faint">Las contraseñas se almacenan con PBKDF2-SHA256</span>
        </div>
      </Card>

      <Card>
        <CardHead
          title="Autorización de funciones"
          subtitle="Haga clic en cada celda para autorizar o denegar una función por rol."
          icon={<ShieldCheck size={18} color="var(--brand-3)" />}
          actions={
            <>
              {matrixDirty && <Badge tone="warn" dot>Sin guardar</Badge>}
              <Button
                variant="ghost"
                size="sm"
                icon={<RotateCcw size={14} />}
                onClick={() => setResetOpen(true)}
                disabled={busy || rules.length === 0}
              >
                Restablecer
              </Button>
              <Button
                variant="primary"
                size="sm"
                icon={<Save size={14} />}
                onClick={() => void saveMatrix()}
                disabled={busy || !matrixDirty}
              >
                Guardar permisos
              </Button>
            </>
          }
        />
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Permiso</th>
                {ROLE_ORDER.map((r) => (
                  <th key={r} className="center">
                    {ROLES[r].short}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {PERMISSION_GROUPS.map((group) => (
                <Fragment key={group.label}>
                  <tr>
                    <td colSpan={ROLE_ORDER.length + 1}>
                      <span className="form-section-title" style={{ border: 'none', padding: 0, margin: 0 }}>
                        {group.label}
                      </span>
                    </td>
                  </tr>
                  {group.permissions.map((perm) => (
                    <tr key={perm}>
                      <td>{PERMISSION_LABELS[perm]}</td>
                      {ROLE_ORDER.map((r) => {
                        const granted = Boolean(matrix[r][perm]);
                        const locked = isPermissionLocked(r, perm);
                        return (
                          <td key={r} className="center">
                            <button
                              type="button"
                              className={cx('perm-toggle', granted && 'on')}
                              aria-pressed={granted}
                              aria-label={`${ROLES[r].label}: ${PERMISSION_LABELS[perm]}`}
                              title={
                                locked
                                  ? 'Función protegida: el administrador siempre debe poder administrar usuarios y configuración.'
                                  : granted
                                    ? 'Autorizada. Haga clic para denegar.'
                                    : 'Denegada. Haga clic para autorizar.'
                              }
                              disabled={locked || busy}
                              onClick={() => togglePermission(r, perm)}
                            >
                              {granted ? <Check size={16} /> : <X size={15} />}
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editing ? 'Editar usuario' : 'Nuevo usuario'}
        subtitle={editing ? editing.email : 'Defina el perfil y las credenciales de acceso'}
        footer={
          <>
            <Button variant="ghost" onClick={() => setFormOpen(false)} disabled={busy}>
              Cancelar
            </Button>
            <Button variant="primary" onClick={save} disabled={busy}>
              {busy ? <span className="spinner" /> : null}
              {editing ? 'Guardar cambios' : 'Crear usuario'}
            </Button>
          </>
        }
      >
        <div className="form-grid">
          <Field label="Nombre completo" error={errors.name}>
            <Input
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              placeholder="Nombre y apellidos"
            />
          </Field>
          <Field label="Correo corporativo" error={errors.email} hint="Será el usuario de ingreso.">
            <Input
              type="email"
              value={form.email}
              onChange={(e) => set('email', e.target.value)}
              placeholder="usuario@empresa.co"
            />
          </Field>
          <div className="field-row">
            <Field label="Rol" error={errors.role}>
              <Select value={form.role} onChange={(e) => set('role', e.target.value as Role)}>
                {ROLE_ORDER.map((r) => (
                  <option key={r} value={r}>
                    {ROLES[r].label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Teléfono">
              <Input
                value={form.phone}
                onChange={(e) => set('phone', e.target.value)}
                placeholder="+57 300 000 0000"
              />
            </Field>
          </div>
          <div className="field-row">
            <Field
              label={editing ? 'Nueva contraseña (opcional)' : 'Contraseña'}
              error={errors.password}
              hint="Mínimo 6 caracteres."
            >
              <Input
                type="password"
                value={form.password}
                onChange={(e) => set('password', e.target.value)}
                placeholder="••••••••"
                autoComplete="new-password"
              />
            </Field>
            <Field label="Confirmar contraseña" error={errors.confirm}>
              <Input
                type="password"
                value={form.confirm}
                onChange={(e) => set('confirm', e.target.value)}
                placeholder="••••••••"
                autoComplete="new-password"
              />
            </Field>
          </div>
          <label className="switch">
            <input
              type="checkbox"
              checked={form.active}
              onChange={(e) => set('active', e.target.checked)}
            />
            Usuario activo (puede iniciar sesión)
          </label>
        </div>
      </Modal>

      <Modal
        open={Boolean(resetTarget)}
        onClose={() => setResetTarget(null)}
        title="Restablecer contraseña"
        subtitle={resetTarget ? `${resetTarget.name} · ${resetTarget.email}` : ''}
        footer={
          <>
            <Button variant="ghost" onClick={() => setResetTarget(null)} disabled={busy}>
              Cancelar
            </Button>
            <Button variant="primary" icon={<KeyRound size={15} />} onClick={resetPassword} disabled={busy}>
              {busy ? <span className="spinner" /> : null}
              Restablecer
            </Button>
          </>
        }
      >
        <p className="small muted" style={{ lineHeight: 1.6 }}>
          La nueva clave reemplaza la anterior y habilita de nuevo la cuenta si estaba bloqueada. Por
          seguridad, compártala por un canal verificado.
        </p>
        <div className="form-grid">
          <Field label="Nueva contraseña" hint="Mínimo 6 caracteres.">
            <Input
              type="password"
              value={resetPin}
              onChange={(e) => setResetPin(e.target.value)}
              placeholder="••••••••"
              autoComplete="new-password"
            />
          </Field>
          <Field label="Confirmar contraseña">
            <Input
              type="password"
              value={resetConfirm}
              onChange={(e) => setResetConfirm(e.target.value)}
              placeholder="••••••••"
              autoComplete="new-password"
            />
          </Field>
        </div>
      </Modal>

      <ConfirmDialog
        open={Boolean(toggleTarget)}
        title={toggleTarget?.active ? 'Desactivar usuario' : 'Activar usuario'}
        message={
          toggleTarget
            ? toggleTarget.active
              ? `${toggleTarget.name} no podrá iniciar sesión hasta que sea activado nuevamente. Sus movimientos históricos se conservan.`
              : `${toggleTarget.name} podrá iniciar sesión nuevamente con sus credenciales actuales.`
            : ''
        }
        confirmLabel={toggleTarget?.active ? 'Desactivar' : 'Activar'}
        tone={toggleTarget?.active ? 'danger' : 'primary'}
        busy={busy}
        onCancel={() => setToggleTarget(null)}
        onConfirm={toggleActive}
      />

      <ConfirmDialog
        open={resetOpen}
        title="Restablecer autorizaciones"
        message="Todas las funciones volverán a la configuración original de cada rol. Esta acción se registra en la auditoría."
        confirmLabel="Restablecer"
        tone="danger"
        busy={busy}
        onCancel={() => setResetOpen(false)}
        onConfirm={() => void resetMatrix()}
      />
    </>
  );
}

import { Fragment, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  ChevronDown,
  ChevronRight,
  Download,
  History,
  LogIn,
  RotateCcw,
  ShieldCheck,
} from 'lucide-react';
import { db } from '../db/schema';
import { useApp } from '../context/AppContext';
import { dateTime, uid } from '../domain/format';
import { exportExcel } from '../domain/export';
import type { AuditEntry } from '../domain/types';
import {
  Badge,
  Button,
  Card,
  CardHead,
  EmptyRow,
  Field,
  Input,
  PageHeader,
  SearchInput,
  Select,
  StatCard,
  cx,
} from '../components/ui';

const ACTION_LABELS: Record<AuditEntry['action'], string> = {
  crear: 'Creación',
  actualizar: 'Actualización',
  revertir: 'Reversión',
  login: 'Sesión',
  cierre: 'Cierre',
  eliminar: 'Eliminación',
};

const ACTION_TONE: Record<AuditEntry['action'], 'ok' | 'info' | 'warn' | 'danger' | 'brand' | 'muted'> = {
  crear: 'ok',
  actualizar: 'info',
  revertir: 'warn',
  login: 'brand',
  cierre: 'info',
  eliminar: 'danger',
};

const ENTITY_LABELS: Record<string, string> = {
  movement: 'Movimiento',
  product: 'Producto',
  user: 'Usuario',
  production: 'Producción',
  production_order: 'Orden de producción',
  bom: 'Lista de materiales',
  count: 'Conteo físico',
  settings: 'Configuración',
  system: 'Sistema',
  session: 'Sesión',
};

const ACTIONS: (AuditEntry['action'] | 'all')[] = [
  'all',
  'crear',
  'actualizar',
  'revertir',
  'login',
  'cierre',
  'eliminar',
];

export function Audit() {
  const { user, settings, toast } = useApp();
  const entries = useLiveQuery(() => db.audit.orderBy('at').reverse().toArray(), []) ?? [];
  const [search, setSearch] = useState('');
  const [entity, setEntity] = useState('all');
  const [action, setAction] = useState<AuditEntry['action'] | 'all'>('all');
  const [userFilter, setUserFilter] = useState('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [visible, setVisible] = useState(60);

  const entities = useMemo(
    () => Array.from(new Set(entries.map((e) => e.entity))).sort(),
    [entries],
  );
  const actors = useMemo(
    () => Array.from(new Set(entries.map((e) => e.userName))).sort(),
    [entries],
  );

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return entries.filter((e) => {
      if (entity !== 'all' && e.entity !== entity) return false;
      if (action !== 'all' && e.action !== action) return false;
      if (userFilter !== 'all' && e.userName !== userFilter) return false;
      const day = e.at.slice(0, 10);
      if (from && day < from) return false;
      if (to && day > to) return false;
      if (!term) return true;
      return (
        e.summary.toLowerCase().includes(term) ||
        e.userName.toLowerCase().includes(term) ||
        e.entityId.toLowerCase().includes(term) ||
        e.entity.toLowerCase().includes(term)
      );
    });
  }, [entries, search, entity, action, userFilter, from, to]);

  const today = new Date().toISOString().slice(0, 10);
  const stats = {
    total: entries.length,
    today: entries.filter((e) => e.at.slice(0, 10) === today).length,
    reversals: entries.filter((e) => e.action === 'revertir').length,
    failed: entries.filter((e) => e.action === 'login' && /fallid/i.test(e.summary)).length,
  };

  const resetFilters = () => {
    setSearch('');
    setEntity('all');
    setAction('all');
    setUserFilter('all');
    setFrom('');
    setTo('');
  };

  const exportLog = () => {
    if (!user) return;
    exportExcel(`invencodi-auditoria-${today}`, [
      {
        name: 'Auditoría',
        rows: filtered.map((e) => ({
          Fecha: dateTime(e.at),
          Usuario: e.userName,
          Entidad: ENTITY_LABELS[e.entity] ?? e.entity,
          Acción: ACTION_LABELS[e.action],
          Resumen: e.summary,
          'ID entidad': e.entityId,
        })),
        widths: [22, 24, 20, 15, 62, 38],
      },
    ]);
    void db.audit.add({
      id: uid(),
      entity: 'system',
      entityId: 'audit-export',
      action: 'crear',
      summary: `Exportación de auditoría (${filtered.length} registros)`,
      userId: user.id,
      userName: user.name,
      at: new Date().toISOString(),
    });
    toast('Auditoría exportada', 'success', `${filtered.length} registros en Excel.`);
  };

  const renderDetail = (entry: AuditEntry) => (
    <tr className="audit-detail-row">
      <td colSpan={6}>
        <div className="grid-2" style={{ gap: 14 }}>
          <div>
            <div className="meta-label">Estado anterior</div>
            <pre className="audit-json">{entry.before ? JSON.stringify(entry.before, null, 2) : 'Sin datos'}</pre>
          </div>
          <div>
            <div className="meta-label">Estado posterior</div>
            <pre className="audit-json">{entry.after ? JSON.stringify(entry.after, null, 2) : 'Sin datos'}</pre>
          </div>
        </div>
      </td>
    </tr>
  );

  return (
    <>
      <PageHeader
        title="Auditoría del sistema"
        subtitle="Registro inmutable de operaciones, accesos y cambios"
        actions={
          <Button variant="secondary" icon={<Download size={16} />} onClick={exportLog} disabled={filtered.length === 0}>
            Exportar Excel
          </Button>
        }
      />

      <div className="kpi-grid">
        <StatCard label="Eventos registrados" value={stats.total} icon={<History size={18} />} tone="brand" foot={<span>bitácora completa</span>} />
        <StatCard label="Eventos de hoy" value={stats.today} icon={<ShieldCheck size={18} />} tone="info" foot={<span>actividad reciente</span>} />
        <StatCard label="Reversiones" value={stats.reversals} icon={<RotateCcw size={18} />} tone="warn" foot={<span>movimientos corregidos</span>} />
        <StatCard label="Ingresos fallidos" value={stats.failed} icon={<LogIn size={18} />} tone={stats.failed > 0 ? 'danger' : 'muted'} foot={<span>intentos rechazados</span>} />
      </div>

      <Card>
        <CardHead
          title="Bitácora de eventos"
          subtitle={`${filtered.length} de ${entries.length} registros · empresa ${settings?.companyName ?? ''}`}
          icon={<ShieldCheck size={18} color="var(--brand-3)" />}
          actions={
            <Button variant="ghost" size="sm" onClick={resetFilters}>
              Limpiar filtros
            </Button>
          }
        />

        <div className="card-pad" style={{ display: 'grid', gap: 12 }}>
          <div className="row wrap" style={{ gap: 10 }}>
            <SearchInput value={search} onChange={setSearch} placeholder="Buscar resumen, usuario o identificador…" />
            <Select value={entity} onChange={(e) => setEntity(e.target.value)} style={{ maxWidth: 190 }}>
              <option value="all">Todas las entidades</option>
              {entities.map((e) => (
                <option key={e} value={e}>
                  {ENTITY_LABELS[e] ?? e}
                </option>
              ))}
            </Select>
            <Select
              value={action}
              onChange={(e) => setAction(e.target.value as AuditEntry['action'] | 'all')}
              style={{ maxWidth: 180 }}
            >
              {ACTIONS.map((a) => (
                <option key={a} value={a}>
                  {a === 'all' ? 'Todas las acciones' : ACTION_LABELS[a]}
                </option>
              ))}
            </Select>
            <Select value={userFilter} onChange={(e) => setUserFilter(e.target.value)} style={{ maxWidth: 200 }}>
              <option value="all">Todos los usuarios</option>
              {actors.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </Select>
          </div>
          <div className="row wrap" style={{ gap: 10 }}>
            <Field label="Desde" className="grow">
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </Field>
            <Field label="Hasta" className="grow">
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </Field>
          </div>
        </div>

        <div className="table-wrap">
          <table className="data audit-table">
            <thead>
              <tr>
                <th style={{ width: 34 }} />
                <th>Fecha y hora</th>
                <th>Usuario</th>
                <th>Entidad</th>
                <th>Acción</th>
                <th>Resumen</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <EmptyRow colSpan={6} message="Sin eventos que coincidan con los filtros aplicados." />
              ) : (
                filtered.slice(0, visible).map((entry) => {
                  const open = expanded === entry.id;
                  return (
                    <Fragment key={entry.id}>
                      <tr
                        onClick={() => setExpanded(open ? null : entry.id)}
                        style={{ cursor: 'pointer' }}
                        className={cx(open && 'row-open')}
                      >
                        <td className="center">
                          {open ? (
                            <ChevronDown size={15} color="var(--brand-3)" />
                          ) : (
                            <ChevronRight size={15} color="var(--faint)" />
                          )}
                        </td>
                        <td className="small nowrap">{dateTime(entry.at)}</td>
                        <td>
                          <div className="cell-main">
                            <span className="name">{entry.userName}</span>
                            <span className="sku">{entry.userId}</span>
                          </div>
                        </td>
                        <td>
                          <div className="cell-main">
                            <span className="name">{ENTITY_LABELS[entry.entity] ?? entry.entity}</span>
                            <span className="sku">{entry.entityId}</span>
                          </div>
                        </td>
                        <td>
                          <Badge tone={ACTION_TONE[entry.action]}>{ACTION_LABELS[entry.action]}</Badge>
                        </td>
                        <td className="small">{entry.summary}</td>
                      </tr>
                      {open && renderDetail(entry)}
                    </Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="table-foot">
          <span>
            {Math.min(visible, filtered.length)} de {filtered.length} registros
          </span>
          {visible < filtered.length ? (
            <Button variant="secondary" size="sm" onClick={() => setVisible((v) => v + 60)}>
              Cargar más
            </Button>
          ) : (
            <span className="small faint">Fin de la bitácora</span>
          )}
        </div>
      </Card>
    </>
  );
}

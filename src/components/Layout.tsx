import { useMemo, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  ArrowDownToLine,
  ArrowLeftRight,
  ArrowUpFromLine,
  BarChart3,
  Bell,
  Boxes,
  ClipboardCheck,
  ClipboardList,
  Cloud,
  Factory,
  FileSpreadsheet,
  Gauge,
  LayoutDashboard,
  Layers,
  LogOut,
  Menu,
  Moon,
  Package,
  Plus,
  QrCode,
  Search,
  Settings,
  ShieldAlert,
  ShieldCheck,
  ShoppingCart,
  Sun,
  Truck,
  Users,
  WifiOff,
} from 'lucide-react';
import { db } from '../db/schema';
import { can } from '../domain/permissions';
import { alertsFor } from '../domain/reports';
import { initials } from '../domain/format';
import { useApp } from '../context/AppContext';
import { ROLES } from '../domain/types';
import type { Permission } from '../domain/permissions';
import { Badge, Button, Modal, cx } from './ui';
import { Scanner } from './Scanner';
import { useSyncStatus } from '../sync/useSync';

interface NavItem {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  end?: boolean;
  perm?: Permission;
}

const GROUPS: { label: string; items: NavItem[] }[] = [
  {
    label: 'Operación',
    items: [
      { to: '/', label: 'Inicio', icon: LayoutDashboard, end: true },
      { to: '/productos', label: 'Productos', icon: Package },
      { to: '/movimientos', label: 'Movimientos', icon: ArrowLeftRight },
      { to: '/entradas/nueva', label: 'Entradas', icon: ArrowDownToLine, perm: 'inventory.entry' },
      { to: '/salidas/nueva', label: 'Salidas', icon: ArrowUpFromLine, perm: 'inventory.exit' },
      { to: '/despachos', label: 'Despachos', icon: Truck, perm: 'dispatch.manage' },
    ],
  },
  {
    label: 'Planta',
    items: [
      { to: '/produccion', label: 'Producción', icon: Factory, perm: 'production.manage' },
      { to: '/produccion-diaria', label: 'Producción diaria', icon: ClipboardCheck, perm: 'production.daily' },
      { to: '/maquinas', label: 'Máquinas', icon: Factory, perm: 'production.manage' },
      { to: '/bom', label: 'Listas de materiales', icon: Layers, perm: 'bom.edit' },
      { to: '/mrp', label: 'MRP', icon: ClipboardList, perm: 'mrp.view' },
      { to: '/pnc', label: 'Producto no conforme', icon: ShieldAlert, perm: 'pnc.manage' },
    ],
  },
  {
    label: 'Análisis',
    items: [
      { to: '/indicadores', label: 'Indicadores OEE', icon: Gauge, perm: 'reports.view' },
      { to: '/reportes', label: 'Reportes', icon: BarChart3, perm: 'reports.view' },
      { to: '/conteo', label: 'Conteo físico', icon: ClipboardCheck, perm: 'counts.manage' },
      { to: '/alertas', label: 'Alertas', icon: Bell },
    ],
  },
  {
    label: 'Administración',
    items: [
      { to: '/datos', label: 'Importar / exportar', icon: FileSpreadsheet, perm: 'data.import' },
      { to: '/usuarios', label: 'Usuarios', icon: Users, perm: 'users.manage' },
      { to: '/auditoria', label: 'Auditoría', icon: ShieldCheck, perm: 'audit.view' },
      { to: '/sincronizacion', label: 'Nube y sincronización', icon: Cloud, perm: 'settings.manage' },
      { to: '/configuracion', label: 'Configuración', icon: Settings, perm: 'settings.manage' },
    ],
  },
];

const TITLES: { path: string; title: string; crumb: string }[] = [
  { path: '/', title: 'Panel de control', crumb: 'Resumen general' },
  { path: '/productos', title: 'Productos', crumb: 'Catálogo de inventario' },
  { path: '/movimientos', title: 'Movimientos', crumb: 'Kardex y trazabilidad' },
  { path: '/kardex', title: 'Kardex del producto', crumb: 'Trazabilidad' },
  { path: '/entradas', title: 'Entradas de inventario', crumb: 'Operación' },
  { path: '/salidas', title: 'Salidas de inventario', crumb: 'Operación' },
  { path: '/produccion', title: 'Producción', crumb: 'Órdenes y costos' },
  { path: '/produccion-diaria', title: 'Producción diaria', crumb: 'Captura por turno y máquina' },
  { path: '/maquinas', title: 'Máquinas', crumb: 'Catálogo de planta' },
  { path: '/bom', title: 'Listas de materiales', crumb: 'BOM' },
  { path: '/mrp', title: 'MRP', crumb: 'Planificación de materiales' },
  { path: '/pnc', title: 'Producto no conforme', crumb: 'PNC y Kaizen' },
  { path: '/despachos', title: 'Despachos', crumb: 'Picking y remisión' },
  { path: '/indicadores', title: 'Indicadores', crumb: 'OEE e inventario' },
  { path: '/datos', title: 'Importar / exportar', crumb: 'Excel y plantillas' },
  { path: '/reportes', title: 'Reportes', crumb: 'Análisis' },
  { path: '/conteo', title: 'Conteo físico', crumb: 'Exactitud' },
  { path: '/alertas', title: 'Alertas', crumb: 'Inventario crítico' },
  { path: '/usuarios', title: 'Usuarios y roles', crumb: 'Administración' },
  { path: '/auditoria', title: 'Auditoría', crumb: 'Administración' },
  { path: '/configuracion', title: 'Configuración', crumb: 'Administración' },
  { path: '/sincronizacion', title: 'Nube y sincronización', crumb: 'Datos compartidos entre equipos' },
  { path: '/perfil', title: 'Mi perfil', crumb: 'Cuenta y seguridad' },
];

export function Layout() {
  const { user, settings, logout, theme, toggleTheme, online, toast } = useApp();
  const location = useLocation();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [quickOpen, setQuickOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);

  const products = useLiveQuery(() => db.products.toArray(), []) ?? [];
  const movements = useLiveQuery(() => db.movements.toArray(), []) ?? [];
  const sync = useSyncStatus();
  const pending = sync.pending;

  const alertCount = useMemo(
    () => alertsFor(products, movements).filter((a) => a.severity === 'agotado' || a.severity === 'critico' || a.severity === 'bajo').length,
    [products, movements],
  );

  const current = TITLES.slice().reverse().find((t) => (t.path === '/' ? location.pathname === '/' : location.pathname.startsWith(t.path)));
  const allowed = (perm?: Permission) => !perm || (user ? can(user.role, perm) : false);

  const groups = GROUPS.map((g) => ({ ...g, items: g.items.filter((i) => allowed(i.perm)) })).filter(
    (g) => g.items.length > 0,
  );

  const go = (to: string) => {
    setMoreOpen(false);
    setQuickOpen(false);
    navigate(to);
  };

  const handleScan = (code: string) => {
    const product = products.find((p) => p.barcode === code || p.sku.toLowerCase() === code.toLowerCase());
    setScanOpen(false);
    if (product) {
      toast('Producto encontrado', 'success', `${product.sku} · ${product.name}`);
      navigate(`/productos/${product.id}`);
    } else {
      toast('Código no registrado', 'warn', `No se encontró un producto con el código ${code}.`);
    }
  };

  const sidebar = (
    <>
      <div className="sidebar-brand">
        <div className="brand-mark">
          <Boxes size={21} />
        </div>
        <div>
          <div className="brand-name">INVENTRA</div>
          <div className="brand-sub">Gestión de inventarios</div>
        </div>
      </div>
      <div className="sidebar-company">
        <Factory size={15} />
        <div className="truncate">{settings?.companyName ?? 'Empresa'}</div>
      </div>
      <nav className="sidebar-nav">
        {groups.map((g) => (
          <div key={g.label}>
            <div className="nav-group-label">{g.label}</div>
            {g.items.map((item) => {
              const Icon = item.icon;
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) => cx('nav-item', isActive && 'active')}
                >
                  <Icon size={17} />
                  <span>{item.label}</span>
                  {item.to === '/alertas' && alertCount > 0 && <span className="nav-badge">{alertCount}</span>}
                </NavLink>
              );
            })}
          </div>
        ))}
      </nav>
      <div className="sidebar-foot">
        <button className="user-chip" onClick={() => go('/perfil')}>
          <div className="avatar">{initials(user?.name ?? '')}</div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="user-chip-name truncate">{user?.name}</div>
            <div className="user-chip-role">{user ? ROLES[user.role].label : ''}</div>
          </div>
          <LogOut size={15} style={{ opacity: 0.5 }} />
        </button>
      </div>
    </>
  );

  return (
    <div className="app-shell">
      <aside className="sidebar">{sidebar}</aside>

      <div className="main">
        <header className="topbar">
          <div style={{ minWidth: 0 }}>
            <div className="topbar-title truncate">{current?.title ?? 'INVENTRA'}</div>
            <div className="topbar-crumb">{current?.crumb ?? 'Gestión de inventarios'}</div>
          </div>

          <div className="topbar-search">
            <Search size={15} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar producto, SKU o código…"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && query.trim()) {
                  navigate(`/productos?q=${encodeURIComponent(query.trim())}`);
                  setQuery('');
                }
              }}
            />
          </div>

          <div className="topbar-actions">
            {!online && (
              <Badge tone="warn">
                <WifiOff size={12} /> Sin conexión
              </Badge>
            )}
            {sync.connected && (
              <button
                className="icon-btn"
                onClick={() => navigate('/sincronizacion')}
                aria-label="Estado de sincronización"
                title={
                  sync.state === 'syncing'
                    ? 'Sincronizando con la nube…'
                    : sync.state === 'error'
                      ? `Error de sincronización: ${sync.lastError ?? 'revise la conexión'}`
                      : pending > 0
                        ? `${pending} cambio(s) pendientes de subir`
                        : 'Todo sincronizado con la nube'
                }
              >
                <Cloud
                  size={17}
                  color={
                    sync.state === 'error'
                      ? 'var(--danger)'
                      : pending > 0
                        ? 'var(--warn)'
                        : 'var(--ok)'
                  }
                />
                {(pending > 0 || sync.state === 'error') && <span className="dot" />}
              </button>
            )}
            <button className="icon-btn" onClick={toggleTheme} aria-label="Cambiar tema" title="Cambiar tema">
              {theme === 'light' ? <Moon size={17} /> : <Sun size={17} />}
            </button>
            <button className="icon-btn" onClick={() => navigate('/alertas')} aria-label="Alertas" title="Alertas">
              <Bell size={17} />
              {alertCount > 0 && <span className="dot" />}
            </button>
            <button
              className="icon-btn"
              onClick={() => setScanOpen(true)}
              aria-label="Escanear"
              title="Escanear código"
            >
              <QrCode size={17} />
            </button>
          </div>
        </header>

        <main className="page">
          <Outlet />
        </main>
      </div>

      <nav className="bottom-nav">
        <button
          className={cx('bottom-item', location.pathname === '/' && 'active')}
          onClick={() => go('/')}
        >
          <LayoutDashboard size={19} />
          Inicio
        </button>
        <button
          className={cx('bottom-item', location.pathname.startsWith('/productos') && 'active')}
          onClick={() => go('/productos')}
        >
          <Package size={19} />
          Productos
        </button>
        <div className="bottom-fab">
          <button onClick={() => setQuickOpen(true)} aria-label="Acciones rápidas">
            <Plus size={24} />
          </button>
        </div>
        <button
          className={cx('bottom-item', location.pathname.startsWith('/movimientos') && 'active')}
          onClick={() => go('/movimientos')}
        >
          <ArrowLeftRight size={19} />
          Movim.
        </button>
        <button className="bottom-item" onClick={() => setMoreOpen(true)}>
          <Menu size={19} />
          Más
        </button>
      </nav>

      <Modal
        open={quickOpen}
        onClose={() => setQuickOpen(false)}
        title="Acciones rápidas"
        subtitle="Operaciones frecuentes de inventario"
      >
        <div className="qa-grid">
          <button className="qa-item" onClick={() => { setQuickOpen(false); setScanOpen(true); }}>
            <QrCode size={20} color="var(--brand-3)" />
            <strong>Escanear producto</strong>
            <span>Buscar por código de barras o QR</span>
          </button>
          <button className="qa-item" onClick={() => go('/entradas/nueva')}>
            <ShoppingCart size={20} color="var(--ok)" />
            <strong>Registrar entrada</strong>
            <span>Compra, devolución o ajuste positivo</span>
          </button>
          <button className="qa-item" onClick={() => go('/salidas/nueva')}>
            <Truck size={20} color="var(--warn)" />
            <strong>Registrar salida</strong>
            <span>Despacho, consumo o baja</span>
          </button>
          <button className="qa-item" onClick={() => go('/produccion/nueva')}>
            <Factory size={20} color="var(--info)" />
            <strong>Nueva orden</strong>
            <span>Programar producción con BOM</span>
          </button>
          <button className="qa-item" onClick={() => go('/produccion-diaria')}>
            <ClipboardCheck size={20} color="var(--brand-3)" />
            <strong>Registrar turno</strong>
            <span>Captura por máquina y turno</span>
          </button>
          <button className="qa-item" onClick={() => go('/despachos')}>
            <Truck size={20} color="var(--warn)" />
            <strong>Despacho</strong>
            <span>Picking y remisión</span>
          </button>
          <button className="qa-item" onClick={() => go('/conteo')}>
            <ClipboardCheck size={20} color="var(--muted)" />
            <strong>Conteo físico</strong>
            <span>Verificar existencias reales</span>
          </button>
          <button className="qa-item" onClick={() => go('/reportes')}>
            <BarChart3 size={20} color="var(--brand)" />
            <strong>Reportes</strong>
            <span>Kardex, valorización y rotación</span>
          </button>
        </div>
      </Modal>

      <Modal open={moreOpen} onClose={() => setMoreOpen(false)} title="Menú" subtitle="Todas las secciones">
        <div style={{ display: 'grid', gap: 4 }}>
          {groups.map((g) => (
            <div key={g.label}>
              <div className="nav-group-label" style={{ color: 'var(--faint)', padding: '10px 4px 6px' }}>
                {g.label}
              </div>
              {g.items.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.to}
                    className="qa-item"
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: '11px 12px' }}
                    onClick={() => go(item.to)}
                  >
                    <Icon size={18} color="var(--brand-3)" />
                    <strong>{item.label}</strong>
                    {item.to === '/alertas' && alertCount > 0 && (
                      <span className="nav-badge" style={{ marginLeft: 'auto', background: 'var(--danger)', color: '#fff', fontSize: 10, padding: '2px 6px', borderRadius: 8 }}>
                        {alertCount}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
        <div className="row-between" style={{ borderTop: '1px solid var(--line)', paddingTop: 14 }}>
          <div className="small muted">
            {!sync.connected
              ? 'Los datos viven solo en este equipo'
              : pending > 0
                ? `${pending} cambio(s) pendientes de subir a la nube`
                : 'Todo sincronizado con la nube'}
          </div>
          <Button
            variant="ghost"
            icon={<LogOut size={15} />}
            onClick={() => {
              setMoreOpen(false);
              logout();
            }}
          >
            Salir
          </Button>
        </div>
      </Modal>

      <Scanner
        open={scanOpen}
        onClose={() => setScanOpen(false)}
        onResult={handleScan}
        title="Escanear producto"
      />
    </div>
  );
}

import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { ShieldAlert } from 'lucide-react';
import { Layout } from './components/Layout';
import { Toaster, Card, EmptyState } from './components/ui';
import { useApp } from './context/AppContext';
import { can } from './domain/permissions';
import type { Permission } from './domain/permissions';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { Products } from './pages/Products';
import { ProductForm } from './pages/ProductForm';
import { ProductDetail } from './pages/ProductDetail';
import { MovementForm } from './pages/MovementForm';
import { Movements } from './pages/Movements';
import { Kardex } from './pages/Kardex';
import { Boms } from './pages/Boms';
import { BomEditor } from './pages/BomEditor';
import { Production } from './pages/Production';
import { ProductionNew } from './pages/ProductionNew';
import { ProductionOrderDetail } from './pages/ProductionOrder';
import { Mrp } from './pages/Mrp';
import { Machines } from './pages/Machines';
import { ProductionDaily } from './pages/ProductionDaily';
import { Dispatches } from './pages/Dispatches';
import { Pnc } from './pages/Pnc';
import { DataTools } from './pages/DataTools';
import { Indicators } from './pages/Indicators';
import { Reports } from './pages/Reports';
import { Counts } from './pages/Counts';
import { Alerts } from './pages/Alerts';
import { Chat } from './pages/Chat';
import { Users } from './pages/Users';
import { Audit } from './pages/Audit';
import { Settings } from './pages/Settings';
import { Profile } from './pages/Profile';
import { CloudPage } from './pages/Cloud';

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
  }, [pathname]);
  return null;
}

function AccessDenied() {
  return (
    <Card>
      <EmptyState
        icon={<ShieldAlert size={26} />}
        title="Acceso restringido"
        message="Su rol no tiene permiso para acceder a esta sección. Contacte al administrador si necesita acceso."
      />
    </Card>
  );
}

function Protected({ children, perm }: { children: ReactNode; perm?: Permission }) {
  const { user, ready } = useApp();
  if (!ready) {
    return (
      <div className="app-boot">
        <span className="spinner" />
        <span>Cargando Invencodi…</span>
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  if (perm && !can(user.role, perm)) return <AccessDenied />;
  return <>{children}</>;
}

const guard = (perm: Permission, element: ReactNode) => (
  <Protected perm={perm}>{element}</Protected>
);

export function App() {
  // En GitHub Pages la app vive en /<repositorio>/; el router debe ignorar esa base.
  const basename = import.meta.env.BASE_URL.replace(/\/$/, '') || '/';

  return (
    <BrowserRouter basename={basename}>
      <ScrollToTop />
      <Routes>
        <Route path="/login" element={<Login />} />

        <Route
          element={
            <Protected>
              <Layout />
            </Protected>
          }
        >
          <Route index element={<Dashboard />} />
          <Route path="productos" element={<Products />} />
          <Route path="productos/nuevo" element={guard('products.edit', <ProductForm />)} />
          <Route path="productos/:id" element={<ProductDetail />} />
          <Route path="productos/:id/editar" element={guard('products.edit', <ProductForm />)} />
          <Route path="movimientos" element={<Movements />} />
          <Route path="kardex/:id" element={<Kardex />} />
          <Route path="entradas/nueva" element={guard('inventory.entry', <MovementForm mode="entry" />)} />
          <Route path="salidas/nueva" element={guard('inventory.exit', <MovementForm mode="exit" />)} />
          <Route path="produccion" element={guard('production.manage', <Production />)} />
          <Route path="produccion/nueva" element={guard('production.manage', <ProductionNew />)} />
          <Route path="produccion/:id" element={guard('production.manage', <ProductionOrderDetail />)} />
          <Route path="produccion-diaria" element={guard('production.daily', <ProductionDaily />)} />
          <Route path="maquinas" element={guard('production.manage', <Machines />)} />
          <Route path="bom" element={guard('bom.edit', <Boms />)} />
          <Route path="bom/nuevo" element={guard('bom.edit', <BomEditor />)} />
          <Route path="bom/:id" element={guard('bom.edit', <BomEditor />)} />
          <Route path="mrp" element={guard('mrp.view', <Mrp />)} />
          <Route path="pnc" element={guard('pnc.manage', <Pnc />)} />
          <Route path="despachos" element={guard('dispatch.manage', <Dispatches />)} />
          <Route path="indicadores" element={guard('reports.view', <Indicators />)} />
          <Route path="datos" element={guard('data.import', <DataTools />)} />
          <Route path="reportes" element={guard('reports.view', <Reports />)} />
          <Route path="conteo" element={guard('counts.manage', <Counts />)} />
          <Route path="alertas" element={<Alerts />} />
          <Route path="chat" element={<Chat />} />
          <Route path="usuarios" element={guard('users.manage', <Users />)} />
          <Route path="auditoria" element={guard('audit.view', <Audit />)} />
          <Route path="configuracion" element={guard('settings.manage', <Settings />)} />
          <Route path="sincronizacion" element={guard('settings.manage', <CloudPage />)} />
          <Route path="perfil" element={<Profile />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
      <Toaster />
    </BrowserRouter>
  );
}

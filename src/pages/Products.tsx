import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { Download, FileText, Package, PackagePlus, Plus, SlidersHorizontal } from 'lucide-react';
import { db } from '../db/schema';
import { useApp } from '../context/AppContext';
import { can } from '../domain/permissions';
import { PRODUCT_TYPES, typeColor, typeLabel } from '../domain/types';
import type { ProductType } from '../domain/types';
import { money, qty as fmtQty } from '../domain/format';
import { exportExcel, exportPdf } from '../domain/export';
import {
  Badge,
  Button,
  Card,
  EmptyRow,
  EmptyState,
  PageHeader,
  ProductStatusBadge,
  SearchInput,
  Select,
  cx,
} from '../components/ui';

export function Products() {
  const { user, settings, toast } = useApp();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const initial = params.get('q') ?? '';
  const [search, setSearch] = useState(initial);
  const [type, setType] = useState<'all' | ProductType>('all');
  const [status, setStatus] = useState<'activo' | 'inactivo' | 'all'>('activo');
  const [location, setLocation] = useState('all');

  useEffect(() => setSearch(initial), [initial]);

  const products = useLiveQuery(() => db.products.toArray(), []);

  const filtered = useMemo(() => {
    if (!products) return [];
    const term = search.trim().toLowerCase();
    return products
      .filter((p) => (status === 'all' ? true : p.status === status))
      .filter((p) => (type === 'all' ? true : p.type === type))
      .filter((p) => (location === 'all' ? true : p.location === location))
      .filter(
        (p) =>
          !term ||
          p.name.toLowerCase().includes(term) ||
          p.sku.toLowerCase().includes(term) ||
          p.barcode.includes(term) ||
          p.category.toLowerCase().includes(term),
      )
      .sort((a, b) => a.sku.localeCompare(b.sku));
  }, [products, search, type, status, location]);

  const totalValue = filtered.reduce((acc, p) => acc + Math.max(p.stock, 0) * p.cost, 0);
  const locations = Array.from(new Set((products ?? []).map((p) => p.location))).sort();
  const canEdit = user ? can(user.role, 'products.edit') : false;

  const rows = filtered.map((p) => ({
    SKU: p.sku,
    Producto: p.name,
    Tipo: typeLabel(p.type),
    Categoría: p.category,
    'U. medida': p.uom,
    Stock: p.stock,
    'Stock mínimo': p.minStock,
    'Costo unitario': p.cost,
    'Valor total': Math.round(p.stock * p.cost),
    Ubicación: p.location,
    Estado: p.status,
  }));

  const doExcel = () => {
    exportExcel('inventario-productos', [{ name: 'Productos', rows, widths: [14, 34, 20, 16, 10, 10, 12, 14, 16, 24, 10] }]);
    toast('Excel generado', 'success', `${rows.length} productos exportados.`);
  };

  const doPdf = () => {
    exportPdf({
      filename: 'inventario-productos',
      title: 'Catálogo de productos',
      subtitle: `${filtered.length} registros · valorizado ${money(totalValue)}`,
      company: settings?.companyName ?? 'INVENTRA',
      user: user?.name,
      landscape: true,
      columns: ['SKU', 'Producto', 'Tipo', 'Stock', 'Mín.', 'Costo', 'Valor', 'Ubicación', 'Estado'],
      rows: filtered.map((p) => [
        p.sku,
        p.name,
        typeLabel(p.type),
        `${fmtQty(p.stock)} ${p.uom}`,
        fmtQty(p.minStock),
        money(p.cost),
        money(p.stock * p.cost),
        p.location,
        p.status,
      ]),
      totals: [`Valor total del inventario filtrado: ${money(totalValue)}`],
    });
    toast('PDF generado', 'success');
  };

  return (
    <>
      <PageHeader
        title="Productos"
        subtitle={`${filtered.length} de ${products?.length ?? 0} referencias · valorizado ${money(totalValue)}`}
        actions={
          <>
            <Button variant="secondary" size="sm" icon={<Download size={15} />} onClick={doExcel} className="desktop-only">
              Excel
            </Button>
            <Button variant="secondary" size="sm" icon={<FileText size={15} />} onClick={doPdf} className="desktop-only">
              PDF
            </Button>
            {canEdit && (
              <Button variant="primary" icon={<Plus size={16} />} onClick={() => navigate('/productos/nuevo')}>
                Nuevo producto
              </Button>
            )}
          </>
        }
      />

      <Card className="mb-16">
        <div className="card-pad" style={{ display: 'grid', gap: 14 }}>
          <div className="row wrap" style={{ gap: 10 }}>
            <SearchInput value={search} onChange={setSearch} placeholder="Buscar por nombre, SKU, código o categoría…" />
            <Select value={status} onChange={(e) => setStatus(e.target.value as typeof status)} style={{ width: 150 }}>
              <option value="activo">Activos</option>
              <option value="inactivo">Inactivos</option>
              <option value="all">Todos</option>
            </Select>
            <Select value={location} onChange={(e) => setLocation(e.target.value)} style={{ width: 210 }}>
              <option value="all">Todas las ubicaciones</option>
              {locations.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </Select>
          </div>

          <div className="row wrap" style={{ gap: 6 }}>
            <button className={cx('chip', type === 'all' && 'active')} onClick={() => setType('all')}>
              <SlidersHorizontal size={13} /> Todos
            </button>
            {PRODUCT_TYPES.map((t) => {
              const count = (products ?? []).filter((p) => p.type === t.value && p.status === 'activo').length;
              return (
                <button
                  key={t.value}
                  className={cx('chip', type === t.value && 'active')}
                  onClick={() => setType(t.value)}
                >
                  <span className="legend-swatch" style={{ background: t.color }} />
                  {t.plural}
                  <span className="faint">{count}</span>
                </button>
              );
            })}
          </div>
        </div>
      </Card>

      <Card>
        {filtered.length === 0 && (
          <div className="table-wrap desktop-only">
            <table className="data">
              <thead>
                <tr>
                  <th>Producto</th>
                  <th>Tipo</th>
                  <th className="num">Stock</th>
                  <th className="num">Mín.</th>
                  <th className="num">Costo</th>
                  <th className="num">Valor</th>
                  <th>Ubicación</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                <EmptyRow colSpan={8} message="Sin productos para los filtros seleccionados." />
              </tbody>
            </table>
          </div>
        )}
        {filtered.length === 0 ? (
          <div className="mobile-only">
            <EmptyState
            icon={<Package size={24} />}
            title="Sin productos"
            message="No se encontraron productos con los filtros seleccionados."
            action={
              canEdit ? (
                <Button variant="primary" icon={<PackagePlus size={16} />} onClick={() => navigate('/productos/nuevo')}>
                  Crear producto
                </Button>
              ) : undefined
            }
            />
          </div>
        ) : (
          <>
            <div className="table-wrap desktop-only">
              <table className="data">
                <thead>
                  <tr>
                    <th>Producto</th>
                    <th>Tipo</th>
                    <th className="num">Stock</th>
                    <th className="num">Mín.</th>
                    <th className="num">Costo</th>
                    <th className="num">Valor</th>
                    <th>Ubicación</th>
                    <th>Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((p) => (
                    <tr key={p.id} onClick={() => navigate(`/productos/${p.id}`)} style={{ cursor: 'pointer' }}>
                      <td>
                        <div className="cell-main">
                          <span className="name">{p.name}</span>
                          <span className="sku">
                            {p.sku} · {p.category}
                          </span>
                        </div>
                      </td>
                      <td>
                        <span className="row" style={{ gap: 6, fontSize: 12 }}>
                          <span className="legend-swatch" style={{ background: typeColor(p.type) }} />
                          {typeLabel(p.type)}
                        </span>
                      </td>
                      <td className="num strong">
                        {fmtQty(p.stock)} <span className="faint small">{p.uom}</span>
                      </td>
                      <td className="num muted">{fmtQty(p.minStock)}</td>
                      <td className="num">{money(p.cost)}</td>
                      <td className="num strong">{money(p.stock * p.cost)}</td>
                      <td className="small muted">{p.location}</td>
                      <td>
                        <ProductStatusBadge stock={p.stock} minStock={p.minStock} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mobile-only">
              <div className="list">
                {filtered.map((p) => (
                  <button
                    key={p.id}
                    className="list-item"
                    style={{ border: 'none', background: 'none', width: '100%', textAlign: 'left', cursor: 'pointer' }}
                    onClick={() => navigate(`/productos/${p.id}`)}
                  >
                    <div
                      className="list-icon"
                      style={{ background: `${typeColor(p.type)}1f`, color: typeColor(p.type) }}
                    >
                      <Package size={16} />
                    </div>
                    <div className="list-main">
                      <div className="list-title">{p.name}</div>
                      <div className="list-sub">
                        {p.sku} · {p.location}
                      </div>
                    </div>
                    <div className="list-value">
                      {fmtQty(p.stock)} {p.uom}
                      <div style={{ marginTop: 3 }}>
                        <ProductStatusBadge stock={p.stock} minStock={p.minStock} />
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
        <div className="table-foot">
          <span>
            {filtered.length} productos · {fmtQty(filtered.reduce((a, p) => a + p.stock, 0))} unidades en total
          </span>
          <span style={{ marginLeft: 'auto' }} className="bold ink">
            {money(totalValue)}
          </span>
        </div>
      </Card>

      {type !== 'all' && (
        <div className="row mt-12 small muted">
          <Badge tone="brand">{typeLabel(type as ProductType)}</Badge>
          <span>
            {filtered.filter((p) => p.stock <= p.minStock).length} producto(s) en o bajo el mínimo
          </span>
        </div>
      )}
    </>
  );
}

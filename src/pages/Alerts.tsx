import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { AlertTriangle, ArrowDownToLine, Bell, PackageX, TrendingDown } from 'lucide-react';
import { db } from '../db/schema';
import { useApp } from '../context/AppContext';
import { alertsFor } from '../domain/reports';
import { money, qty as fmtQty } from '../domain/format';
import { typeColor } from '../domain/types';
import { Badge, Button, Card, EmptyState, PageHeader, SearchInput, StatCard, cx } from '../components/ui';

const SEVERITIES = [
  { id: 'all', label: 'Todas' },
  { id: 'agotado', label: 'Agotados' },
  { id: 'critico', label: 'Críticos' },
  { id: 'bajo', label: 'Bajo mínimo' },
  { id: 'sobrestock', label: 'Sobre stock' },
  { id: 'sin_movimiento', label: 'Sin movimiento' },
];

export function Alerts() {
  const navigate = useNavigate();
  const { user } = useApp();
  const products = useLiveQuery(() => db.products.toArray(), []) ?? [];
  const movements = useLiveQuery(() => db.movements.toArray(), []) ?? [];
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');

  const all = useMemo(() => alertsFor(products, movements), [products, movements]);

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return all
      .filter((a) => (filter === 'all' ? true : a.severity === filter))
      .filter(
        (a) =>
          !term ||
          a.product.name.toLowerCase().includes(term) ||
          a.product.sku.toLowerCase().includes(term),
      );
  }, [all, filter, search]);

  const counts = {
    agotado: all.filter((a) => a.severity === 'agotado').length,
    critico: all.filter((a) => a.severity === 'critico').length,
    bajo: all.filter((a) => a.severity === 'bajo').length,
    valor: all
      .filter((a) => ['agotado', 'critico', 'bajo'].includes(a.severity))
      .reduce((acc, a) => acc + Math.max(0, a.product.minStock - a.product.stock) * a.product.cost, 0),
  };

  return (
    <>
      <PageHeader
        title="Alertas de inventario"
        subtitle={`${all.length} novedades detectadas en ${products.length} productos`}
        actions={
          <Button variant="primary" icon={<ArrowDownToLine size={16} />} onClick={() => navigate('/entradas/nueva')}>
            Registrar entrada
          </Button>
        }
      />

      <div className="kpi-grid">
        <StatCard label="Agotados" value={counts.agotado} icon={<PackageX size={18} />} tone="danger" foot={<span>sin existencias</span>} />
        <StatCard label="Críticos" value={counts.critico} icon={<AlertTriangle size={18} />} tone="warn" foot={<span>bajo la mitad del mínimo</span>} />
        <StatCard label="Bajo mínimo" value={counts.bajo} icon={<TrendingDown size={18} />} tone="warn" foot={<span>requieren reposición</span>} />
        <StatCard label="Valor de reposición" value={money(counts.valor)} icon={<Bell size={18} />} tone="brand" foot={<span>para alcanzar el mínimo</span>} />
      </div>

      <Card>
        <div className="card-pad" style={{ display: 'grid', gap: 12 }}>
          <SearchInput value={search} onChange={setSearch} placeholder="Buscar producto o SKU…" />
          <div className="row wrap" style={{ gap: 6 }}>
            {SEVERITIES.map((s) => {
              const count = s.id === 'all' ? all.length : all.filter((a) => a.severity === s.id).length;
              return (
                <button
                  key={s.id}
                  className={cx('chip', filter === s.id && 'active')}
                  onClick={() => setFilter(s.id)}
                >
                  {s.label} <span className="faint">{count}</span>
                </button>
              );
            })}
          </div>
        </div>

        {rows.length === 0 ? (
          <EmptyState
            icon={<Bell size={24} />}
            title="Sin alertas"
            message="Todos los productos están dentro de los niveles definidos."
          />
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Producto</th>
                  <th>Tipo</th>
                  <th>Alerta</th>
                  <th className="num">Stock</th>
                  <th className="num">Mínimo</th>
                  <th className="num">Valor</th>
                  <th>Ubicación</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((a) => (
                  <tr key={`${a.product.id}-${a.severity}`}>
                    <td>
                      <div className="cell-main">
                        <span className="name">{a.product.name}</span>
                        <span className="sku">{a.product.sku}</span>
                      </div>
                    </td>
                    <td>
                      <span className="row" style={{ gap: 6, fontSize: 12 }}>
                        <span className="legend-swatch" style={{ background: typeColor(a.product.type) }} />
                        {a.product.category}
                      </span>
                    </td>
                    <td>
                      <Badge
                        tone={
                          a.severity === 'agotado'
                            ? 'danger'
                            : a.severity === 'critico' || a.severity === 'bajo'
                              ? 'warn'
                              : 'muted'
                        }
                        dot
                      >
                        {a.message}
                      </Badge>
                    </td>
                    <td className="num strong">
                      {fmtQty(a.product.stock)} {a.product.uom}
                    </td>
                    <td className="num muted">{fmtQty(a.product.minStock)}</td>
                    <td className="num">{money(a.product.stock * a.product.cost)}</td>
                    <td className="small muted">{a.product.location}</td>
                    <td>
                      {user && ['admin', 'jefe', 'almacenista'].includes(user.role) && (
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => navigate(`/entradas/nueva?producto=${a.product.id}`)}
                        >
                          Reponer
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="table-foot">
          <span>{rows.length} alertas mostradas</span>
        </div>
      </Card>
    </>
  );
}

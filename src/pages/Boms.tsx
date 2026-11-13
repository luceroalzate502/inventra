import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowRight, Plus } from 'lucide-react';
import { db } from '../db/schema';
import { useApp } from '../context/AppContext';
import { can } from '../domain/permissions';
import { money, qty as fmtQty } from '../domain/format';
import {
  Badge,
  Button,
  Card,
  EmptyRow,
  PageHeader,
  SearchInput,
  Tabs,
} from '../components/ui';

export function Boms() {
  const navigate = useNavigate();
  const { user } = useApp();
  const [tab, setTab] = useState('activo');
  const [search, setSearch] = useState('');

  const boms = useLiveQuery(() => db.boms.toArray(), []);
  const items = useLiveQuery(() => db.bomItems.toArray(), []);
  const products = useLiveQuery(() => db.products.toArray(), []);

  const rows = useMemo(() => {
    if (!boms || !items || !products) return [];
    const term = search.trim().toLowerCase();
    return boms
      .filter((b) => (tab === 'all' ? true : b.status === tab))
      .map((bom) => {
        const product = products.find((p) => p.id === bom.productId);
        const bomItems = items.filter((i) => i.bomId === bom.id);
        const materialsCost = bomItems.reduce((acc, i) => {
          const comp = products.find((p) => p.id === i.componentId);
          return acc + (comp?.cost ?? 0) * i.qty * (1 + i.wastePct / 100);
        }, 0);
        const totalCost = materialsCost + bom.laborCost;
        const shortages = bomItems.filter((i) => {
          const comp = products.find((p) => p.id === i.componentId);
          return (comp?.stock ?? 0) < i.qty * (1 + i.wastePct / 100);
        }).length;
        return { bom, product, items: bomItems, materialsCost, totalCost, shortages };
      })
      .filter(
        (r) =>
          !term ||
          r.bom.code.toLowerCase().includes(term) ||
          (r.product?.name ?? '').toLowerCase().includes(term) ||
          (r.product?.sku ?? '').toLowerCase().includes(term),
      )
      .sort((a, b) => (a.product?.name ?? '').localeCompare(b.product?.name ?? ''));
  }, [boms, items, products, tab, search]);

  const canEdit = user ? can(user.role, 'bom.edit') : false;

  return (
    <>
      <PageHeader
        title="Listas de materiales"
        subtitle={`${rows.length} listas · costeo teórico por unidad producida`}
        actions={
          canEdit ? (
            <Button variant="primary" icon={<Plus size={16} />} onClick={() => navigate('/bom/nuevo')}>
              Nueva lista
            </Button>
          ) : undefined
        }
      />

      <Card>
        <div className="card-pad" style={{ paddingBottom: 0, display: 'grid', gap: 12 }}>
          <SearchInput value={search} onChange={setSearch} placeholder="Buscar por producto o código de BOM…" />
          <Tabs
            active={tab}
            onChange={setTab}
            tabs={[
              { id: 'activo', label: 'Activas', count: (boms ?? []).filter((b) => b.status === 'activo').length },
              { id: 'borrador', label: 'Borradores', count: (boms ?? []).filter((b) => b.status === 'borrador').length },
              { id: 'obsoleto', label: 'Obsoletas', count: (boms ?? []).filter((b) => b.status === 'obsoleto').length },
              { id: 'all', label: 'Todas' },
            ]}
          />
        </div>

        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Lista</th>
                <th>Producto terminado</th>
                <th className="num">Versión</th>
                <th className="num">Componentes</th>
                <th className="num">Costo materiales</th>
                <th className="num">Costo total / und</th>
                <th>Estado</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <EmptyRow colSpan={8} message="Sin listas de materiales. Cree una BOM para empezar." />
              ) : (
                rows.map(({ bom, product, items: bi, materialsCost, totalCost, shortages }) => (
                  <tr key={bom.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/bom/${bom.id}`)}>
                    <td className="mono strong">{bom.code}</td>
                    <td>
                      <div className="cell-main">
                        <span className="name">{product?.name ?? '—'}</span>
                        <span className="sku">
                          {product?.sku} · {fmtQty(product?.stock ?? 0)} {product?.uom} en stock
                        </span>
                      </div>
                    </td>
                    <td className="num">v{bom.version}</td>
                    <td className="num">
                      {bi.length}
                      {shortages > 0 && (
                        <span className="small" style={{ color: 'var(--warn)', marginLeft: 6 }}>
                          {shortages} faltante(s)
                        </span>
                      )}
                    </td>
                    <td className="num">{money(materialsCost)}</td>
                    <td className="num bold">{money(totalCost)}</td>
                    <td>
                      <Badge tone={bom.status === 'activo' ? 'ok' : bom.status === 'borrador' ? 'warn' : 'muted'}>
                        {bom.status}
                      </Badge>
                    </td>
                    <td>
                      <ArrowRight size={15} className="faint" />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="table-foot">
          <span>
            Costo teórico = materiales (con merma) + mano de obra por unidad de salida
          </span>
        </div>
      </Card>
    </>
  );
}

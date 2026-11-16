import { useMemo, useState } from 'react';
import { Package, Search } from 'lucide-react';
import type { Product } from '../domain/types';
import { typeColor, typeLabel } from '../domain/types';
import { money, qty as fmtQty } from '../domain/format';
import { Badge, EmptyState, Input, Modal, ProductStatusBadge } from './ui';

export function ProductPicker({
  open,
  onClose,
  onSelect,
  products,
  title = 'Seleccionar producto',
  subtitle = 'Busque por nombre, SKU o código de barras',
  filter,
}: {
  open: boolean;
  onClose: () => void;
  onSelect: (product: Product) => void;
  products: Product[];
  title?: string;
  subtitle?: string;
  filter?: (p: Product) => boolean;
}) {
  const [search, setSearch] = useState('');

  const list = useMemo(() => {
    const term = search.trim().toLowerCase();
    return products
      .filter((p) => (filter ? filter(p) : true))
      .filter(
        (p) =>
          !term ||
          p.name.toLowerCase().includes(term) ||
          p.sku.toLowerCase().includes(term) ||
          p.barcode.includes(term),
      )
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, 60);
  }, [products, search, filter]);

  return (
    <Modal open={open} onClose={onClose} title={title} subtitle={subtitle}>
      <div className="search-input">
        <Search size={15} />
        <Input
          autoFocus
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar producto…"
          style={{ paddingLeft: 34 }}
        />
      </div>

      {list.length === 0 ? (
        <EmptyState icon={<Package size={22} />} title="Sin resultados" message="Intente con otro término de búsqueda." />
      ) : (
        <div style={{ display: 'grid', gap: 6, maxHeight: '52vh', overflowY: 'auto' }}>
          {list.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => {
                onSelect(p);
                setSearch('');
                onClose();
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 11,
                padding: '10px 12px',
                borderRadius: 11,
                border: '1px solid var(--line)',
                background: 'var(--surface)',
                cursor: 'pointer',
                textAlign: 'left',
                width: '100%',
              }}
            >
              <div
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: 9,
                  background: `${typeColor(p.type)}1f`,
                  color: typeColor(p.type),
                  display: 'grid',
                  placeItems: 'center',
                  flex: 'none',
                }}
              >
                <Package size={16} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="list-title">{p.name}</div>
                <div className="list-sub">
                  {p.sku} · {typeLabel(p.type)}
                </div>
              </div>
              <div style={{ textAlign: 'right', flex: 'none' }}>
                <div className="bold" style={{ fontSize: 12.5 }}>
                  {fmtQty(p.stock)} {p.uom}
                </div>
                <div className="small faint">{money(p.cost)}</div>
              </div>
              <ProductStatusBadge stock={p.stock} minStock={p.minStock} />
            </button>
          ))}
        </div>
      )}

      <div className="row-between small muted">
        <span>{list.length} productos</span>
        <Badge tone="brand">Costo promedio en COP</Badge>
      </div>
    </Modal>
  );
}

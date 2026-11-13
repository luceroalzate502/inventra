import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import QRCode from 'qrcode';
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowUpFromLine,
  Boxes,
  CircleDollarSign,
  Factory,
  Layers,
  MapPin,
  Pencil,
  Printer,
  QrCode,
  Tag,
  TrendingUp,
} from 'lucide-react';
import { db } from '../db/schema';
import { useApp } from '../context/AppContext';
import { can } from '../domain/permissions';
import { MOVEMENT_META, typeColor, typeLabel } from '../domain/types';
import { dateTime, money, qty as fmtQty } from '../domain/format';
import { buildKardex } from '../domain/reports';
import {
  Badge,
  Button,
  Card,
  CardHead,
  EmptyState,
  Loading,
  Modal,
  PageHeader,
  ProductStatusBadge,
  StatCard,
  Tabs,
} from '../components/ui';

export function ProductDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useApp();
  const [tab, setTab] = useState('movimientos');
  const [qrOpen, setQrOpen] = useState(false);
  const [qrUrl, setQrUrl] = useState('');

  const product = useLiveQuery(() => (id ? db.products.get(id) : undefined), [id]);
  const movements = useLiveQuery(
    () => (id ? db.movements.where('productId').equals(id).toArray() : []),
    [id],
  );
  const lots = useLiveQuery(() => (id ? db.lots.where('productId').equals(id).toArray() : []), [id]);
  const boms = useLiveQuery(() => (id ? db.boms.where('productId').equals(id).toArray() : []), [id]);
  const orders = useLiveQuery(
    () => (id ? db.productionOrders.where('productId').equals(id).toArray() : []),
    [id],
  );

  const bom = boms?.find((b) => b.status === 'activo') ?? boms?.[0];
  const bomItems = useLiveQuery(
    () => (bom ? db.bomItems.where('bomId').equals(bom.id).toArray() : []),
    [bom?.id],
  );
  const components = useLiveQuery(() => db.products.toArray(), []);

  useEffect(() => {
    if (!product) return;
    QRCode.toDataURL(product.barcode || product.sku, {
      margin: 1,
      width: 260,
      color: { dark: '#0d1b2a', light: '#ffffff' },
    })
      .then(setQrUrl)
      .catch(() => setQrUrl(''));
  }, [product?.barcode, product?.sku, product]);

  const kardex = useMemo(
    () => (id && movements ? buildKardex(movements, id).reverse().slice(0, 12) : []),
    [id, movements],
  );

  if (!product) {
    return <Loading rows={5} />;
  }

  const canEdit = user ? can(user.role, 'products.edit') : false;
  const canEntry = user ? can(user.role, 'inventory.entry') : false;
  const canExit = user ? can(user.role, 'inventory.exit') : false;
  const value = Math.max(product.stock, 0) * product.cost;
  const activeLots = (lots ?? []).filter((l) => l.qty > 0);

  const printQr = () => {
    const win = window.open('', '_blank', 'width=420,height=560');
    if (!win) return;
    win.document.write(`<!doctype html><html><head><title>Etiqueta ${product.sku}</title>
      <style>body{font-family:Segoe UI,Arial,sans-serif;display:grid;place-items:center;height:100vh;margin:0}
      .label{width:300px;border:1.5px solid #0d1b2a;border-radius:14px;padding:18px;text-align:center}
      h1{font-size:15px;margin:0 0 2px} .sku{font-family:Consolas,monospace;font-size:11px;color:#64748b;letter-spacing:.08em}
      .name{font-size:12px;margin:10px 0;font-weight:600;line-height:1.35}
      img{width:220px;height:220px} .foot{font-size:9px;color:#94a3b8;margin-top:8px}
      </style></head><body><div class="label"><h1>INVENTRA</h1><div class="sku">${product.sku}</div>
      <img src="${qrUrl}" alt="QR"/><div class="name">${product.name}</div>
      <div class="sku">${product.barcode}</div>
      <div class="foot">${product.location} · ${fmtQty(product.stock)} ${product.uom}</div></div>
      <script>window.onload=()=>{window.print();}</script></body></html>`);
    win.document.close();
  };

  return (
    <>
      <PageHeader
        title={product.name}
        subtitle={`${product.sku} · ${product.category}`}
        back={
          <Button variant="ghost" size="sm" icon={<ArrowLeft size={16} />} onClick={() => navigate('/productos')}>
            Volver
          </Button>
        }
        actions={
          <>
            <Button variant="secondary" icon={<QrCode size={16} />} onClick={() => setQrOpen(true)}>
              Etiqueta QR
            </Button>
            {canEdit && (
              <Button variant="secondary" icon={<Pencil size={15} />} onClick={() => navigate(`/productos/${product.id}/editar`)}>
                Editar
              </Button>
            )}
            {canEntry && (
              <Button variant="primary" icon={<ArrowDownToLine size={16} />} onClick={() => navigate(`/entradas/nueva?producto=${product.id}`)}>
                Entrada
              </Button>
            )}
            {canExit && (
              <Button variant="secondary" icon={<ArrowUpFromLine size={16} />} onClick={() => navigate(`/salidas/nueva?producto=${product.id}`)}>
                Salida
              </Button>
            )}
          </>
        }
      />

      <div className="kpi-grid">
        <StatCard
          label="Stock disponible"
          value={`${fmtQty(product.stock)} ${product.uom}`}
          icon={<Boxes size={18} />}
          tone={product.stock <= 0 ? 'danger' : product.stock <= product.minStock ? 'warn' : 'ok'}
          foot={<ProductStatusBadge stock={product.stock} minStock={product.minStock} />}
        />
        <StatCard
          label="Valor en inventario"
          value={money(value)}
          icon={<CircleDollarSign size={18} />}
          tone="brand"
          foot={<span>Costo promedio ponderado</span>}
        />
        <StatCard
          label="Costo unitario"
          value={money(product.cost)}
          icon={<Tag size={18} />}
          tone="info"
          foot={<span>COP por {product.uom}</span>}
        />
        <StatCard
          label="Niveles de stock"
          value={`${fmtQty(product.minStock)} / ${fmtQty(product.maxStock)}`}
          icon={<TrendingUp size={18} />}
          tone="muted"
          foot={<span>mínimo / máximo</span>}
        />
      </div>

      <div className="grid grid-2" style={{ marginBottom: 16 }}>
        <Card>
          <CardHead title="Información del producto" subtitle="Datos maestros" />
          <div className="card-pad">
            <div className="detail-hero mb-16">
              <div
                className="avatar avatar-lg"
                style={{ background: `${typeColor(product.type)}1f`, color: typeColor(product.type) }}
              >
                <Boxes size={22} />
              </div>
              <div style={{ flex: 1 }}>
                <div className="row wrap" style={{ gap: 8 }}>
                  <Badge tone="brand">{typeLabel(product.type)}</Badge>
                  <Badge tone={product.status === 'activo' ? 'ok' : 'muted'}>
                    {product.status === 'activo' ? 'Activo' : 'Inactivo'}
                  </Badge>
                  {product.lotTracked && <Badge tone="info">Control por lotes</Badge>}
                </div>
                <div className="detail-sub mt-8">{product.description || 'Sin descripción registrada.'}</div>
              </div>
            </div>

            <div className="meta-grid">
              <div>
                <div className="meta-label">SKU / referencia</div>
                <div className="meta-value mono">{product.sku}</div>
              </div>
              <div>
                <div className="meta-label">Código de barras</div>
                <div className="meta-value mono">{product.barcode}</div>
              </div>
              <div>
                <div className="meta-label">Categoría</div>
                <div className="meta-value">{product.category}</div>
              </div>
              <div>
                <div className="meta-label">Unidad de medida</div>
                <div className="meta-value">{product.uom}</div>
              </div>
              <div>
                <div className="meta-label">Ubicación</div>
                <div className="meta-value row" style={{ gap: 5 }}>
                  <MapPin size={13} /> {product.location}
                </div>
              </div>
              <div>
                <div className="meta-label">Creado</div>
                <div className="meta-value">{dateTime(product.createdAt)}</div>
              </div>
            </div>
          </div>
        </Card>

        <Card>
          <CardHead title="Distribución y consumo" subtitle="Indicadores del producto" />
          <div className="card-pad" style={{ display: 'grid', gap: 16 }}>
            <div>
              <div className="row-between small mb-8">
                <span className="muted">Nivel de stock vs. máximo</span>
                <strong>{product.maxStock > 0 ? Math.round((product.stock / product.maxStock) * 100) : 0}%</strong>
              </div>
              <div className="progress">
                <div
                  style={{
                    width: `${product.maxStock > 0 ? Math.min(100, (product.stock / product.maxStock) * 100) : 0}%`,
                    background:
                      product.stock <= product.minStock
                        ? 'linear-gradient(90deg,#fbbf24,#d97706)'
                        : 'linear-gradient(90deg,#2dd4bf,#0f766e)',
                  }}
                />
              </div>
              <div className="row-between small muted mt-8">
                <span>Mín. {fmtQty(product.minStock)}</span>
                <span>Máx. {fmtQty(product.maxStock)}</span>
              </div>
            </div>

            <div className="grid grid-2" style={{ gap: 12 }}>
              <div style={{ background: 'var(--surface-2)', borderRadius: 10, padding: 12 }}>
                <div className="meta-label">Movimientos</div>
                <div className="bold" style={{ fontSize: 18 }}>
                  {movements?.length ?? 0}
                </div>
              </div>
              <div style={{ background: 'var(--surface-2)', borderRadius: 10, padding: 12 }}>
                <div className="meta-label">Lotes activos</div>
                <div className="bold" style={{ fontSize: 18 }}>
                  {activeLots.length}
                </div>
              </div>
              <div style={{ background: 'var(--surface-2)', borderRadius: 10, padding: 12 }}>
                <div className="meta-label">Entradas</div>
                <div className="bold" style={{ fontSize: 18, color: 'var(--ok)' }}>
                  {fmtQty((movements ?? []).filter((m) => m.direction === 1).reduce((a, m) => a + m.qty, 0))}
                </div>
              </div>
              <div style={{ background: 'var(--surface-2)', borderRadius: 10, padding: 12 }}>
                <div className="meta-label">Salidas</div>
                <div className="bold" style={{ fontSize: 18, color: 'var(--danger)' }}>
                  {fmtQty((movements ?? []).filter((m) => m.direction === -1).reduce((a, m) => a + m.qty, 0))}
                </div>
              </div>
            </div>

            {bom && (
              <Button variant="secondary" icon={<Layers size={15} />} onClick={() => navigate(`/bom/${bom.id}`)}>
                Ver lista de materiales ({bom.code})
              </Button>
            )}
          </div>
        </Card>
      </div>

      <Card>
        <div className="card-pad" style={{ paddingBottom: 0 }}>
          <Tabs
            active={tab}
            onChange={setTab}
            tabs={[
              { id: 'movimientos', label: 'Movimientos', count: movements?.length ?? 0 },
              { id: 'lotes', label: 'Lotes', count: activeLots.length },
              ...(product.type === 'PT' ? [{ id: 'bom', label: 'Lista de materiales', count: bomItems?.length ?? 0 }] : []),
              ...(product.type === 'PT' ? [{ id: 'ordenes', label: 'Órdenes', count: orders?.length ?? 0 }] : []),
            ]}
          />
        </div>

        {tab === 'movimientos' && (
          <>
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Movimiento</th>
                    <th>Motivo</th>
                    <th className="num">Cantidad</th>
                    <th className="num">Saldo</th>
                    <th className="num">Costo</th>
                    <th>Usuario</th>
                  </tr>
                </thead>
                <tbody>
                  {kardex.map((row) => (
                    <tr key={row.movement.id}>
                      <td className="small nowrap">{dateTime(row.movement.createdAt)}</td>
                      <td>
                        <Badge tone={row.movement.direction === 1 ? 'ok' : 'danger'}>
                          {MOVEMENT_META[row.movement.type].label}
                        </Badge>
                      </td>
                      <td className="small">{row.movement.reason}</td>
                      <td className="num strong" style={{ color: row.movement.direction === 1 ? 'var(--ok)' : 'var(--danger)' }}>
                        {row.movement.direction === 1 ? '+' : '−'}
                        {fmtQty(row.movement.qty)}
                      </td>
                      <td className="num">{fmtQty(row.balance)}</td>
                      <td className="num">{money(row.movement.totalCost)}</td>
                      <td className="small muted">{row.movement.userName}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="table-foot">
              <span>Últimos {kardex.length} movimientos</span>
              <Button variant="ghost" size="sm" onClick={() => navigate(`/kardex/${product.id}`)}>
                Ver kardex completo
              </Button>
            </div>
          </>
        )}

        {tab === 'lotes' && (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Lote</th>
                  <th className="num">Cantidad</th>
                  <th className="num">Costo unitario</th>
                  <th>Recibido</th>
                  <th>Vence</th>
                </tr>
              </thead>
              <tbody>
                {activeLots.map((l) => (
                  <tr key={l.id}>
                    <td className="mono strong">{l.code}</td>
                    <td className="num">
                      {fmtQty(l.qty)} {product.uom}
                    </td>
                    <td className="num">{money(l.unitCost)}</td>
                    <td className="small">{dateTime(l.receivedAt)}</td>
                    <td className="small muted">{l.expiresAt ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {activeLots.length === 0 && (
              <EmptyState icon={<Layers size={22} />} title="Sin lotes activos" message="Las entradas con lote aparecerán aquí." />
            )}
          </div>
        )}

        {tab === 'bom' && bom && (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Componente</th>
                  <th className="num">Cantidad / unidad</th>
                  <th className="num">Merma</th>
                  <th className="num">Costo</th>
                  <th className="num">Disponible</th>
                </tr>
              </thead>
              <tbody>
                {(bomItems ?? []).map((item) => {
                  const comp = components?.find((c) => c.id === item.componentId);
                  return (
                    <tr key={item.id}>
                      <td>
                        <div className="cell-main">
                          <span className="name">{comp?.name ?? '—'}</span>
                          <span className="sku">{comp?.sku}</span>
                        </div>
                      </td>
                      <td className="num">
                        {fmtQty(item.qty)} {item.uom}
                      </td>
                      <td className="num muted">{item.wastePct}%</td>
                      <td className="num">{money((comp?.cost ?? 0) * item.qty)}</td>
                      <td className="num">
                        <Badge tone={(comp?.stock ?? 0) >= item.qty ? 'ok' : 'danger'}>
                          {fmtQty(comp?.stock ?? 0)} {comp?.uom}
                        </Badge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {tab === 'ordenes' && (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Orden</th>
                  <th>Estado</th>
                  <th className="num">Programado</th>
                  <th className="num">Producido</th>
                  <th className="num">Costo total</th>
                  <th>Creada</th>
                </tr>
              </thead>
              <tbody>
                {(orders ?? []).map((o) => (
                  <tr key={o.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/produccion/${o.id}`)}>
                    <td className="mono strong">{o.code}</td>
                    <td>
                      <Badge tone={o.status === 'cerrada' ? 'ok' : o.status === 'cancelada' ? 'danger' : 'info'}>
                        {o.status.replace('_', ' ')}
                      </Badge>
                    </td>
                    <td className="num">{fmtQty(o.plannedQty)}</td>
                    <td className="num">{fmtQty(o.producedQty)}</td>
                    <td className="num">{money(o.totalCost)}</td>
                    <td className="small muted">{dateTime(o.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {(orders ?? []).length === 0 && (
              <EmptyState
                icon={<Factory size={22} />}
                title="Sin órdenes de producción"
                action={
                  canEdit ? (
                    <Button variant="primary" size="sm" onClick={() => navigate('/produccion/nueva')}>
                      Crear orden
                    </Button>
                  ) : undefined
                }
              />
            )}
          </div>
        )}
      </Card>

      <Modal
        open={qrOpen}
        onClose={() => setQrOpen(false)}
        title="Etiqueta de producto"
        subtitle={`${product.sku} · ${product.name}`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setQrOpen(false)}>
              Cerrar
            </Button>
            <Button variant="primary" icon={<Printer size={15} />} onClick={printQr}>
              Imprimir etiqueta
            </Button>
          </>
        }
      >
        <div style={{ textAlign: 'center' }}>
          {qrUrl ? (
            <img src={qrUrl} alt={`QR ${product.sku}`} style={{ width: 220, height: 220 }} />
          ) : (
            <div className="skeleton" style={{ width: 220, height: 220, margin: '0 auto' }} />
          )}
          <div className="mono bold mt-8">{product.sku}</div>
          <div className="small muted">{product.barcode}</div>
          <div className="small muted mt-8">{product.location}</div>
        </div>
      </Modal>
    </>
  );
}

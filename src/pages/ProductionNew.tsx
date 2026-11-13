import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Factory,
  Layers,
  Save,
} from 'lucide-react';
import { db } from '../db/schema';
import { useApp } from '../context/AppContext';
import { createOrder, explode } from '../domain/production';
import { money, qty as fmtQty, inputDate } from '../domain/format';
import {
  Badge,
  Button,
  Card,
  CardHead,
  EmptyState,
  Field,
  Input,
  PageHeader,
  SectionTitle,
  Select,
  StatCard,
  Textarea,
} from '../components/ui';

export function ProductionNew() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { id } = useParams();
  const { user, toast } = useApp();

  const products = useLiveQuery(() => db.products.toArray(), []);
  const boms = useLiveQuery(() => db.boms.toArray(), []);
  const bomItems = useLiveQuery(() => db.bomItems.toArray(), []);

  const [productId, setProductId] = useState(params.get('producto') ?? id ?? '');
  const [qtyValue, setQtyValue] = useState('10');
  const [scheduled, setScheduled] = useState(inputDate(new Date().toISOString()));
  const [laborCost, setLaborCost] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  const finished = (products ?? []).filter((p) => p.type === 'PT' && p.status === 'activo');
  const product = (products ?? []).find((p) => p.id === productId);
  const bom = (boms ?? []).find((b) => b.productId === productId && b.status === 'activo');

  useEffect(() => {
    if (bom) setLaborCost(String(bom.laborCost));
  }, [bom?.id]);

  const explosion = useMemo(() => {
    if (!bom || !products || !bomItems) return null;
    return explode(bom, bomItems.filter((i) => i.bomId === bom.id), products, Number(qtyValue) || 0);
  }, [bom, products, bomItems, qtyValue]);

  const create = async () => {
    if (!user) return;
    if (!product) {
      toast('Seleccione un producto', 'warn');
      return;
    }
    if (!bom) {
      toast('Sin lista de materiales', 'warn', 'El producto no tiene una BOM activa.');
      return;
    }
    if (Number(qtyValue) <= 0) {
      toast('Cantidad inválida', 'warn');
      return;
    }
    setBusy(true);
    try {
      const order = await createOrder(
        {
          productId: product.id,
          plannedQty: Number(qtyValue),
          scheduledDate: new Date(`${scheduled}T08:00:00`).toISOString(),
          notes,
          laborCost: Number(laborCost) || 0,
        },
        user,
      );
      toast('Orden creada', 'success', `${order.code} · ${product.name}`);
      navigate(`/produccion/${order.id}`);
    } catch (err) {
      toast('No se pudo crear', 'error', err instanceof Error ? err.message : undefined);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Nueva orden de producción"
        subtitle="Planifique la fabricación y valide la disponibilidad de materiales"
        back={
          <Button variant="ghost" size="sm" icon={<ArrowLeft size={16} />} onClick={() => navigate('/produccion')}>
            Producción
          </Button>
        }
        actions={
          <Button variant="primary" icon={<Save size={16} />} onClick={create} disabled={busy || !product}>
            {busy ? 'Creando…' : 'Crear orden'}
          </Button>
        }
      />

      <div className="grid" style={{ gridTemplateColumns: 'minmax(0,1.2fr) minmax(0,1fr)' }}>
        <Card>
          <div className="card-pad form-grid">
            <SectionTitle>Programación</SectionTitle>
            <Field label="Producto terminado *" hint="Solo productos con lista de materiales activa.">
              <Select value={productId} onChange={(e) => setProductId(e.target.value)}>
                <option value="">Seleccione…</option>
                {finished.map((p) => {
                  const hasBom = (boms ?? []).some((b) => b.productId === p.id && b.status === 'activo');
                  return (
                    <option key={p.id} value={p.id} disabled={!hasBom}>
                      {p.sku} — {p.name} {hasBom ? '' : '(sin BOM)'}
                    </option>
                  );
                })}
              </Select>
            </Field>

            <div className="field-row">
              <Field label="Cantidad a producir *">
                <Input
                  type="number"
                  min={1}
                  value={qtyValue}
                  onChange={(e) => setQtyValue(e.target.value)}
                  placeholder="10"
                />
              </Field>
              <Field label="Fecha programada">
                <Input type="date" value={scheduled} onChange={(e) => setScheduled(e.target.value)} />
              </Field>
            </div>

            <div className="field-row">
              <Field label="Mano de obra por unidad (COP)" hint="Tomada de la BOM; puede ajustarla.">
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  value={laborCost}
                  onChange={(e) => setLaborCost(e.target.value)}
                />
              </Field>
              <Field label="Versión de BOM">
                <Input value={bom ? `v${bom.version} · ${bom.code}` : '—'} disabled />
              </Field>
            </div>

            <Field label="Observaciones">
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Turno, línea, prioridad, cliente asociado…"
              />
            </Field>

            {bom && (
              <div
                className="row"
                style={{
                  gap: 10,
                  background: 'var(--surface-2)',
                  borderRadius: 10,
                  padding: 12,
                  border: '1px solid var(--line)',
                }}
              >
                <Layers size={16} color="var(--brand-3)" />
                <div className="small muted">
                  Lista <strong className="ink">{bom.code}</strong> con {(bomItems ?? []).filter((i) => i.bomId === bom.id).length}{' '}
                  componentes. La orden guarda esta versión para trazabilidad.
                </div>
              </div>
            )}
          </div>
        </Card>

        <div style={{ display: 'grid', gap: 16, alignContent: 'start' }}>
          <Card>
            <CardHead title="Resumen de la orden" subtitle="Cálculo teórico" />
            <div className="card-pad" style={{ display: 'grid', gap: 12 }}>
              <div className="row-between">
                <span className="small muted">Unidades</span>
                <span className="bold">{fmtQty(Number(qtyValue) || 0)}</span>
              </div>
              <div className="row-between">
                <span className="small muted">Costo materiales</span>
                <span className="bold">{money(explosion?.materialsCost ?? 0)}</span>
              </div>
              <div className="row-between">
                <span className="small muted">Mano de obra</span>
                <span className="bold">{money((Number(laborCost) || 0) * (Number(qtyValue) || 0))}</span>
              </div>
              <div
                className="row-between"
                style={{ borderTop: '1px dashed var(--line-strong)', paddingTop: 10 }}
              >
                <span className="small muted">Costo total estimado</span>
                <span className="bold" style={{ fontSize: 18, color: 'var(--brand-3)' }}>
                  {money(
                    (explosion?.materialsCost ?? 0) + (Number(laborCost) || 0) * (Number(qtyValue) || 0),
                  )}
                </span>
              </div>
              <div className="row-between">
                <span className="small muted">Costo unitario</span>
                <span className="bold">{money(explosion?.unitCost ?? 0)}</span>
              </div>

              {explosion ? (
                explosion.available ? (
                  <Badge tone="ok">
                    <CheckCircle2 size={12} /> Materiales disponibles
                  </Badge>
                ) : (
                  <Badge tone="danger">
                    <AlertTriangle size={12} /> {explosion.shortages.length} componente(s) faltante(s)
                  </Badge>
                )
              ) : (
                <Badge tone="muted">Seleccione producto y cantidad</Badge>
              )}
            </div>
          </Card>

          {product && (
            <Card>
              <div className="card-pad">
                <StatCard
                  label="Stock actual del terminado"
                  value={`${fmtQty(product.stock)} ${product.uom}`}
                  icon={<Factory size={18} />}
                  tone="muted"
                  foot={<span>{product.location}</span>}
                />
              </div>
            </Card>
          )}
        </div>
      </div>

      <Card className="mt-16">
        <CardHead
          title="Requerimiento de materiales"
          subtitle="Explosión de la BOM para la cantidad programada"
        />
        {!explosion || explosion.items.length === 0 ? (
          <EmptyState
            icon={<Layers size={22} />}
            title="Sin requerimientos"
            message="Seleccione un producto con BOM activa para ver los materiales necesarios."
          />
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Componente</th>
                  <th>Ubicación</th>
                  <th className="num">Por unidad</th>
                  <th className="num">Requerido</th>
                  <th className="num">Disponible</th>
                  <th className="num">Faltante</th>
                  <th className="num">Costo</th>
                </tr>
              </thead>
              <tbody>
                {explosion.items.map((item) => (
                  <tr key={item.componentId}>
                    <td>
                      <div className="cell-main">
                        <span className="name">{item.name}</span>
                        <span className="sku">{item.sku}</span>
                      </div>
                    </td>
                    <td className="small muted">{item.location}</td>
                    <td className="num">
                      {fmtQty(item.perUnit)} {item.uom}
                    </td>
                    <td className="num strong">
                      {fmtQty(item.required)} {item.uom}
                    </td>
                    <td className="num">{fmtQty(item.available)}</td>
                    <td className="num">
                      {item.shortage > 0 ? (
                        <span style={{ color: 'var(--danger)', fontWeight: 650 }}>{fmtQty(item.shortage)}</span>
                      ) : (
                        <span style={{ color: 'var(--ok)' }}>—</span>
                      )}
                    </td>
                    <td className="num">{money(item.cost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}

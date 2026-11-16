import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowLeft,
  ArrowUpFromLine,
  CheckCircle2,
  Package,
  QrCode,
  Search,
} from 'lucide-react';
import { db } from '../db/schema';
import { useApp } from '../context/AppContext';
import { can } from '../domain/permissions';
import { registerMovement } from '../domain/movements';
import { ENTRY_REASONS, EXIT_REASONS, MOVEMENT_META } from '../domain/types';
import type { MovementType, Product } from '../domain/types';
import { money, qty as fmtQty } from '../domain/format';
import { ProductPicker } from '../components/ProductPicker';
import { Scanner } from '../components/Scanner';
import {
  Badge,
  Button,
  Card,
  CardHead,
  ConfirmDialog,
  Field,
  Input,
  PageHeader,
  SectionTitle,
  Select,
  Textarea,
  cx,
} from '../components/ui';

const ENTRY_MAP: Record<string, MovementType> = {
  'Compra a proveedor': 'ENTRADA',
  'Devolución de cliente': 'ENTRADA',
  'Producción terminada': 'PROD_IN',
  'Ajuste positivo': 'AJUSTE_POS',
  'Traslado recibido': 'TRASLADO_IN',
  'Saldo inicial': 'AJUSTE_POS',
  'Otra entrada autorizada': 'ENTRADA',
};

const EXIT_MAP: Record<string, MovementType> = {
  'Consumo de producción': 'PROD_CONSUMO',
  Despacho: 'SALIDA',
  Venta: 'SALIDA',
  'Devolución a proveedor': 'SALIDA',
  'Ajuste negativo': 'AJUSTE_NEG',
  Traslado: 'TRASLADO_OUT',
  'Baja por desperdicio': 'SALIDA',
  'Baja por obsolescencia': 'SALIDA',
  'Otra salida autorizada': 'SALIDA',
};

const nowLocal = () => {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
};

export function MovementForm({ mode }: { mode: 'entry' | 'exit' }) {
  const isEntry = mode === 'entry';
  const { user, settings, toast } = useApp();
  const navigate = useNavigate();
  const [params] = useSearchParams();

  const products = useLiveQuery(() => db.products.toArray(), []);
  const [productId, setProductId] = useState<string>(params.get('producto') ?? '');
  const [qtyValue, setQtyValue] = useState('');
  const [unitCost, setUnitCost] = useState('');
  const [reason, setReason] = useState(isEntry ? 'Compra a proveedor' : 'Despacho');
  const [counterparty, setCounterparty] = useState('');
  const [refDoc, setRefDoc] = useState('');
  const [lotCode, setLotCode] = useState('');
  const [notes, setNotes] = useState('');
  const [date, setDate] = useState(nowLocal());
  const [pickerOpen, setPickerOpen] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const product = useMemo(
    () => (products ?? []).find((p) => p.id === productId) ?? null,
    [products, productId],
  );

  useEffect(() => {
    if (product) setUnitCost(String(product.cost));
  }, [product?.id]);

  const canOverride = user ? can(user.role, 'inventory.override') : false;
  const negativeAllowed = canOverride || Boolean(settings?.allowNegativeStock);
  const reasons = isEntry ? ENTRY_REASONS : EXIT_REASONS;
  const type = (isEntry ? ENTRY_MAP : EXIT_MAP)[reason] ?? (isEntry ? 'ENTRADA' : 'SALIDA');
  const dir = MOVEMENT_META[type].dir;
  const qtyNum = Number(qtyValue) || 0;
  const stockBefore = product?.stock ?? 0;
  const stockAfter = stockBefore + dir * qtyNum;
  const negative = dir === -1 && stockAfter < -0.0001;
  const blocked = negative && !negativeAllowed;

  const selectProduct = (p: Product) => {
    setProductId(p.id);
    setLotCode('');
    setError(null);
  };

  const handleScan = (code: string) => {
    const found = (products ?? []).find(
      (p) => p.barcode === code || p.sku.toLowerCase() === code.toLowerCase(),
    );
    setScanOpen(false);
    if (found) {
      selectProduct(found);
      toast('Producto seleccionado', 'success', `${found.sku} · ${found.name}`);
    } else {
      toast('Código no registrado', 'warn', `No se encontró un producto con el código ${code}.`);
    }
  };

  const validate = () => {
    if (!product) return 'Seleccione un producto.';
    if (qtyNum <= 0) return 'La cantidad debe ser mayor que cero.';
    if (isEntry && Number(unitCost) < 0) return 'El costo unitario no puede ser negativo.';
    if (isEntry && product.lotTracked && !lotCode.trim())
      return 'Este producto se controla por lotes: indique el código de lote.';
    if (blocked) return 'Stock insuficiente y su perfil no puede autorizar inventario negativo.';
    return null;
  };

  const openConfirm = () => {
    const err = validate();
    setError(err);
    if (!err) setConfirmOpen(true);
  };

  const confirm = async () => {
    if (!product || !user) return;
    setBusy(true);
    setError(null);
    try {
      await registerMovement(
        {
          type,
          reason,
          productId: product.id,
          qty: qtyNum,
          unitCost: isEntry ? Number(unitCost) : undefined,
          counterparty,
          refDoc,
          lotCode: lotCode.trim() || undefined,
          notes,
          at: new Date(date).toISOString(),
          allowNegative: negative && negativeAllowed,
        },
        user,
      );
      toast(
        isEntry ? 'Entrada registrada' : 'Salida registrada',
        'success',
        `${product.sku} · ${qtyNum} ${product.uom} · saldo ${stockAfter}`,
      );
      setConfirmOpen(false);
      navigate(`/kardex/${product.id}`);
    } catch (err) {
      setConfirmOpen(false);
      setError(err instanceof Error ? err.message : 'No se pudo registrar el movimiento.');
      toast('Movimiento rechazado', 'error', err instanceof Error ? err.message : undefined);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        title={isEntry ? 'Registrar entrada' : 'Registrar salida'}
        subtitle={
          isEntry
            ? 'Compras, devoluciones, ajustes positivos y traslados recibidos'
            : 'Despachos, consumos, bajas y ajustes negativos'
        }
        back={
          <Button variant="ghost" size="sm" icon={<ArrowLeft size={16} />} onClick={() => navigate(-1)}>
            Volver
          </Button>
        }
        actions={
          <Button
            variant="primary"
            icon={isEntry ? <ArrowDownToLine size={16} /> : <ArrowUpFromLine size={16} />}
            onClick={openConfirm}
            disabled={busy}
          >
            Registrar {isEntry ? 'entrada' : 'salida'}
          </Button>
        }
      />

      <div className="grid" style={{ gridTemplateColumns: 'minmax(0,1.6fr) minmax(280px,1fr)' }}>
        <Card>
          <div className="card-pad form-grid">
            <SectionTitle>Producto</SectionTitle>

            {product ? (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: 14,
                  borderRadius: 12,
                  border: '1px solid var(--line-strong)',
                  background: 'var(--surface-2)',
                }}
              >
                <div
                  style={{
                    width: 42,
                    height: 42,
                    borderRadius: 11,
                    background: 'var(--brand-soft)',
                    color: 'var(--brand-3)',
                    display: 'grid',
                    placeItems: 'center',
                    flex: 'none',
                  }}
                >
                  <Package size={20} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="bold" style={{ fontSize: 13.5 }}>
                    {product.name}
                  </div>
                  <div className="small muted">
                    {product.sku} · {money(product.cost)} / {product.uom}
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div className="meta-label">Disponible</div>
                  <div className="bold">
                    {fmtQty(product.stock)} {product.uom}
                  </div>
                </div>
              </div>
            ) : (
              <div className="small muted">Aún no ha seleccionado un producto.</div>
            )}

            <div className="row wrap" style={{ gap: 8 }}>
              <Button variant="secondary" icon={<Search size={15} />} onClick={() => setPickerOpen(true)}>
                {product ? 'Cambiar producto' : 'Buscar producto'}
              </Button>
              <Button variant="secondary" icon={<QrCode size={15} />} onClick={() => setScanOpen(true)}>
                Escanear
              </Button>
            </div>

            <SectionTitle>Datos del movimiento</SectionTitle>

            <div className="field-row">
              <Field label="Motivo / tipo de operación">
                <Select value={reason} onChange={(e) => setReason(e.target.value)}>
                  {reasons.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Fecha y hora">
                <Input type="datetime-local" value={date} onChange={(e) => setDate(e.target.value)} />
              </Field>
            </div>

            <div className="field-row">
              <Field label={`Cantidad (${product?.uom ?? 'UND'}) *`}>
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  value={qtyValue}
                  onChange={(e) => setQtyValue(e.target.value)}
                  placeholder="0"
                />
              </Field>
              {isEntry ? (
                <Field label="Costo unitario (COP) *" hint="Recalcula el costo promedio ponderado.">
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    value={unitCost}
                    onChange={(e) => setUnitCost(e.target.value)}
                  />
                </Field>
              ) : (
                <Field label="Costo unitario" hint="Se toma el costo promedio vigente.">
                  <Input value={product ? money(product.cost) : '—'} disabled />
                </Field>
              )}
            </div>

            <div className="field-row">
              <Field
                label={isEntry ? 'Proveedor / origen' : 'Destino / cliente'}
                hint="Opcional pero recomendado para trazabilidad."
              >
                <Input
                  value={counterparty}
                  onChange={(e) => setCounterparty(e.target.value)}
                  placeholder={isEntry ? 'Acerías del Norte S.A.S.' : 'Constructora Bolívar'}
                />
              </Field>
              <Field label="Documento de soporte">
                <Input
                  value={refDoc}
                  onChange={(e) => setRefDoc(e.target.value)}
                  placeholder={isEntry ? 'FV-2451' : 'REM-8821'}
                />
              </Field>
            </div>

            <Field
              label="Lote"
              hint={
                product?.lotTracked
                  ? isEntry
                    ? 'Obligatorio: el producto se controla por lotes.'
                    : 'Opcional: si se omite se descuenta por FIFO.'
                  : 'Producto sin control por lotes.'
              }
            >
              <Input
                value={lotCode}
                onChange={(e) => setLotCode(e.target.value.toUpperCase())}
                placeholder="L-2026-001"
                disabled={!product?.lotTracked}
                className="mono"
              />
            </Field>

            <Field label="Notas ampliadas">
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Detalle de la operación, condiciones de recepción, novedades…"
              />
            </Field>

            {error && (
              <div
                className="row"
                style={{
                  gap: 8,
                  background: 'var(--danger-soft)',
                  color: 'var(--danger)',
                  padding: '10px 12px',
                  borderRadius: 9,
                  fontSize: 12,
                  fontWeight: 550,
                }}
              >
                <AlertTriangle size={15} /> {error}
              </div>
            )}
          </div>
        </Card>

        <div style={{ display: 'grid', gap: 16, alignContent: 'start' }}>
          <Card>
            <CardHead title="Vista previa" subtitle="Impacto en el inventario" />
            <div className="card-pad" style={{ display: 'grid', gap: 14 }}>
              <div className="row-between">
                <span className="small muted">Stock actual</span>
                <span className="bold">{fmtQty(stockBefore)} {product?.uom}</span>
              </div>
              <div className="row-between">
                <span className="small muted">{isEntry ? 'Entrada' : 'Salida'}</span>
                <span className="bold" style={{ color: isEntry ? 'var(--ok)' : 'var(--danger)' }}>
                  {isEntry ? '+' : '−'}
                  {fmtQty(qtyNum)} {product?.uom}
                </span>
              </div>
              <div style={{ borderTop: '1px dashed var(--line-strong)', paddingTop: 12 }} className="row-between">
                <span className="small muted">Saldo resultante</span>
                <span
                  className="bold"
                  style={{
                    fontSize: 18,
                    color: negative ? 'var(--danger)' : stockAfter <= (product?.minStock ?? 0) ? 'var(--warn)' : 'var(--ok)',
                  }}
                >
                  {fmtQty(stockAfter)} {product?.uom}
                </span>
              </div>

              <div className="row-between">
                <span className="small muted">Valor del movimiento</span>
                <span className="bold">
                  {money(qtyNum * (isEntry ? Number(unitCost) || 0 : product?.cost ?? 0))}
                </span>
              </div>

              {negative && (
                <div
                  style={{
                    background: 'var(--danger-soft)',
                    color: 'var(--danger)',
                    padding: 10,
                    borderRadius: 9,
                    fontSize: 11.5,
                    lineHeight: 1.5,
                    fontWeight: 550,
                  }}
                >
                  <AlertTriangle size={14} style={{ verticalAlign: -2, marginRight: 5 }} />
                  {blocked
                    ? 'El saldo quedaría negativo y su perfil no tiene autorización especial.'
                    : canOverride
                      ? 'El saldo quedará negativo. Registre la autorización en observaciones.'
                      : 'El saldo quedará negativo. La configuración del sistema lo permite.'}
                </div>
              )}

              {product && stockAfter >= 0 && stockAfter <= product.minStock && qtyNum > 0 && (
                <div
                  style={{
                    background: 'var(--warn-soft)',
                    color: 'var(--warn)',
                    padding: 10,
                    borderRadius: 9,
                    fontSize: 11.5,
                    fontWeight: 550,
                  }}
                >
                  <AlertTriangle size={14} style={{ verticalAlign: -2, marginRight: 5 }} />
                  El saldo quedará en o por debajo del mínimo ({fmtQty(product.minStock)} {product.uom}).
                </div>
              )}

              <Badge tone="muted">{MOVEMENT_META[type].label}</Badge>

              <Button
                variant="primary"
                size="lg"
                block
                icon={isEntry ? <ArrowDownToLine size={16} /> : <ArrowUpFromLine size={16} />}
                onClick={openConfirm}
                disabled={busy || !product}
              >
                Confirmar {isEntry ? 'entrada' : 'salida'}
              </Button>
            </div>
          </Card>

          <Card>
            <div className="card-pad small muted" style={{ lineHeight: 1.6 }}>
              <strong className="ink" style={{ display: 'block', marginBottom: 6 }}>
                Reglas de la operación
              </strong>
              • Todo movimiento actualiza el stock en la misma transacción.
              <br />• Los movimientos confirmados no se eliminan: se revierten con autorización.
              <br />• El costo de salida usa el promedio ponderado vigente.
              <br />• Los productos con lote descuentan por FIFO.
            </div>
          </Card>
        </div>
      </div>

      <ProductPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onSelect={selectProduct}
        products={products ?? []}
        filter={(p) => p.status === 'activo'}
      />

      <Scanner open={scanOpen} onClose={() => setScanOpen(false)} onResult={handleScan} />

      <ConfirmDialog
        open={confirmOpen}
        title={`Confirmar ${isEntry ? 'entrada' : 'salida'} de inventario`}
        message="Revise el resumen. Al confirmar, el movimiento se registra de forma definitiva en el kardex."
        confirmLabel={busy ? 'Registrando…' : 'Confirmar movimiento'}
        busy={busy}
        withReason={negative && canOverride && !settings?.allowNegativeStock}
        reasonLabel="Autorización de inventario negativo"
        onCancel={() => setConfirmOpen(false)}
        onConfirm={confirm}
      >
        <div style={{ display: 'grid', gap: 10, background: 'var(--surface-2)', borderRadius: 12, padding: 14 }}>
          <div className="row-between">
            <span className="small muted">Producto</span>
            <span className="bold small">{product?.sku} · {product?.name}</span>
          </div>
          <div className="row-between">
            <span className="small muted">Tipo</span>
            <Badge tone={isEntry ? 'ok' : 'danger'}>{MOVEMENT_META[type].label}</Badge>
          </div>
          <div className="row-between">
            <span className="small muted">Cantidad</span>
            <span className="bold">
              {fmtQty(qtyNum)} {product?.uom}
            </span>
          </div>
          <div className="row-between">
            <span className="small muted">Saldo resultante</span>
            <span className="bold" style={{ color: negative ? 'var(--danger)' : 'var(--ok)' }}>
              {fmtQty(stockAfter)} {product?.uom}
            </span>
          </div>
          <div className="row-between">
            <span className="small muted">Valor</span>
            <span className="bold">
              {money(qtyNum * (isEntry ? Number(unitCost) || 0 : product?.cost ?? 0))}
            </span>
          </div>
        </div>
        {negative && (
          <div className="row small" style={{ color: 'var(--danger)', gap: 6 }}>
            <CheckCircle2 size={14} /> Se autorizará un saldo negativo con su usuario.
          </div>
        )}
      </ConfirmDialog>

      <div className={cx('small faint center mt-16')}>
        Responsable: {user?.name} · {new Date().toLocaleString('es-CO')}
      </div>
    </>
  );
}

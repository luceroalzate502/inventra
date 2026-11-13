import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Barcode, Save, Trash2 } from 'lucide-react';
import { db } from '../db/schema';
import { useApp } from '../context/AppContext';
import { uid } from '../domain/format';
import { registerMovement } from '../domain/movements';
import { LOCATIONS, PRODUCT_TYPES, UOMS, UOM_LABEL } from '../domain/types';
import type { Product, ProductType, Uom } from '../domain/types';
import { Button, Card, Field, Input, PageHeader, SectionTitle, Select, Textarea } from '../components/ui';

interface FormState {
  sku: string;
  name: string;
  description: string;
  type: ProductType;
  uom: Uom;
  cost: string;
  minStock: string;
  maxStock: string;
  location: string;
  barcode: string;
  lotTracked: boolean;
  status: 'activo' | 'inactivo';
  initialStock: string;
}

const EMPTY: FormState = {
  sku: '',
  name: '',
  description: '',
  type: 'MP',
  uom: 'UND',
  cost: '',
  minStock: '',
  maxStock: '',
  location: LOCATIONS[0],
  barcode: '',
  lotTracked: false,
  status: 'activo',
  initialStock: '',
};

export function ProductForm() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user, toast } = useApp();
  const editing = Boolean(id);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!id) return;
    (async () => {
      const p = await db.products.get(id);
      if (!p) return;
      setForm({
        sku: p.sku,
        name: p.name,
        description: p.description,
        type: p.type,
        uom: p.uom,
        cost: String(p.cost),
        minStock: String(p.minStock),
        maxStock: String(p.maxStock),
        location: p.location,
        barcode: p.barcode,
        lotTracked: p.lotTracked,
        status: p.status,
        initialStock: String(p.stock),
      });
    })();
  }, [id]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const validate = () => {
    const e: Record<string, string> = {};
    if (!form.sku.trim()) e.sku = 'El SKU es obligatorio.';
    if (!form.name.trim()) e.name = 'El nombre es obligatorio.';
    if (form.cost !== '' && Number(form.cost) < 0) e.cost = 'Costo inválido.';
    if (form.minStock !== '' && Number(form.minStock) < 0) e.minStock = 'Valor inválido.';
    if (form.maxStock !== '' && Number(form.maxStock) < Number(form.minStock || 0))
      e.maxStock = 'El máximo debe ser mayor o igual al mínimo.';
    if (form.initialStock !== '' && Number(form.initialStock) < 0) e.initialStock = 'Valor inválido.';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const save = async () => {
    if (!user) return;
    if (!validate()) return;
    setBusy(true);
    try {
      const duplicate = await db.products.where('sku').equals(form.sku.trim().toUpperCase()).first();
      if (duplicate && duplicate.id !== id) {
        setErrors({ sku: 'Ya existe un producto con este SKU.' });
        setBusy(false);
        return;
      }

      const now = new Date().toISOString();
      const barcode =
        form.barcode.trim() ||
        `770${String(Math.floor(1000000000 + Math.random() * 8999999999)).slice(0, 10)}`;

      if (editing && id) {
        const before = await db.products.get(id);
        const patch: Partial<Product> = {
          sku: form.sku.trim().toUpperCase(),
          name: form.name.trim(),
          description: form.description.trim(),
          category: before?.category ?? 'General',
          type: form.type,
          uom: form.uom,
          cost: Number(form.cost || 0),
          minStock: Number(form.minStock || 0),
          maxStock: Number(form.maxStock || 0),
          location: form.location,
          barcode,
          lotTracked: form.lotTracked,
          status: form.status,
          updatedAt: now,
        };
        await db.products.update(id, patch);

        // Si el stock cambió desde la ficha, se registra el ajuste para que
        // el kardex y el saldo del producto sigan cuadrando.
        const previousStock = before?.stock ?? 0;
        const targetStock = Number(form.initialStock || 0);
        const delta = Math.round((targetStock - previousStock) * 10000) / 10000;

        if (Math.abs(delta) > 0.0001) {
          await registerMovement(
            {
              type: delta > 0 ? 'AJUSTE_POS' : 'AJUSTE_NEG',
              reason: 'Ajuste manual desde la ficha del producto',
              productId: id,
              qty: Math.abs(delta),
              unitCost: Number(form.cost || 0),
              refDoc: 'AJUSTE-FICHA',
              notes: `Stock ajustado de ${previousStock} a ${targetStock}`,
            },
            user,
          );
        }

        await db.audit.add({
          id: uid(),
          entity: 'product',
          entityId: id,
          action: 'actualizar',
          summary: `Producto ${patch.sku} actualizado`,
          before,
          after: patch,
          userId: user.id,
          userName: user.name,
          at: now,
        });
        toast(
          'Producto actualizado',
          'success',
          Math.abs(delta) > 0.0001
            ? `${patch.sku} · stock ajustado a ${targetStock}`
            : `${patch.sku} · ${patch.name}`,
        );
        navigate(`/productos/${id}`);
      } else {
        const product: Product = {
          id: uid(),
          sku: form.sku.trim().toUpperCase(),
          name: form.name.trim(),
          description: form.description.trim(),
          category: 'General',
          type: form.type,
          uom: form.uom,
          cost: Number(form.cost || 0),
          stock: 0,
          minStock: Number(form.minStock || 0),
          maxStock: Number(form.maxStock || 0),
          location: form.location,
          barcode,
          lotTracked: form.lotTracked,
          status: form.status,
          createdAt: now,
          updatedAt: now,
        };
        await db.products.add(product);

        if (Number(form.initialStock || 0) > 0) {
          await registerMovement(
            {
              type: 'AJUSTE_POS',
              reason: 'Saldo inicial',
              productId: product.id,
              qty: Number(form.initialStock),
              unitCost: Number(form.cost || 0),
              refDoc: 'ACTA-INV',
              notes: 'Stock inicial al crear el producto',
              lotCode: product.lotTracked ? `L-INI-${product.sku}` : undefined,
            },
            user,
          );
        }

        await db.audit.add({
          id: uid(),
          entity: 'product',
          entityId: product.id,
          action: 'crear',
          summary: `Producto ${product.sku} creado`,
          after: product,
          userId: user.id,
          userName: user.name,
          at: now,
        });
        toast('Producto creado', 'success', `${product.sku} · ${product.name}`);
        navigate(`/productos/${product.id}`);
      }
    } catch (err) {
      toast('No se pudo guardar', 'error', err instanceof Error ? err.message : 'Error inesperado.');
    } finally {
      setBusy(false);
    }
  };

  const deactivate = async () => {
    if (!id || !user) return;
    const product = await db.products.get(id);
    if (!product) return;
    await db.products.update(id, { status: 'inactivo', updatedAt: new Date().toISOString() });
    await db.audit.add({
      id: uid(),
      entity: 'product',
      entityId: id,
      action: 'actualizar',
      summary: `Producto ${product.sku} desactivado`,
      before: product,
      after: { status: 'inactivo' },
      userId: user.id,
      userName: user.name,
      at: new Date().toISOString(),
    });
    toast('Producto desactivado', 'warn', 'No se elimina: conserva su historial de movimientos.');
    navigate(`/productos/${id}`);
  };

  return (
    <>
      <PageHeader
        title={editing ? 'Editar producto' : 'Nuevo producto'}
        subtitle={editing ? 'Modifique los datos del catálogo' : 'Registre una nueva referencia de inventario'}
        back={
          <Button variant="ghost" size="sm" icon={<ArrowLeft size={16} />} onClick={() => navigate(-1)}>
            Volver
          </Button>
        }
        actions={
          <>
            {editing && (
              <Button variant="ghost" icon={<Trash2 size={15} />} onClick={deactivate} className="desktop-only">
                Desactivar
              </Button>
            )}
            <Button variant="primary" icon={<Save size={16} />} onClick={save} disabled={busy}>
              {busy ? 'Guardando…' : 'Guardar producto'}
            </Button>
          </>
        }
      />

      <div className="grid grid-2">
        <Card>
          <div className="card-pad form-grid">
            <SectionTitle>Identificación</SectionTitle>
            <div className="field-row">
              <Field label="SKU / referencia *" error={errors.sku}>
                <Input
                  value={form.sku}
                  onChange={(e) => set('sku', e.target.value.toUpperCase())}
                  placeholder="MP-AC-001"
                  className="mono"
                />
              </Field>
              <Field label="Código de barras / QR" hint="Si se deja vacío se genera automáticamente.">
                <div style={{ position: 'relative' }}>
                  <Barcode size={15} style={{ position: 'absolute', left: 11, top: 13, color: 'var(--faint)' }} />
                  <Input
                    value={form.barcode}
                    onChange={(e) => set('barcode', e.target.value)}
                    placeholder="7701000000000"
                    style={{ paddingLeft: 34 }}
                    className="mono"
                  />
                </div>
              </Field>
            </div>

            <Field label="Nombre *" error={errors.name}>
              <Input
                value={form.name}
                onChange={(e) => set('name', e.target.value)}
                placeholder="Ej. Caja de cartón 30x20 cm"
              />
            </Field>

            <Field label="Descripción">
              <Textarea
                value={form.description}
                onChange={(e) => set('description', e.target.value)}
                placeholder="Especificaciones, dimensiones, presentación…"
              />
            </Field>

            <SectionTitle>Clasificación</SectionTitle>
            <Field label="Tipo de inventario">
              <Select value={form.type} onChange={(e) => set('type', e.target.value as ProductType)}>
                {PRODUCT_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </Select>
            </Field>

            <div className="field-row">
              <Field label="Unidad de medida">
                <Select value={form.uom} onChange={(e) => set('uom', e.target.value as Uom)}>
                  {UOMS.map((u) => (
                    <option key={u} value={u}>
                      {u} — {UOM_LABEL[u]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Ubicación física">
                <Select value={form.location} onChange={(e) => set('location', e.target.value)}>
                  {LOCATIONS.map((l) => (
                    <option key={l} value={l}>
                      {l}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          </div>
        </Card>

        <Card>
          <div className="card-pad form-grid">
            <SectionTitle>Control de existencias</SectionTitle>
            <div className="field-row">
              <Field label="Costo unitario (COP)" hint="Opcional. Si se deja vacío se asume 0." error={errors.cost}>
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  value={form.cost}
                  onChange={(e) => set('cost', e.target.value)}
                  placeholder="0"
                />
              </Field>
              <Field
                label={editing ? 'Stock actual' : 'Stock inicial'}
                hint={
                  editing
                    ? 'Editable. Si cambia, se registra un ajuste en el kardex.'
                    : 'Opcional. Se registra como ajuste positivo por saldo inicial.'
                }
                error={errors.initialStock}
              >
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  value={form.initialStock}
                  onChange={(e) => set('initialStock', e.target.value)}
                  placeholder="0"
                />
              </Field>
            </div>

            <div className="field-row">
              <Field label="Stock mínimo" error={errors.minStock}>
                <Input
                  type="number"
                  min={0}
                  value={form.minStock}
                  onChange={(e) => set('minStock', e.target.value)}
                  placeholder="500"
                />
              </Field>
              <Field label="Stock máximo" error={errors.maxStock}>
                <Input
                  type="number"
                  min={0}
                  value={form.maxStock}
                  onChange={(e) => set('maxStock', e.target.value)}
                  placeholder="4000"
                />
              </Field>
            </div>

            <SectionTitle>Trazabilidad y estado</SectionTitle>
            <label className="switch">
              <input
                type="checkbox"
                checked={form.lotTracked}
                onChange={(e) => set('lotTracked', e.target.checked)}
              />
              Controlar por lotes (obliga lote en entradas y salidas)
            </label>

            <Field label="Estado del producto">
              <Select value={form.status} onChange={(e) => set('status', e.target.value as 'activo' | 'inactivo')}>
                <option value="activo">Activo</option>
                <option value="inactivo">Inactivo</option>
              </Select>
            </Field>

            <div
              style={{
                background: 'var(--surface-2)',
                border: '1px dashed var(--line-strong)',
                borderRadius: 10,
                padding: 12,
                fontSize: 11.5,
                color: 'var(--muted)',
                lineHeight: 1.55,
              }}
            >
              Los productos no se eliminan: se desactivan para conservar la trazabilidad de sus
              movimientos, lotes y órdenes de producción asociadas.
            </div>

            <Button variant="primary" size="lg" block icon={<Save size={16} />} onClick={save} disabled={busy}>
              {busy ? 'Guardando…' : 'Guardar producto'}
            </Button>
          </div>
        </Card>
      </div>
    </>
  );
}

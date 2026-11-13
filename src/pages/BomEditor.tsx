import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  ArrowLeft,
  CheckCircle2,
  Copy,
  Layers,
  Plus,
  Save,
  Trash2,
  TriangleAlert,
} from 'lucide-react';
import { db } from '../db/schema';
import { useApp } from '../context/AppContext';
import { uid } from '../domain/format';
import { can } from '../domain/permissions';
import { explode } from '../domain/production';
import type { Bom, BomItem, Product, Uom } from '../domain/types';
import { money, qty as fmtQty } from '../domain/format';
import { ProductPicker } from '../components/ProductPicker';
import {
  Badge,
  Button,
  Card,
  CardHead,
  EmptyState,
  Field,
  Input,
  Loading,
  PageHeader,
  SectionTitle,
  Select,
  Textarea,
} from '../components/ui';

interface DraftItem {
  key: string;
  componentId: string;
  qty: string;
  wastePct: string;
  uom: Uom;
}

export function BomEditor() {
  const { id } = useParams();
  const isNew = !id || id === 'nuevo';
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { user, toast } = useApp();

  const products = useLiveQuery(() => db.products.toArray(), []);
  const [productId, setProductId] = useState(params.get('producto') ?? '');
  const [version, setVersion] = useState(1);
  const [status, setStatus] = useState<Bom['status']>('borrador');
  const [laborCost, setLaborCost] = useState('0');
  const [notes, setNotes] = useState('');
  const [code, setCode] = useState('');
  const [items, setItems] = useState<DraftItem[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [simQty, setSimQty] = useState('1');
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(isNew);

  const product = useMemo(() => (products ?? []).find((p) => p.id === productId) ?? null, [products, productId]);

  useEffect(() => {
    if (isNew) return;
    (async () => {
      const bom = await db.boms.get(id!);
      if (!bom) return;
      const bomItems = await db.bomItems.where('bomId').equals(bom.id).toArray();
      setProductId(bom.productId);
      setVersion(bom.version);
      setStatus(bom.status);
      setLaborCost(String(bom.laborCost));
      setNotes(bom.notes);
      setCode(bom.code);
      setItems(
        bomItems.map((i) => ({
          key: i.id,
          componentId: i.componentId,
          qty: String(i.qty),
          wastePct: String(i.wastePct),
          uom: i.uom,
        })),
      );
      setLoaded(true);
    })();
  }, [id, isNew]);

  useEffect(() => {
    if (!isNew || !product) return;
    setCode(`BOM-${product.sku}-v${version}`);
  }, [isNew, product, version]);

  const bomItems: BomItem[] = useMemo(
    () =>
      items.map((i) => ({
        id: i.key,
        bomId: id ?? 'nuevo',
        componentId: i.componentId,
        qty: Number(i.qty) || 0,
        uom: i.uom,
        wastePct: Number(i.wastePct) || 0,
      })),
    [items, id],
  );

  const draftBom: Bom = {
    id: id ?? 'nuevo',
    code: code || 'BOM-NUEVA',
    productId,
    version,
    status,
    outputQty: 1,
    laborCost: Number(laborCost) || 0,
    notes,
    createdAt: new Date().toISOString(),
    createdBy: user?.name ?? '',
  };

  const explosion = useMemo(() => {
    if (!products || !product) return null;
    return explode(draftBom, bomItems, products, Number(simQty) || 1);
  }, [products, product, draftBom, bomItems, simQty]);

  const addComponent = (p: Product) => {
    if (p.id === productId) {
      toast('Componente inválido', 'warn', 'El producto terminado no puede ser componente de su propia lista.');
      return;
    }
    if (items.some((i) => i.componentId === p.id)) {
      toast('Ya está en la lista', 'warn', `${p.sku} ya hace parte de esta BOM.`);
      return;
    }
    setItems((prev) => [
      ...prev,
      { key: uid(), componentId: p.id, qty: '1', wastePct: '0', uom: p.uom },
    ]);
  };

  const updateItem = (key: string, patch: Partial<DraftItem>) =>
    setItems((prev) => prev.map((i) => (i.key === key ? { ...i, ...patch } : i)));

  const removeItem = (key: string) => setItems((prev) => prev.filter((i) => i.key !== key));

  const save = async (activate: boolean) => {
    if (!user) return;
    if (!product) {
      toast('Falta el producto', 'warn', 'Seleccione el producto terminado de la lista.');
      return;
    }
    if (items.length === 0) {
      toast('Lista vacía', 'warn', 'Agregue al menos un componente.');
      return;
    }
    if (items.some((i) => Number(i.qty) <= 0)) {
      toast('Cantidad inválida', 'warn', 'Todas las cantidades deben ser mayores que cero.');
      return;
    }

    setBusy(true);
    try {
      const now = new Date().toISOString();
      const bomId = id && id !== 'nuevo' ? id : uid();
      const finalCode = code || `BOM-${product.sku}-v${version}`;

      if (activate) {
        const siblings = await db.boms.where('productId').equals(product.id).toArray();
        for (const s of siblings) {
          if (s.id !== bomId && s.status === 'activo') {
            await db.boms.update(s.id, { status: 'obsoleto' });
          }
        }
      }

      const bom: Bom = {
        id: bomId,
        code: finalCode,
        productId: product.id,
        version,
        status: activate ? 'activo' : status === 'activo' ? 'activo' : 'borrador',
        outputQty: 1,
        laborCost: Number(laborCost) || 0,
        notes,
        createdAt: isNew ? now : draftBom.createdAt,
        createdBy: user.name,
      };

      if (isNew) {
        await db.boms.add(bom);
      } else {
        await db.boms.put(bom);
        await db.bomItems.where('bomId').equals(bomId).delete();
      }

      for (const item of bomItems) {
        await db.bomItems.add({
          id: isNew ? uid() : item.id,
          bomId,
          componentId: item.componentId,
          qty: item.qty,
          uom: item.uom,
          wastePct: item.wastePct,
        });
      }

      await db.audit.add({
        id: uid(),
        entity: 'bom',
        entityId: bomId,
        action: isNew ? 'crear' : 'actualizar',
        summary: `BOM ${finalCode} ${activate ? 'activada' : 'guardada'} con ${items.length} componentes`,
        after: bom,
        userId: user.id,
        userName: user.name,
        at: now,
      });

      toast(activate ? 'BOM activada' : 'BOM guardada', 'success', `${finalCode} · ${items.length} componentes`);
      navigate(`/bom/${bomId}`);
    } catch (err) {
      toast('No se pudo guardar', 'error', err instanceof Error ? err.message : undefined);
    } finally {
      setBusy(false);
    }
  };

  const newVersion = async () => {
    if (!product) return;
    const siblings = await db.boms.where('productId').equals(product.id).toArray();
    const maxVersion = Math.max(0, ...siblings.map((s) => s.version));
    const nextVersion = maxVersion + 1;
    const newId = uid();
    const now = new Date().toISOString();
    const bom: Bom = {
      ...draftBom,
      id: newId,
      code: `BOM-${product.sku}-v${nextVersion}`,
      version: nextVersion,
      status: 'borrador',
      createdAt: now,
      createdBy: user?.name ?? '',
    };
    await db.boms.add(bom);
    for (const item of bomItems) {
      await db.bomItems.add({ ...item, id: uid(), bomId: newId });
    }
    toast('Nueva versión creada', 'success', `v${nextVersion} en borrador.`);
    navigate(`/bom/${newId}`);
  };

  if (!loaded) return <Loading rows={5} />;

  const canEdit = user ? can(user.role, 'bom.edit') : false;
  const finishedProducts = (products ?? []).filter((p) => p.type === 'PT' && p.status === 'activo');

  return (
    <>
      <PageHeader
        title={isNew ? 'Nueva lista de materiales' : `Lista de materiales ${code}`}
        subtitle={product ? `${product.name} · versión ${version}` : 'Seleccione el producto terminado'}
        back={
          <Button variant="ghost" size="sm" icon={<ArrowLeft size={16} />} onClick={() => navigate('/bom')}>
            Listas
          </Button>
        }
        actions={
          canEdit ? (
            <>
              {!isNew && (
                <Button variant="secondary" icon={<Copy size={15} />} onClick={newVersion} className="desktop-only">
                  Nueva versión
                </Button>
              )}
              <Button variant="secondary" icon={<Save size={15} />} onClick={() => save(false)} disabled={busy}>
                Guardar borrador
              </Button>
              <Button variant="primary" icon={<CheckCircle2 size={16} />} onClick={() => save(true)} disabled={busy}>
                Activar
              </Button>
            </>
          ) : undefined
        }
      />

      <div className="grid" style={{ gridTemplateColumns: 'minmax(0,1.7fr) minmax(280px,1fr)' }}>
        <div style={{ display: 'grid', gap: 16, alignContent: 'start' }}>
          <Card>
            <div className="card-pad form-grid">
              <SectionTitle>Datos generales</SectionTitle>
              <div className="field-row">
                <Field label="Producto terminado *">
                  <Select
                    value={productId}
                    onChange={(e) => setProductId(e.target.value)}
                    disabled={!isNew && !canEdit}
                  >
                    <option value="">Seleccione…</option>
                    {finishedProducts.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.sku} — {p.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Versión">
                  <Input
                    type="number"
                    min={1}
                    value={version}
                    onChange={(e) => setVersion(Number(e.target.value) || 1)}
                    disabled={!isNew}
                  />
                </Field>
              </div>
              <div className="field-row">
                <Field label="Mano de obra por unidad (COP)" hint="Se suma al costo de materiales.">
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    value={laborCost}
                    onChange={(e) => setLaborCost(e.target.value)}
                  />
                </Field>
                <Field label="Estado">
                  <Select value={status} onChange={(e) => setStatus(e.target.value as Bom['status'])}>
                    <option value="borrador">Borrador</option>
                    <option value="activo">Activa</option>
                    <option value="obsoleto">Obsoleta</option>
                  </Select>
                </Field>
              </div>
              <Field label="Notas / especificaciones">
                <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Proceso, versión, cambios…" />
              </Field>
            </div>
          </Card>

          <Card>
            <CardHead
              title="Componentes"
              subtitle="Cantidades requeridas por unidad de producto terminado"
              actions={
                canEdit ? (
                  <Button size="sm" variant="secondary" icon={<Plus size={14} />} onClick={() => setPickerOpen(true)}>
                    Agregar
                  </Button>
                ) : undefined
              }
            />
            {items.length === 0 ? (
              <EmptyState
                icon={<Layers size={22} />}
                title="Sin componentes"
                message="Agregue materias primas, insumos y empaques."
                action={
                  canEdit ? (
                    <Button size="sm" variant="primary" icon={<Plus size={14} />} onClick={() => setPickerOpen(true)}>
                      Agregar componente
                    </Button>
                  ) : undefined
                }
              />
            ) : (
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Componente</th>
                      <th className="num" style={{ width: 110 }}>
                        Cantidad
                      </th>
                      <th className="num" style={{ width: 90 }}>
                        Merma %
                      </th>
                      <th className="num">Costo</th>
                      <th className="num">Disponible</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item) => {
                      const comp = (products ?? []).find((p) => p.id === item.componentId);
                      const required = (Number(item.qty) || 0) * (1 + (Number(item.wastePct) || 0) / 100);
                      const enough = (comp?.stock ?? 0) >= required;
                      return (
                        <tr key={item.key}>
                          <td>
                            <div className="cell-main">
                              <span className="name">{comp?.name ?? '—'}</span>
                              <span className="sku">
                                {comp?.sku} · {comp?.location}
                              </span>
                            </div>
                          </td>
                          <td>
                            <div className="row" style={{ gap: 6 }}>
                              <Input
                                type="number"
                                min={0}
                                step="0.001"
                                value={item.qty}
                                onChange={(e) => updateItem(item.key, { qty: e.target.value })}
                                style={{ width: 78, textAlign: 'right' }}
                              />
                              <span className="small muted">{item.uom}</span>
                            </div>
                          </td>
                          <td>
                            <Input
                              type="number"
                              min={0}
                              step="0.1"
                              value={item.wastePct}
                              onChange={(e) => updateItem(item.key, { wastePct: e.target.value })}
                              style={{ width: 70, textAlign: 'right' }}
                            />
                          </td>
                          <td className="num">{money(required * (comp?.cost ?? 0))}</td>
                          <td className="num">
                            <Badge tone={enough ? 'ok' : 'danger'}>
                              {fmtQty(comp?.stock ?? 0)} {comp?.uom}
                            </Badge>
                          </td>
                          <td>
                            {canEdit && (
                              <button
                                className="icon-btn"
                                style={{ width: 30, height: 30 }}
                                onClick={() => removeItem(item.key)}
                                aria-label="Quitar componente"
                              >
                                <Trash2 size={14} />
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>

        <div style={{ display: 'grid', gap: 16, alignContent: 'start' }}>
          <Card>
            <CardHead title="Costeo teórico" subtitle="Por unidad de producto terminado" />
            <div className="card-pad" style={{ display: 'grid', gap: 12 }}>
              <div className="row-between">
                <span className="small muted">Materiales</span>
                <span className="bold">{money(explosion?.materialsCost ?? 0)}</span>
              </div>
              <div className="row-between">
                <span className="small muted">Mano de obra</span>
                <span className="bold">{money(Number(laborCost) || 0)}</span>
              </div>
              <div
                className="row-between"
                style={{ borderTop: '1px dashed var(--line-strong)', paddingTop: 10 }}
              >
                <span className="small muted">Costo total unitario</span>
                <span className="bold" style={{ fontSize: 18, color: 'var(--brand-3)' }}>
                  {money(explosion?.unitCost ?? 0)}
                </span>
              </div>
              <div className="row-between">
                <span className="small muted">Componentes</span>
                <span>{items.length}</span>
              </div>
            </div>
          </Card>

          <Card>
            <CardHead title="Simulación de requerimientos" subtitle="Antes de liberar una orden" />
            <div className="card-pad" style={{ display: 'grid', gap: 12 }}>
              <Field label="Cantidad a producir">
                <Input
                  type="number"
                  min={1}
                  value={simQty}
                  onChange={(e) => setSimQty(e.target.value)}
                  placeholder="1"
                />
              </Field>

              {explosion && (
                <>
                  <div className="row-between">
                    <span className="small muted">Costo materiales</span>
                    <span className="bold">{money(explosion.materialsCost)}</span>
                  </div>
                  <div className="row-between">
                    <span className="small muted">Costo total</span>
                    <span className="bold">{money(explosion.totalCost)}</span>
                  </div>
                  <div className="row-between">
                    <span className="small muted">Costo unitario</span>
                    <span className="bold">{money(explosion.unitCost)}</span>
                  </div>

                  {explosion.available ? (
                    <Badge tone="ok">
                      <CheckCircle2 size={12} /> Materiales suficientes
                    </Badge>
                  ) : (
                    <div style={{ display: 'grid', gap: 6 }}>
                      <Badge tone="danger">
                        <TriangleAlert size={12} /> {explosion.shortages.length} faltante(s)
                      </Badge>
                      <div style={{ display: 'grid', gap: 4 }}>
                        {explosion.shortages.slice(0, 6).map((s) => (
                          <div key={s.componentId} className="small muted">
                            {s.sku}: faltan {fmtQty(s.shortage)} {s.uom}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </Card>

          <Card>
            <div className="card-pad small muted" style={{ lineHeight: 1.6 }}>
              <strong className="ink" style={{ display: 'block', marginBottom: 6 }}>
                Versionamiento
              </strong>
              Al activar una versión, las demás listas activas del mismo producto pasan a obsoletas.
              Las órdenes de producción guardan la versión con la que fueron creadas.
            </div>
          </Card>
        </div>
      </div>

      <ProductPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onSelect={addComponent}
        products={products ?? []}
        filter={(p) => p.status === 'activo' && p.id !== productId && p.type !== 'PT'}
        title="Agregar componente"
        subtitle="Materias primas, insumos, empaques y repuestos"
      />
    </>
  );
}

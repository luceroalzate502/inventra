import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { ClipboardCheck, ClipboardList, Plus, Scale } from 'lucide-react';
import { db } from '../db/schema';
import { useApp } from '../context/AppContext';
import { uid } from '../domain/format';
import { can } from '../domain/permissions';
import { registerMovement } from '../domain/movements';
import type { PhysicalCount } from '../domain/types';
import { dateTime, money, pct, qty as fmtQty } from '../domain/format';
import {
  Badge,
  Button,
  Card,
  CardHead,
  EmptyRow,
  Field,
  Input,
  Modal,
  PageHeader,
  Select,
  StatCard,
  cx,
} from '../components/ui';

export function Counts() {
  const { user, toast } = useApp();
  const counts = useLiveQuery(() => db.counts.toArray(), []);
  const products = useLiveQuery(() => db.products.toArray(), []);

  const [newOpen, setNewOpen] = useState(false);
  const [category, setCategory] = useState('all');
  const [active, setActive] = useState<PhysicalCount | null>(null);
  const [draft, setDraft] = useState<PhysicalCount | null>(null);
  const [busy, setBusy] = useState(false);

  const canManage = user ? can(user.role, 'counts.manage') : false;
  const categories = Array.from(new Set((products ?? []).map((p) => p.category))).sort();

  const preview = useMemo(
    () =>
      (products ?? []).filter(
        (p) =>
          p.status === 'activo' &&
          (category === 'all' || p.category === category),
      ),
    [products, category],
  );

  const list = (counts ?? []).slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const closed = list.filter((c) => c.status === 'cerrado');

  const createCount = async () => {
    if (!user) return;
    if (preview.length === 0) {
      toast('Sin productos', 'warn', 'No hay productos para los filtros seleccionados.');
      return;
    }
    const now = new Date().toISOString();
    const code = `CNT-${String((counts?.length ?? 0) + 1).padStart(5, '0')}`;
    const count: PhysicalCount = {
      id: uid(),
      code,
      status: 'abierto',
      location: 'General',
      items: preview.map((p) => ({
        productId: p.id,
        sku: p.sku,
        name: p.name,
        uom: p.uom,
        systemQty: p.stock,
        countedQty: p.stock,
        diff: 0,
        unitCost: p.cost,
      })),
      createdAt: now,
      closedAt: null,
      userId: user.id,
      userName: user.name,
    };
    await db.counts.add(count);
    await db.audit.add({
      id: uid(),
      entity: 'count',
      entityId: count.id,
      action: 'crear',
      summary: `Conteo ${code} abierto con ${count.items.length} productos`,
      after: count,
      userId: user.id,
      userName: user.name,
      at: now,
    });
    setNewOpen(false);
    setActive(count);
    setDraft(count);
    toast('Conteo creado', 'success', `${code} · ${count.items.length} productos`);
  };

  const openCount = (count: PhysicalCount) => {
    setActive(count);
    setDraft(JSON.parse(JSON.stringify(count)) as PhysicalCount);
  };

  const updateCounted = (productId: string, value: string) => {
    setDraft((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        items: prev.items.map((i) =>
          i.productId === productId
            ? { ...i, countedQty: Number(value) || 0, diff: (Number(value) || 0) - i.systemQty }
            : i,
        ),
      };
    });
  };

  const saveDraft = async () => {
    if (!draft) return;
    await db.counts.put(draft);
    toast('Avance guardado', 'success', 'Puede continuar el conteo después.');
    setActive(draft);
  };

  const closeCount = async () => {
    if (!draft || !user) return;
    setBusy(true);
    try {
      const withDiff = draft.items.filter((i) => Math.abs(i.diff) > 0.0001);
      for (const item of withDiff) {
        const product = (products ?? []).find((p) => p.id === item.productId);
        if (!product) continue;
        await registerMovement(
          {
            type: item.diff > 0 ? 'AJUSTE_POS' : 'AJUSTE_NEG',
            reason: item.diff > 0 ? 'Ajuste positivo' : 'Ajuste negativo',
            productId: item.productId,
            qty: Math.abs(item.diff),
            unitCost: item.unitCost,
            refDoc: draft.code,
            notes: `Ajuste por conteo físico. Sistema ${item.systemQty} vs contado ${item.countedQty}`,
            allowNegative: true,
          },
          user,
        );
      }
      const closedCount: PhysicalCount = {
        ...draft,
        status: 'cerrado',
        closedAt: new Date().toISOString(),
      };
      await db.counts.put(closedCount);
      await db.audit.add({
        id: uid(),
        entity: 'count',
        entityId: closedCount.id,
        action: 'cierre',
        summary: `Conteo ${closedCount.code} cerrado · ${withDiff.length} ajustes generados`,
        after: closedCount,
        userId: user.id,
        userName: user.name,
        at: new Date().toISOString(),
      });
      toast('Conteo cerrado', 'success', `${withDiff.length} ajuste(s) aplicados al inventario.`);
      setActive(closedCount);
      setDraft(null);
    } catch (err) {
      toast('No se pudo cerrar', 'error', err instanceof Error ? err.message : undefined);
    } finally {
      setBusy(false);
    }
  };

  const accuracy = (count: PhysicalCount) => {
    const total = count.items.reduce((a, i) => a + i.systemQty * i.unitCost, 0);
    const diff = count.items.reduce((a, i) => a + Math.abs(i.diff) * i.unitCost, 0);
    return total > 0 ? Math.max(0, (1 - diff / total) * 100) : 100;
  };

  const draftDiff = draft ? draft.items.filter((i) => Math.abs(i.diff) > 0.0001) : [];
  const draftDiffValue = draftDiff.reduce((a, i) => a + i.diff * i.unitCost, 0);

  return (
    <>
      <PageHeader
        title="Conteo físico"
        subtitle="Verifique existencias reales y genere ajustes valorizados"
        actions={
          canManage ? (
            <Button variant="primary" icon={<Plus size={16} />} onClick={() => setNewOpen(true)}>
              Nuevo conteo
            </Button>
          ) : undefined
        }
      />

      <div className="kpi-grid">
        <StatCard label="Conteos realizados" value={closed.length} icon={<ClipboardCheck size={18} />} tone="brand" />
        <StatCard
          label="Conteos abiertos"
          value={list.filter((c) => c.status === 'abierto').length}
          icon={<ClipboardList size={18} />}
          tone="warn"
        />
        <StatCard
          label="Exactitud última toma"
          value={closed.length ? pct(accuracy(closed[0])) : '—'}
          icon={<Scale size={18} />}
          tone="ok"
        />
        <StatCard
          label="Diferencias valorizadas"
          value={money(closed.reduce((a, c) => a + c.items.reduce((x, i) => x + Math.abs(i.diff) * i.unitCost, 0), 0))}
          icon={<Scale size={18} />}
          tone="danger"
        />
      </div>

      <Card>
        <CardHead title="Historial de conteos" subtitle="Tomas físicas y su impacto" />
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Código</th>
                <th>Estado</th>
                <th className="num">Productos</th>
                <th className="num">Diferencias</th>
                <th className="num">Exactitud</th>
                <th>Responsable</th>
                <th>Fecha</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.length === 0 ? (
                <EmptyRow colSpan={8} message="Sin conteos. Inicie una toma física para empezar." />
              ) : (
                list.map((c) => {
                  const diffs = c.items.filter((i) => Math.abs(i.diff) > 0.0001);
                  return (
                    <tr key={c.id} style={{ cursor: 'pointer' }} onClick={() => openCount(c)}>
                      <td className="mono strong">{c.code}</td>
                      <td>
                        <Badge tone={c.status === 'cerrado' ? 'ok' : 'warn'}>{c.status}</Badge>
                      </td>
                      <td className="num">{c.items.length}</td>
                      <td className="num">{diffs.length}</td>
                      <td className="num">{pct(accuracy(c))}</td>
                      <td className="small muted">{c.userName}</td>
                      <td className="small muted">{dateTime(c.createdAt)}</td>
                      <td>
                        <Button variant="ghost" size="sm">
                          Abrir
                        </Button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Modal
        open={newOpen}
        onClose={() => setNewOpen(false)}
        title="Nuevo conteo físico"
        subtitle="Seleccione el alcance de la toma"
        footer={
          <>
            <Button variant="ghost" onClick={() => setNewOpen(false)}>
              Cancelar
            </Button>
            <Button variant="primary" onClick={createCount} icon={<ClipboardCheck size={15} />}>
              Iniciar conteo
            </Button>
          </>
        }
      >
        <div className="field-row">
          <Field label="Categoría">
            <Select value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="all">Todas las categorías</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="row-between small">
          <span className="muted">Productos incluidos</span>
          <strong>{preview.length}</strong>
        </div>
        <div className="small muted" style={{ lineHeight: 1.55 }}>
          Al cerrar el conteo, las diferencias se registran como ajustes positivos o negativos con
          documento {`CNT-xxxxx`}. El historial de movimientos se conserva.
        </div>
      </Modal>

      <Modal
        open={Boolean(active && draft)}
        onClose={() => {
          setActive(null);
          setDraft(null);
        }}
        title={`Conteo ${draft?.code ?? ''}`}
        subtitle={`${draft?.status === 'cerrado' ? 'Cerrado' : 'En progreso'} · ${draft?.items.length ?? 0} producto(s)`}
        size="lg"
        footer={
          draft?.status === 'abierto' && canManage ? (
            <>
              <Button variant="ghost" onClick={() => { setActive(null); setDraft(null); }}>
                Cerrar
              </Button>
              <Button variant="secondary" onClick={saveDraft}>
                Guardar avance
              </Button>
              <Button variant="primary" onClick={closeCount} disabled={busy}>
                {busy ? 'Aplicando…' : 'Cerrar conteo y ajustar'}
              </Button>
            </>
          ) : (
            <Button variant="ghost" onClick={() => { setActive(null); setDraft(null); }}>
              Cerrar
            </Button>
          )
        }
      >
        {draft && (
          <>
            <div className="grid grid-3" style={{ gap: 10 }}>
              <div style={{ background: 'var(--surface-2)', borderRadius: 10, padding: 12 }}>
                <div className="meta-label">Productos</div>
                <div className="bold" style={{ fontSize: 17 }}>{draft.items.length}</div>
              </div>
              <div style={{ background: 'var(--surface-2)', borderRadius: 10, padding: 12 }}>
                <div className="meta-label">Diferencias</div>
                <div className="bold" style={{ fontSize: 17, color: draftDiff.length ? 'var(--warn)' : 'var(--ok)' }}>
                  {draftDiff.length}
                </div>
              </div>
              <div style={{ background: 'var(--surface-2)', borderRadius: 10, padding: 12 }}>
                <div className="meta-label">Impacto valorizado</div>
                <div className="bold" style={{ fontSize: 17 }}>{money(draftDiffValue)}</div>
              </div>
            </div>

            <div className="table-wrap" style={{ maxHeight: '48vh' }}>
              <table className="data">
                <thead>
                  <tr>
                    <th>Producto</th>
                    <th className="num">Sistema</th>
                    <th className="num" style={{ width: 120 }}>Contado</th>
                    <th className="num">Diferencia</th>
                    <th className="num">Valor</th>
                  </tr>
                </thead>
                <tbody>
                  {draft.items.map((i) => (
                    <tr key={i.productId}>
                      <td>
                        <div className="cell-main">
                          <span className="name">{i.name}</span>
                          <span className="sku">{i.sku}</span>
                        </div>
                      </td>
                      <td className="num">
                        {fmtQty(i.systemQty)} {i.uom}
                      </td>
                      <td>
                        <Input
                          type="number"
                          min={0}
                          step="0.01"
                          value={i.countedQty}
                          disabled={draft.status === 'cerrado'}
                          onChange={(e) => updateCounted(i.productId, e.target.value)}
                          style={{ textAlign: 'right' }}
                        />
                      </td>
                      <td className="num">
                        <span
                          className={cx(Math.abs(i.diff) > 0.0001 && 'bold')}
                          style={{ color: i.diff > 0 ? 'var(--ok)' : i.diff < 0 ? 'var(--danger)' : 'var(--muted)' }}
                        >
                          {i.diff > 0 ? '+' : ''}
                          {fmtQty(i.diff)}
                        </span>
                      </td>
                      <td className="num">{money(i.diff * i.unitCost)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Modal>
    </>
  );
}

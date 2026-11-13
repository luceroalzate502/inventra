import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowUpFromLine,
  Download,
  FileText,
  RotateCcw,
  Undo2,
} from 'lucide-react';
import { db } from '../db/schema';
import { useApp } from '../context/AppContext';
import { can } from '../domain/permissions';
import { MOVEMENT_META } from '../domain/types';
import type { Movement } from '../domain/types';
import { dateTime, money, qty as fmtQty } from '../domain/format';
import { buildKardex } from '../domain/reports';
import { reverseMovement } from '../domain/movements';
import { exportExcel, exportPdf } from '../domain/export';
import {
  Badge,
  Button,
  Card,
  CardHead,
  ConfirmDialog,
  EmptyState,
  Input,
  Loading,
  Modal,
  PageHeader,
  ProductStatusBadge,
  Select,
  StatCard,
} from '../components/ui';

export function Kardex() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user, settings, toast } = useApp();

  const product = useLiveQuery(() => (id ? db.products.get(id) : undefined), [id]);
  const movements = useLiveQuery(
    () => (id ? db.movements.where('productId').equals(id).toArray() : []),
    [id],
  );

  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [type, setType] = useState('all');
  const [selected, setSelected] = useState<Movement | null>(null);
  const [revertOpen, setRevertOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const allRows = useMemo(() => (id && movements ? buildKardex(movements, id) : []), [id, movements]);

  const rows = useMemo(
    () =>
      allRows
        .filter((r) => (from ? r.movement.createdAt.slice(0, 10) >= from : true))
        .filter((r) => (to ? r.movement.createdAt.slice(0, 10) <= to : true))
        .filter((r) => (type === 'all' ? true : r.movement.type === type))
        .reverse(),
    [allRows, from, to, type],
  );

  if (!product) return <Loading rows={5} />;

  const totalIn = allRows.reduce((a, r) => a + r.inQty, 0);
  const totalOut = allRows.reduce((a, r) => a + r.outQty, 0);
  const canReverse = user ? can(user.role, 'inventory.reverse') : false;

  const doExcel = () => {
    exportExcel(`kardex-${product.sku}`, [
      {
        name: 'Kardex',
        rows: rows.map((r) => ({
          Fecha: dateTime(r.movement.createdAt),
          Código: r.movement.code,
          Tipo: MOVEMENT_META[r.movement.type].label,
          Motivo: r.movement.reason,
          Entrada: r.inQty || '',
          Salida: r.outQty || '',
          Saldo: r.balance,
          'Costo unitario': r.movement.unitCost,
          'Valor total': r.movement.totalCost,
          Lote: r.movement.lotCode ?? '',
          Documento: r.movement.refDoc ?? '',
          Responsable: r.movement.userName,
        })),
        widths: [18, 12, 22, 24, 10, 10, 10, 14, 14, 12, 14, 20],
      },
    ]);
    toast('Excel generado', 'success');
  };

  const doPdf = () => {
    exportPdf({
      filename: `kardex-${product.sku}`,
      title: `Kardex · ${product.name}`,
      subtitle: `${product.sku} · saldo actual ${fmtQty(product.stock)} ${product.uom}`,
      company: settings?.companyName ?? 'INVENTRA',
      user: user?.name,
      landscape: true,
      columns: ['Fecha', 'Código', 'Tipo', 'Motivo', 'Entrada', 'Salida', 'Saldo', 'Valor'],
      rows: rows.map((r) => [
        dateTime(r.movement.createdAt),
        r.movement.code,
        MOVEMENT_META[r.movement.type].label,
        r.movement.reason,
        r.inQty ? fmtQty(r.inQty) : '',
        r.outQty ? fmtQty(r.outQty) : '',
        fmtQty(r.balance),
        money(r.movement.totalCost),
      ]),
      totals: [
        `Total entradas: ${fmtQty(totalIn)} ${product.uom}`,
        `Total salidas: ${fmtQty(totalOut)} ${product.uom}`,
        `Saldo final: ${fmtQty(product.stock)} ${product.uom}`,
      ],
    });
    toast('PDF generado', 'success');
  };

  const revert = async (reason: string) => {
    if (!selected || !user) return;
    setBusy(true);
    try {
      await reverseMovement(selected.id, reason, user);
      toast('Movimiento revertido', 'success', `${selected.code} fue compensado con una reversión.`);
      setRevertOpen(false);
      setSelected(null);
    } catch (err) {
      toast('No se pudo revertir', 'error', err instanceof Error ? err.message : undefined);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        title={`Kardex · ${product.sku}`}
        subtitle={product.name}
        back={
          <Button variant="ghost" size="sm" icon={<ArrowLeft size={16} />} onClick={() => navigate(`/productos/${product.id}`)}>
            Producto
          </Button>
        }
        actions={
          <>
            <Button variant="secondary" size="sm" icon={<Download size={15} />} onClick={doExcel} className="desktop-only">
              Excel
            </Button>
            <Button variant="secondary" size="sm" icon={<FileText size={15} />} onClick={doPdf} className="desktop-only">
              PDF
            </Button>
          </>
        }
      />

      <div className="kpi-grid">
        <StatCard
          label="Saldo actual"
          value={`${fmtQty(product.stock)} ${product.uom}`}
          icon={<ArrowDownToLine size={18} />}
          tone="brand"
          foot={<ProductStatusBadge stock={product.stock} minStock={product.minStock} />}
        />
        <StatCard
          label="Total entradas"
          value={`${fmtQty(totalIn)} ${product.uom}`}
          icon={<ArrowDownToLine size={18} />}
          tone="ok"
          foot={<span>{allRows.filter((r) => r.inQty > 0).length} movimientos</span>}
        />
        <StatCard
          label="Total salidas"
          value={`${fmtQty(totalOut)} ${product.uom}`}
          icon={<ArrowUpFromLine size={18} />}
          tone="danger"
          foot={<span>{allRows.filter((r) => r.outQty > 0).length} movimientos</span>}
        />
        <StatCard
          label="Valor del saldo"
          value={money(product.stock * product.cost)}
          icon={<FileText size={18} />}
          tone="info"
          foot={<span>Costo promedio {money(product.cost)}</span>}
        />
      </div>

      <Card className="mb-16">
        <div className="card-pad row wrap" style={{ gap: 10 }}>
          <div className="row" style={{ gap: 8 }}>
            <span className="small muted nowrap">Desde</span>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={{ width: 150 }} />
          </div>
          <div className="row" style={{ gap: 8 }}>
            <span className="small muted nowrap">Hasta</span>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={{ width: 150 }} />
          </div>
          <Select value={type} onChange={(e) => setType(e.target.value)} style={{ width: 210 }}>
            <option value="all">Todos los tipos</option>
            {Object.entries(MOVEMENT_META).map(([key, meta]) => (
              <option key={key} value={key}>
                {meta.label}
              </option>
            ))}
          </Select>
          <span className="small muted" style={{ marginLeft: 'auto' }}>
            {rows.length} registros
          </span>
        </div>
      </Card>

      <Card>
        <CardHead title="Historial de movimientos" subtitle="Saldo corrido calculado desde el origen" />
        {rows.length === 0 ? (
          <EmptyState icon={<FileText size={24} />} title="Sin movimientos en el rango" />
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Código</th>
                  <th>Tipo</th>
                  <th>Motivo / documento</th>
                  <th className="num">Entrada</th>
                  <th className="num">Salida</th>
                  <th className="num">Saldo</th>
                  <th className="num">Valor</th>
                  <th>Responsable</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.movement.id}>
                    <td className="small nowrap">{dateTime(r.movement.createdAt)}</td>
                    <td className="mono small">{r.movement.code}</td>
                    <td>
                      <Badge tone={r.movement.direction === 1 ? 'ok' : 'danger'}>
                        {MOVEMENT_META[r.movement.type].label}
                      </Badge>
                      {r.movement.reversedBy && (
                        <div className="small faint" style={{ marginTop: 3 }}>
                          revertido
                        </div>
                      )}
                    </td>
                    <td className="small">
                      {r.movement.reason}
                      {r.movement.refDoc && <div className="faint mono small">{r.movement.refDoc}</div>}
                    </td>
                    <td className="num" style={{ color: 'var(--ok)' }}>
                      {r.inQty ? fmtQty(r.inQty) : '—'}
                    </td>
                    <td className="num" style={{ color: 'var(--danger)' }}>
                      {r.outQty ? fmtQty(r.outQty) : '—'}
                    </td>
                    <td className="num bold">{fmtQty(r.balance)}</td>
                    <td className="num">{money(r.movement.totalCost)}</td>
                    <td className="small muted">{r.movement.userName}</td>
                    <td>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setSelected(r.movement);
                        }}
                      >
                        Ver
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal
        open={Boolean(selected) && !revertOpen}
        onClose={() => setSelected(null)}
        title="Detalle del movimiento"
        subtitle={selected ? `${selected.code} · ${MOVEMENT_META[selected.type].label}` : undefined}
        footer={
          <Button variant="ghost" onClick={() => setSelected(null)}>
            Cerrar
          </Button>
        }
      >
        {selected && (
          <div style={{ display: 'grid', gap: 10 }}>
            <div className="row-between">
              <span className="small muted">Código</span>
              <span className="mono bold">{selected.code}</span>
            </div>
            <div className="row-between">
              <span className="small muted">Tipo</span>
              <Badge tone={selected.direction === 1 ? 'ok' : 'danger'}>
                {MOVEMENT_META[selected.type].label}
              </Badge>
            </div>
            <div className="row-between">
              <span className="small muted">Cantidad</span>
              <span className="bold">
                {selected.direction === 1 ? '+' : '−'}
                {fmtQty(selected.qty)} {product.uom}
              </span>
            </div>
            <div className="row-between">
              <span className="small muted">Saldo antes / después</span>
              <span>
                {fmtQty(selected.stockBefore)} → <strong>{fmtQty(selected.stockAfter)}</strong>
              </span>
            </div>
            <div className="row-between">
              <span className="small muted">Costo unitario</span>
              <span>{money(selected.unitCost)}</span>
            </div>
            <div className="row-between">
              <span className="small muted">Valor total</span>
              <span className="bold">{money(selected.totalCost)}</span>
            </div>
            <div className="row-between">
              <span className="small muted">Lote</span>
              <span className="mono">{selected.lotCode ?? '—'}</span>
            </div>
            <div className="row-between">
              <span className="small muted">Tercero</span>
              <span>{selected.counterparty ?? '—'}</span>
            </div>
            <div className="row-between">
              <span className="small muted">Documento</span>
              <span className="mono">{selected.refDoc ?? '—'}</span>
            </div>
            <div className="row-between">
              <span className="small muted">Responsable</span>
              <span>
                {selected.userName} · {dateTime(selected.createdAt)}
              </span>
            </div>
            {selected.notes && (
              <div>
                <div className="meta-label">Observaciones</div>
                <div className="small">{selected.notes}</div>
              </div>
            )}

            {canReverse && !selected.reversedBy && selected.type !== 'REVERSION' && (
              <Button
                variant="danger"
                icon={<RotateCcw size={15} />}
                onClick={() => setRevertOpen(true)}
                style={{ marginTop: 6 }}
              >
                Revertir movimiento
              </Button>
            )}
            {selected.reversedBy && (
              <Badge tone="warn">
                <Undo2 size={12} /> Este movimiento ya fue revertido
              </Badge>
            )}
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={revertOpen}
        title="Revertir movimiento"
        message="Se creará un movimiento de reversión con el signo contrario. El movimiento original se conserva y queda marcado como revertido."
        confirmLabel="Revertir"
        tone="danger"
        withReason
        reasonLabel="Motivo de la reversión"
        busy={busy}
        onCancel={() => setRevertOpen(false)}
        onConfirm={revert}
      />
    </>
  );
}

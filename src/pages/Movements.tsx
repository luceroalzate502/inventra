import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowDownToLine, ArrowLeftRight, ArrowUpFromLine, Download, FileText } from 'lucide-react';
import { db } from '../db/schema';
import { useApp } from '../context/AppContext';
import { MOVEMENT_META } from '../domain/types';
import { dateTime, money, qty as fmtQty } from '../domain/format';
import { exportExcel, exportPdf } from '../domain/export';
import {
  Badge,
  Button,
  Card,
  EmptyRow,
  EmptyState,
  Input,
  PageHeader,
  SearchInput,
  Select,
} from '../components/ui';

export function Movements() {
  const navigate = useNavigate();
  const { user, settings, toast } = useApp();
  const movements = useLiveQuery(() => db.movements.toArray(), []);
  const [search, setSearch] = useState('');
  const [direction, setDirection] = useState<'all' | 'in' | 'out'>('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [limit, setLimit] = useState(100);

  const filtered = useMemo(() => {
    if (!movements) return [];
    const term = search.trim().toLowerCase();
    return movements
      .filter((m) => (direction === 'all' ? true : direction === 'in' ? m.direction === 1 : m.direction === -1))
      .filter((m) => (from ? m.createdAt.slice(0, 10) >= from : true))
      .filter((m) => (to ? m.createdAt.slice(0, 10) <= to : true))
      .filter(
        (m) =>
          !term ||
          m.productName.toLowerCase().includes(term) ||
          m.productSku.toLowerCase().includes(term) ||
          m.code.toLowerCase().includes(term) ||
          m.reason.toLowerCase().includes(term) ||
          (m.counterparty ?? '').toLowerCase().includes(term) ||
          (m.refDoc ?? '').toLowerCase().includes(term),
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [movements, search, direction, from, to]);

  const totals = filtered.reduce(
    (acc, m) => {
      if (m.direction === 1) acc.inValue += m.totalCost;
      else acc.outValue += m.totalCost;
      return acc;
    },
    { inValue: 0, outValue: 0 },
  );

  const excel = () => {
    exportExcel('kardex-movimientos', [
      {
        name: 'Movimientos',
        rows: filtered.map((m) => ({
          Código: m.code,
          Fecha: dateTime(m.createdAt),
          Tipo: MOVEMENT_META[m.type].label,
          SKU: m.productSku,
          Producto: m.productName,
          Motivo: m.reason,
          Cantidad: m.qty,
          'Costo unitario': m.unitCost,
          'Valor total': m.totalCost,
          Lote: m.lotCode ?? '',
          Tercero: m.counterparty ?? '',
          Documento: m.refDoc ?? '',
          Responsable: m.userName,
        })),
        widths: [12, 18, 22, 14, 32, 24, 10, 14, 14, 12, 24, 14, 20],
      },
    ]);
    toast('Excel generado', 'success', `${filtered.length} movimientos exportados.`);
  };

  const pdf = () => {
    exportPdf({
      filename: 'kardex-movimientos',
      title: 'Historial de movimientos',
      subtitle: `${filtered.length} registros · entradas ${money(totals.inValue)} · salidas ${money(totals.outValue)}`,
      company: settings?.companyName ?? 'INVENTRA',
      user: user?.name,
      landscape: true,
      columns: ['Código', 'Fecha', 'Tipo', 'Producto', 'Cantidad', 'Valor', 'Responsable'],
      rows: filtered.map((m) => [
        m.code,
        dateTime(m.createdAt),
        MOVEMENT_META[m.type].label,
        `${m.productSku} · ${m.productName}`,
        `${m.direction === 1 ? '+' : '−'}${fmtQty(m.qty)}`,
        money(m.totalCost),
        m.userName,
      ]),
      totals: [
        `Total entradas: ${money(totals.inValue)}`,
        `Total salidas: ${money(totals.outValue)}`,
      ],
    });
    toast('PDF generado', 'success');
  };

  return (
    <>
      <PageHeader
        title="Movimientos"
        subtitle={`${filtered.length} transacciones · trazabilidad completa`}
        actions={
          <>
            <Button variant="secondary" size="sm" icon={<Download size={15} />} onClick={excel} className="desktop-only">
              Excel
            </Button>
            <Button variant="secondary" size="sm" icon={<FileText size={15} />} onClick={pdf} className="desktop-only">
              PDF
            </Button>
          </>
        }
      />

      <Card className="mb-16">
        <div className="card-pad" style={{ display: 'grid', gap: 12 }}>
          <div className="row wrap" style={{ gap: 10 }}>
            <SearchInput value={search} onChange={setSearch} placeholder="Producto, código, documento o tercero…" />
            <Select
              value={direction}
              onChange={(e) => setDirection(e.target.value as typeof direction)}
              style={{ width: 150 }}
            >
              <option value="all">Todos</option>
              <option value="in">Entradas</option>
              <option value="out">Salidas</option>
            </Select>
          </div>
          <div className="row wrap" style={{ gap: 10 }}>
            <div className="row" style={{ gap: 8 }}>
              <span className="small muted nowrap">Desde</span>
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={{ width: 150 }} />
            </div>
            <div className="row" style={{ gap: 8 }}>
              <span className="small muted nowrap">Hasta</span>
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={{ width: 150 }} />
            </div>
            {(from || to || search || direction !== 'all') && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setFrom('');
                  setTo('');
                  setSearch('');
                  setDirection('all');
                }}
              >
                Limpiar filtros
              </Button>
            )}
          </div>
        </div>
      </Card>

      <div className="grid grid-2 mb-16">
        <Card>
          <div className="card-pad row-between">
            <div className="row" style={{ gap: 10 }}>
              <div className="stat-icon tone-ok">
                <ArrowDownToLine size={17} />
              </div>
              <div>
                <div className="meta-label">Entradas filtradas</div>
                <div className="bold" style={{ fontSize: 17 }}>
                  {money(totals.inValue)}
                </div>
              </div>
            </div>
            <Badge tone="ok">
              {filtered.filter((m) => m.direction === 1).length} mov.
            </Badge>
          </div>
        </Card>
        <Card>
          <div className="card-pad row-between">
            <div className="row" style={{ gap: 10 }}>
              <div className="stat-icon tone-danger">
                <ArrowUpFromLine size={17} />
              </div>
              <div>
                <div className="meta-label">Salidas filtradas</div>
                <div className="bold" style={{ fontSize: 17 }}>
                  {money(totals.outValue)}
                </div>
              </div>
            </div>
            <Badge tone="danger">
              {filtered.filter((m) => m.direction === -1).length} mov.
            </Badge>
          </div>
        </Card>
      </div>

      <Card>
        {filtered.length === 0 && (
          <div className="table-wrap desktop-only">
            <table className="data">
              <thead>
                <tr>
                  <th>Código</th>
                  <th>Fecha</th>
                  <th>Producto</th>
                  <th>Tipo</th>
                  <th>Motivo</th>
                  <th className="num">Cantidad</th>
                  <th className="num">Valor</th>
                  <th>Responsable</th>
                </tr>
              </thead>
              <tbody>
                <EmptyRow colSpan={8} message="Sin movimientos. Ajuste los filtros o registre una entrada/salida." />
              </tbody>
            </table>
          </div>
        )}
        {filtered.length === 0 ? (
          <div className="mobile-only">
            <EmptyState
              icon={<ArrowLeftRight size={24} />}
              title="Sin movimientos"
              message="Ajuste los filtros o registre una entrada/salida."
            />
          </div>
        ) : (
          <>
            <div className="table-wrap desktop-only">
              <table className="data">
                <thead>
                  <tr>
                    <th>Código</th>
                    <th>Fecha</th>
                    <th>Producto</th>
                    <th>Tipo</th>
                    <th>Motivo</th>
                    <th className="num">Cantidad</th>
                    <th className="num">Valor</th>
                    <th>Responsable</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.slice(0, limit).map((m) => (
                    <tr
                      key={m.id}
                      style={{ cursor: 'pointer' }}
                      onClick={() => navigate(`/kardex/${m.productId}`)}
                    >
                      <td className="mono small">{m.code}</td>
                      <td className="small nowrap">{dateTime(m.createdAt)}</td>
                      <td>
                        <div className="cell-main">
                          <span className="name">{m.productName}</span>
                          <span className="sku">{m.productSku}</span>
                        </div>
                      </td>
                      <td>
                        <Badge tone={m.direction === 1 ? 'ok' : 'danger'}>
                          {MOVEMENT_META[m.type].label}
                        </Badge>
                      </td>
                      <td className="small">
                        {m.reason}
                        {m.refDoc && <div className="faint small mono">{m.refDoc}</div>}
                      </td>
                      <td
                        className="num strong"
                        style={{ color: m.direction === 1 ? 'var(--ok)' : 'var(--danger)' }}
                      >
                        {m.direction === 1 ? '+' : '−'}
                        {fmtQty(m.qty)}
                      </td>
                      <td className="num">{money(m.totalCost)}</td>
                      <td className="small muted">{m.userName}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mobile-only">
              <div className="list">
                {filtered.slice(0, limit).map((m) => (
                  <button
                    key={m.id}
                    className="list-item"
                    style={{ border: 'none', background: 'none', width: '100%', textAlign: 'left', cursor: 'pointer' }}
                    onClick={() => navigate(`/kardex/${m.productId}`)}
                  >
                    <div
                      className="list-icon"
                      style={{
                        background: m.direction === 1 ? 'var(--ok-soft)' : 'var(--danger-soft)',
                        color: m.direction === 1 ? 'var(--ok)' : 'var(--danger)',
                      }}
                    >
                      {m.direction === 1 ? <ArrowDownToLine size={16} /> : <ArrowUpFromLine size={16} />}
                    </div>
                    <div className="list-main">
                      <div className="list-title">{m.productName}</div>
                      <div className="list-sub">
                        {m.reason} · {dateTime(m.createdAt)}
                      </div>
                    </div>
                    <div
                      className="list-value"
                      style={{ color: m.direction === 1 ? 'var(--ok)' : 'var(--danger)' }}
                    >
                      {m.direction === 1 ? '+' : '−'}
                      {fmtQty(m.qty)}
                      <div className="small faint" style={{ fontWeight: 400 }}>
                        {money(m.totalCost)}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            <div className="table-foot">
              <span>
                Mostrando {Math.min(limit, filtered.length)} de {filtered.length} movimientos
              </span>
              {filtered.length > limit && (
                <Button variant="secondary" size="sm" onClick={() => setLimit((l) => l + 100)} style={{ marginLeft: 'auto' }}>
                  Cargar más
                </Button>
              )}
            </div>
          </>
        )}
      </Card>
    </>
  );
}

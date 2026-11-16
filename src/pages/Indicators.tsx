import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  AlertTriangle,
  BarChart3,
  Download,
  Factory,
  FileSpreadsheet,
  FileText,
  Gauge,
  Package,
  RotateCcw,
  ShieldCheck,
} from 'lucide-react';
import { db } from '../db/schema';
import { useApp } from '../context/AppContext';
import { dateTime, money, pct, qty as fmtQty } from '../domain/format';
import { exportExcel, exportPdf } from '../domain/export';
import { pncByDefect } from '../domain/pnc';
import { localDateKey, summarize, summarizeByMachine, summarizeByShift, todayKey } from '../domain/productionDaily';
import { DEFECT_TYPES, buildShifts, DEFAULT_SHIFT_MINUTES, DEFAULT_SHIFT_START_HOUR } from '../domain/types';
import {
  Badge,
  Button,
  Card,
  CardHead,
  EmptyRow,
  Input,
  PageHeader,
  StatCard,
} from '../components/ui';
import { HBars } from '../components/charts';

const daysAgoKey = (days: number) => {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return localDateKey(d);
};

const spanDays = (from: string, to: string) => {
  const a = new Date(`${from}T00:00:00`).getTime();
  const b = new Date(`${to}T00:00:00`).getTime();
  return Math.max(1, Math.round((b - a) / 86400000) + 1);
};

export function Indicators() {
  const { user, settings } = useApp();
  const [from, setFrom] = useState(daysAgoKey(29));
  const [to, setTo] = useState(todayKey());

  const records = useLiveQuery(() => db.productionRecords.toArray(), []) ?? [];
  const machines = useLiveQuery(() => db.machines.toArray(), []) ?? [];
  const products = useLiveQuery(() => db.products.toArray(), []) ?? [];
  const movements = useLiveQuery(() => db.movements.toArray(), []) ?? [];
  const counts = useLiveQuery(() => db.counts.toArray(), []) ?? [];
  const pncs = useLiveQuery(() => db.pnc.toArray(), []) ?? [];

  const inRange = (date: string) => (!from || date >= from) && (!to || date <= to);

  const periodRecords = useMemo(
    () => records.filter((r) => inRange(r.date)),
    [records, from, to],
  );

  const overall = useMemo(() => summarize(periodRecords), [periodRecords]);
  const shifts = useMemo(
    () =>
      buildShifts(
        settings?.shiftDurationMinutes ?? DEFAULT_SHIFT_MINUTES,
        settings?.shiftStartHour ?? DEFAULT_SHIFT_START_HOUR,
      ),
    [settings?.shiftDurationMinutes, settings?.shiftStartHour],
  );
  const byShift = useMemo(() => summarizeByShift(periodRecords, shifts), [periodRecords, shifts]);
  const byMachine = useMemo(() => summarizeByMachine(periodRecords, machines), [periodRecords, machines]);

  const periodPncs = useMemo(() => pncs.filter((p) => inRange(p.date)), [pncs, from, to]);
  const defectRows = useMemo(
    () =>
      pncByDefect(periodPncs, products)
        .map((row) => ({
          label: DEFECT_TYPES.find((d) => d.value === row.type)?.label ?? row.type,
          value: row.qty,
          extra: `${row.count} caso(s) · ${money(row.cost)}`,
        }))
        .sort((a, b) => b.value - a.value),
    [periodPncs, products],
  );

  const ptProducts = useMemo(
    () => products.filter((p) => p.type === 'PT' && p.status === 'activo'),
    [products],
  );
  const ptIds = useMemo(() => new Set(ptProducts.map((p) => p.id)), [ptProducts]);
  const ptValue = ptProducts.reduce((a, p) => a + Math.max(0, p.stock) * p.cost, 0);
  const ptExits = movements.filter(
    (m) => m.direction === -1 && ptIds.has(m.productId) && inRange(m.createdAt.slice(0, 10)),
  );
  const ptExitsValue = ptExits.reduce((a, m) => a + m.totalCost, 0);
  const periodDays = spanDays(from, to);
  const ptTurnover = ptValue > 0 ? ptExitsValue / ptValue : 0;
  const ptCoverageDays = ptExitsValue > 0 ? ptValue / (ptExitsValue / periodDays) : null;

  const lastCount = useMemo(
    () =>
      counts
        .filter((c) => c.status === 'cerrado')
        .sort((a, b) => (b.closedAt ?? '').localeCompare(a.closedAt ?? ''))[0] ?? null,
    [counts],
  );

  const ira = useMemo(() => {
    if (!lastCount) return null;
    const totalValue = lastCount.items.reduce((a, i) => a + i.systemQty * i.unitCost, 0);
    const diffValue = lastCount.items.reduce((a, i) => a + Math.abs(i.diff) * i.unitCost, 0);
    if (totalValue <= 0) return 100;
    return Math.max(0, (1 - diffValue / totalValue) * 100);
  }, [lastCount]);

  const discrepancies = useMemo(
    () =>
      (lastCount?.items ?? [])
        .filter((i) => Math.abs(i.diff) > 0.0001)
        .sort((a, b) => Math.abs(b.diff) * b.unitCost - Math.abs(a.diff) * a.unitCost)
        .slice(0, 8),
    [lastCount],
  );

  const shiftBars = byShift
    .filter((s) => s.records > 0)
    .map((s) => ({
      label: s.shift.label,
      value: s.oee,
      extra: `A ${pct(s.availability)} · R ${pct(s.performance)} · C ${pct(s.quality)} · scrap ${pct(s.scrapPct)}`,
    }));

  const machineBars = byMachine.slice(0, 8).map((m) => ({
    label: `${m.machine.code} · ${m.machine.name}`,
    value: m.oee,
    extra: `${fmtQty(m.good)} conformes · scrap ${pct(m.scrapPct)}`,
  }));

  const exportExcelReport = () => {
    exportExcel(`indicadores-planta-${from}-${to}.xlsx`, [
      {
        name: 'Resumen',
        rows: [
          { Indicador: 'Periodo', Valor: `${from} a ${to}` },
          { Indicador: 'Registros de producción', Valor: overall.records },
          { Indicador: 'Piezas programadas', Valor: overall.planned },
          { Indicador: 'Piezas conformes', Valor: overall.good },
          { Indicador: 'Scrap', Valor: overall.scrap },
          { Indicador: 'OEE', Valor: overall.oee },
          { Indicador: 'Disponibilidad', Valor: overall.availability },
          { Indicador: 'Rendimiento', Valor: overall.performance },
          { Indicador: 'Calidad', Valor: overall.quality },
          { Indicador: 'Índice de scrap %', Valor: overall.scrapPct },
          { Indicador: 'Cumplimiento %', Valor: overall.compliance },
          { Indicador: 'Rotación PT periodo', Valor: Number(ptTurnover.toFixed(2)) },
          { Indicador: 'Días de inventario PT', Valor: ptCoverageDays === null ? '—' : Number(ptCoverageDays.toFixed(1)) },
          { Indicador: 'IRA %', Valor: ira === null ? '—' : Number(ira.toFixed(1)) },
          { Indicador: 'Valor inventario PT', Valor: Math.round(ptValue) },
          { Indicador: 'Salidas PT valor', Valor: Math.round(ptExitsValue) },
        ],
        widths: [34, 26],
      },
      {
        name: 'Turnos',
        rows: byShift.map((s) => ({
          Turno: s.shift.label,
          Registros: s.records,
          Programado: s.planned,
          Conformes: s.good,
          Scrap: s.scrap,
          OEE: s.oee,
          Disponibilidad: s.availability,
          Rendimiento: s.performance,
          Calidad: s.quality,
          'Scrap %': s.scrapPct,
          'Cumplimiento %': s.compliance,
        })),
        widths: [14, 10, 12, 12, 10, 10, 14, 14, 10, 10, 14],
      },
      {
        name: 'Máquinas',
        rows: byMachine.map((m) => ({
          Código: m.machine.code,
          Máquina: m.machine.name,
          Registros: m.records,
          Conformes: m.good,
          Scrap: m.scrap,
          OEE: m.oee,
          Disponibilidad: m.availability,
          Rendimiento: m.performance,
          Calidad: m.quality,
          'Scrap %': m.scrapPct,
        })),
        widths: [12, 26, 10, 12, 10, 10, 14, 14, 10, 10],
      },
      {
        name: 'Scrap por defecto',
        rows: defectRows.map((d) => ({ Defecto: d.label, Unidades: d.value, Detalle: d.extra })),
        widths: [28, 12, 40],
      },
    ]);
  };

  const exportPdfReport = () => {
    exportPdf({
      filename: `indicadores-planta-${from}-${to}`,
      title: 'Indicadores de planta y almacén',
      subtitle: `Periodo ${from} a ${to} · OEE ${pct(overall.oee)} · scrap ${pct(overall.scrapPct)}`,
      company: settings?.companyName ?? 'INVENTRA',
      user: user?.name,
      landscape: true,
      columns: ['Turno', 'Registros', 'Conformes', 'Scrap', 'Disp.', 'Rend.', 'Calidad', 'OEE', 'Scrap %'],
      rows: byShift.map((s) => [
        s.shift.label,
        String(s.records),
        fmtQty(s.good),
        fmtQty(s.scrap),
        pct(s.availability),
        pct(s.performance),
        pct(s.quality),
        pct(s.oee),
        pct(s.scrapPct),
      ]),
      totals: [
        `OEE general: ${pct(overall.oee)} · Disponibilidad ${pct(overall.availability)} · Rendimiento ${pct(overall.performance)} · Calidad ${pct(overall.quality)}`,
        `Scrap: ${fmtQty(overall.scrap)} und (${pct(overall.scrapPct)}) · Cumplimiento: ${pct(overall.compliance)}`,
        `Rotación PT: ${ptTurnover.toFixed(2)} · Días de inventario PT: ${ptCoverageDays === null ? '—' : ptCoverageDays.toFixed(1)} · IRA: ${ira === null ? '—' : pct(ira)}`,
      ],
    });
  };

  return (
    <>
      <PageHeader
        title="Indicadores OEE e inventario"
        subtitle="Disponibilidad, rendimiento, calidad, scrap, rotación de PT y exactitud de registros"
        actions={
          <div className="row wrap" style={{ gap: 8 }}>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={{ width: 150 }} />
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={{ width: 150 }} />
            <Button variant="secondary" icon={<FileSpreadsheet size={15} />} onClick={exportExcelReport}>
              Excel
            </Button>
            <Button variant="primary" icon={<FileText size={15} />} onClick={exportPdfReport}>
              PDF
            </Button>
          </div>
        }
      />

      <div className="kpi-grid">
        <StatCard
          label="OEE del periodo"
          value={pct(overall.oee)}
          icon={<Gauge size={18} />}
          tone={overall.oee >= 70 ? 'ok' : overall.oee >= 50 ? 'warn' : 'danger'}
          foot={<span>A {pct(overall.availability)} · R {pct(overall.performance)} · C {pct(overall.quality)}</span>}
        />
        <StatCard
          label="Índice de scrap"
          value={pct(overall.scrapPct)}
          icon={<AlertTriangle size={18} />}
          tone={overall.scrapPct <= 3 ? 'ok' : overall.scrapPct <= 6 ? 'warn' : 'danger'}
          foot={<span>{fmtQty(overall.scrap)} und de {fmtQty(overall.produced)} producidas</span>}
        />
        <StatCard
          label="Rotación PT"
          value={`${ptTurnover.toFixed(2)}x`}
          icon={<RotateCcw size={18} />}
          tone="brand"
          foot={<span>{money(ptValue)} en inventario terminado</span>}
        />
        <StatCard
          label="Días de inventario PT"
          value={ptCoverageDays === null ? '—' : ptCoverageDays.toFixed(1)}
          icon={<Package size={18} />}
          tone={ptCoverageDays !== null && ptCoverageDays > 45 ? 'warn' : 'info'}
          foot={<span>cobertura según salidas del periodo</span>}
        />
      </div>

      <div className="kpi-grid">
        <StatCard
          label="Cumplimiento del programa"
          value={pct(overall.compliance)}
          icon={<Factory size={18} />}
          tone={overall.compliance >= 95 ? 'ok' : overall.compliance >= 80 ? 'warn' : 'danger'}
          foot={<span>{fmtQty(overall.good)} de {fmtQty(overall.planned)} programadas</span>}
        />
        <StatCard
          label="Exactitud de inventario (IRA)"
          value={ira === null ? '—' : pct(ira)}
          icon={<ShieldCheck size={18} />}
          tone={ira === null ? 'muted' : ira >= 98 ? 'ok' : ira >= 95 ? 'warn' : 'danger'}
          foot={<span>{lastCount ? `conteo ${lastCount.code} · ${dateTime(lastCount.closedAt ?? lastCount.createdAt)}` : 'sin conteo cerrado'}</span>}
        />
        <StatCard
          label="Registros de producción"
          value={overall.records}
          icon={<BarChart3 size={18} />}
          tone="info"
          foot={<span>{byMachine.length} máquinas con actividad</span>}
        />
        <StatCard
          label="Salidas de PT"
          value={money(ptExitsValue)}
          icon={<Download size={18} />}
          tone="ok"
          foot={<span>{ptExits.length} movimiento(s) en el periodo</span>}
        />
      </div>

      <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1.2fr) minmax(280px, 1fr)' }}>
        <Card>
          <CardHead title="OEE por turno" subtitle="Cada turno aporta disponibilidad, rendimiento y calidad" icon={<Gauge size={18} color="var(--brand-3)" />} />
          <div className="card-pad">
            {shiftBars.length === 0 ? (
              <div className="loc-empty">Sin registros de producción en el periodo seleccionado.</div>
            ) : (
              <HBars rows={shiftBars} color="var(--brand-2)" formatValue={(n) => pct(n)} />
            )}
          </div>
        </Card>

        <Card>
          <CardHead title="Scrap por defecto" subtitle="PNC del periodo agrupados por tipo de defecto" icon={<AlertTriangle size={18} color="var(--brand-3)" />} />
          <div className="card-pad">
            {defectRows.length === 0 ? (
              <div className="loc-empty">Sin producto no conforme en el periodo.</div>
            ) : (
              <HBars rows={defectRows} color="var(--warn)" formatValue={(n) => `${fmtQty(n)} und`} />
            )}
          </div>
        </Card>
      </div>

      <Card>
        <CardHead title="OEE por máquina" subtitle="Mejores máquinas del periodo · cavidades y ciclo ideal del catálogo" icon={<Factory size={18} color="var(--brand-3)" />} />
        <div className="card-pad">
          {machineBars.length === 0 ? (
            <div className="loc-empty">Sin actividad de máquinas en el periodo.</div>
          ) : (
            <HBars rows={machineBars} color="var(--info)" formatValue={(n) => pct(n)} />
          )}
        </div>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Máquina</th>
                <th className="num">Registros</th>
                <th className="num">Conformes</th>
                <th className="num">Scrap</th>
                <th className="num">Disp.</th>
                <th className="num">Rend.</th>
                <th className="num">Calidad</th>
                <th className="num">OEE</th>
                <th className="num">Scrap %</th>
              </tr>
            </thead>
            <tbody>
              {byMachine.length === 0 ? (
                <EmptyRow colSpan={9} message="Sin producción registrada en el periodo." />
              ) : (
                byMachine.map((m) => (
                  <tr key={m.machine.id}>
                    <td>
                      <div className="cell-main">
                        <span className="name">{m.machine.name}</span>
                        <span className="sku">{m.machine.code}</span>
                      </div>
                    </td>
                    <td className="num">{m.records}</td>
                    <td className="num strong">{fmtQty(m.good)}</td>
                    <td className="num" style={{ color: m.scrap > 0 ? 'var(--danger)' : undefined }}>{fmtQty(m.scrap)}</td>
                    <td className="num">{pct(m.availability)}</td>
                    <td className="num">{pct(m.performance)}</td>
                    <td className="num">{pct(m.quality)}</td>
                    <td className="num">
                      <Badge tone={m.oee >= 70 ? 'ok' : m.oee >= 50 ? 'warn' : 'danger'}>{pct(m.oee)}</Badge>
                    </td>
                    <td className="num">{pct(m.scrapPct)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="table-foot">
          <span>
            <BarChart3 size={13} style={{ verticalAlign: -2, marginRight: 4 }} />
            OEE = Disponibilidad × Rendimiento × Calidad. Se pondera por minutos planificados de cada registro.
          </span>
        </div>
      </Card>

      <Card>
        <CardHead title="Detalle por turno" subtitle="Índice de scrap y cumplimiento del programa diario" icon={<Gauge size={18} color="var(--brand-3)" />} />
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Turno</th>
                <th>Horario</th>
                <th className="num">Registros</th>
                <th className="num">Programado</th>
                <th className="num">Conformes</th>
                <th className="num">Scrap</th>
                <th className="num">OEE</th>
                <th className="num">Scrap %</th>
                <th className="num">Cumplimiento</th>
              </tr>
            </thead>
            <tbody>
              {byShift.every((s) => s.records === 0) ? (
                <EmptyRow colSpan={9} message="Sin registros de turno en el periodo." />
              ) : (
                byShift.map((s) => (
                  <tr key={s.shift.value}>
                    <td className="strong">{s.shift.label}</td>
                    <td className="small muted">{s.shift.start}–{s.shift.end}</td>
                    <td className="num">{s.records}</td>
                    <td className="num">{fmtQty(s.planned)}</td>
                    <td className="num strong">{fmtQty(s.good)}</td>
                    <td className="num" style={{ color: s.scrap > 0 ? 'var(--danger)' : undefined }}>{fmtQty(s.scrap)}</td>
                    <td className="num">
                      <Badge tone={s.oee >= 70 ? 'ok' : s.oee >= 50 ? 'warn' : 'muted'}>{pct(s.oee)}</Badge>
                    </td>
                    <td className="num">{pct(s.scrapPct)}</td>
                    <td className="num">{pct(s.compliance)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        <CardHead
          title="Exactitud de registros de inventario"
          subtitle={lastCount ? `Último conteo cerrado ${lastCount.code} · ${lastCount.location}` : 'Sin conteos cerrados'}
          icon={<ShieldCheck size={18} color="var(--brand-3)" />}
          actions={lastCount ? <Badge tone={ira !== null && ira >= 98 ? 'ok' : 'warn'}>IRA {ira === null ? '—' : pct(ira)}</Badge> : undefined}
        />
        {lastCount ? (
          <>
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Producto</th>
                    <th className="num">Sistema</th>
                    <th className="num">Contado</th>
                    <th className="num">Diferencia</th>
                    <th className="num">Costo diferencia</th>
                  </tr>
                </thead>
                <tbody>
                  {discrepancies.length === 0 ? (
                    <EmptyRow colSpan={5} message="El último conteo no presenta diferencias: exactitud del 100%." />
                  ) : (
                    discrepancies.map((item) => (
                      <tr key={item.productId}>
                        <td>
                          <div className="cell-main">
                            <span className="name">{item.name}</span>
                            <span className="sku">{item.sku}</span>
                          </div>
                        </td>
                        <td className="num">{fmtQty(item.systemQty)}</td>
                        <td className="num">{fmtQty(item.countedQty)}</td>
                        <td className="num" style={{ color: item.diff < 0 ? 'var(--danger)' : 'var(--warn)' }}>
                          {item.diff > 0 ? '+' : ''}{fmtQty(item.diff)}
                        </td>
                        <td className="num">{money(Math.abs(item.diff) * item.unitCost)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <div className="table-foot">
              <span>
                <ShieldCheck size={13} style={{ verticalAlign: -2, marginRight: 4 }} />
                IRA = 1 − (valor absoluto de diferencias / valor del inventario contado). Objetivo ≥ 98%.
              </span>
            </div>
          </>
        ) : (
          <div className="card-pad">
            <div className="loc-empty">Realice y cierre un conteo físico para calcular la exactitud de registros (IRA).</div>
          </div>
        )}
      </Card>
    </>
  );
}

import { useId } from 'react';
import type { DailyFlow, TypeSlice } from '../domain/reports';
import { moneyCompact } from '../domain/format';

/* ---------------------------------- Donut ---------------------------------- */

export function Donut({
  data,
  centerValue,
  centerLabel,
  size = 176,
  thickness = 20,
}: {
  data: { label: string; value: number; color: string }[];
  centerValue: string;
  centerLabel: string;
  size?: number;
  thickness?: number;
}) {
  const total = data.reduce((a, d) => a + d.value, 0);
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;
  let accumulated = 0;

  return (
    <div style={{ display: 'flex', justifyContent: 'center' }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--surface-3)"
          strokeWidth={thickness}
        />
        {total > 0 &&
          data.map((d, i) => {
            const fraction = d.value / total;
            const dash = fraction * circumference;
            const gap = circumference - dash;
            const offset = -accumulated * circumference;
            accumulated += fraction;
            return (
              <circle
                key={i}
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="none"
                stroke={d.color}
                strokeWidth={thickness}
                strokeDasharray={`${Math.max(dash - 1.5, 0)} ${gap + 1.5}`}
                strokeDashoffset={offset}
                strokeLinecap="butt"
                transform={`rotate(-90 ${size / 2} ${size / 2})`}
                style={{ transition: 'stroke-dasharray .6s ease' }}
              />
            );
          })}
        <text
          x="50%"
          y="47%"
          textAnchor="middle"
          dominantBaseline="middle"
          style={{ fontSize: size * 0.115, fontWeight: 700, fill: 'var(--ink)', letterSpacing: '-0.02em' }}
        >
          {centerValue}
        </text>
        <text
          x="50%"
          y="59%"
          textAnchor="middle"
          dominantBaseline="middle"
          style={{ fontSize: size * 0.058, fill: 'var(--muted)', fontWeight: 500 }}
        >
          {centerLabel}
        </text>
      </svg>
    </div>
  );
}

export function DonutLegend({ data }: { data: TypeSlice[] }) {
  return (
    <div className="chart-legend">
      {data.map((d) => (
        <div className="legend-item" key={d.type}>
          <span className="legend-swatch" style={{ background: d.color }} />
          <span>{d.label}</span>
          <strong style={{ color: 'var(--ink-2)' }}>{moneyCompact(d.value)}</strong>
          <span className="faint">{d.share}%</span>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------- Barras de flujo ---------------------------- */

export function FlowBars({ data }: { data: DailyFlow[] }) {
  const max = Math.max(1, ...data.map((d) => Math.max(d.inValue, d.outValue)));
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, height: 150, padding: '0 2px' }}>
        {data.map((d) => (
          <div key={d.date} style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6, height: '100%' }}>
            <div style={{ flex: 1, display: 'flex', alignItems: 'flex-end', gap: 3 }}>
              <div
                title={`Entradas: ${moneyCompact(d.inValue)}`}
                style={{
                  flex: 1,
                  height: `${Math.max((d.inValue / max) * 100, 2)}%`,
                  background: 'linear-gradient(180deg, #2dd4bf, #0f766e)',
                  borderRadius: '4px 4px 2px 2px',
                  transition: 'height .5s ease',
                  minHeight: 3,
                }}
              />
              <div
                title={`Salidas: ${moneyCompact(d.outValue)}`}
                style={{
                  flex: 1,
                  height: `${Math.max((d.outValue / max) * 100, 2)}%`,
                  background: 'linear-gradient(180deg, #fbbf24, #d97706)',
                  borderRadius: '4px 4px 2px 2px',
                  transition: 'height .5s ease',
                  minHeight: 3,
                }}
              />
            </div>
            <div style={{ textAlign: 'center', fontSize: 10, color: 'var(--faint)', fontWeight: 600 }}>
              {d.label}
            </div>
          </div>
        ))}
      </div>
      <div className="chart-legend">
        <div className="legend-item">
          <span className="legend-swatch" style={{ background: '#0f766e' }} /> Entradas
        </div>
        <div className="legend-item">
          <span className="legend-swatch" style={{ background: '#d97706' }} /> Salidas
        </div>
      </div>
    </div>
  );
}

/* ------------------------------ Barras horizontales -------------------------- */

export function HBars({
  rows,
  color = 'var(--brand-2)',
  formatValue,
}: {
  rows: { label: string; value: number; extra?: string }[];
  color?: string;
  formatValue?: (n: number) => string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div style={{ display: 'grid', gap: 13 }}>
      {rows.map((r) => (
        <div className="bar-row" key={r.label}>
          <span style={{ color: 'var(--ink-2)', fontWeight: 550 }}>{r.label}</span>
          <span className="bold" style={{ fontVariantNumeric: 'tabular-nums' }}>
            {formatValue ? formatValue(r.value) : moneyCompact(r.value)}
          </span>
          <div className="bar-track">
            <div
              className="bar-fill"
              style={{ width: `${(r.value / max) * 100}%`, background: color }}
            />
          </div>
          {r.extra && (
            <span className="faint" style={{ gridColumn: '1 / -1', fontSize: 10.5, marginTop: -2 }}>
              {r.extra}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

/* --------------------------------- Sparkline -------------------------------- */

export function Sparkline({ values, color = 'var(--brand-2)' }: { values: number[]; color?: string }) {
  const gid = useId().replace(/:/g, '');
  const max = Math.max(1, ...values);
  const min = Math.min(...values, 0);
  const span = max - min || 1;
  const points = values
    .map((v, i) => {
      const x = (i / Math.max(values.length - 1, 1)) * 100;
      const y = 30 - ((v - min) / span) * 28;
      return `${x},${y}`;
    })
    .join(' ');

  return (
    <svg viewBox="0 0 100 32" preserveAspectRatio="none" style={{ width: '100%', height: 34 }}>
      <defs>
        <linearGradient id={`g${gid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.28" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={`0,32 ${points} 100,32`} fill={`url(#g${gid})`} />
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}

/* ----------------------------------- Gauge ---------------------------------- */

export function Gauge({
  value,
  label,
  suffix = '%',
  color = 'var(--brand-2)',
}: {
  value: number;
  label: string;
  suffix?: string;
  color?: string;
}) {
  const clamped = Math.min(100, Math.max(0, value));
  const radius = 40;
  const circumference = Math.PI * radius;
  const dash = (clamped / 100) * circumference;

  return (
    <div style={{ textAlign: 'center' }}>
      <svg viewBox="0 0 100 58" style={{ width: '100%', maxWidth: 150 }}>
        <path
          d={`M 10 50 A ${radius} ${radius} 0 0 1 90 50`}
          fill="none"
          stroke="var(--surface-3)"
          strokeWidth="9"
          strokeLinecap="round"
        />
        <path
          d={`M 10 50 A ${radius} ${radius} 0 0 1 90 50`}
          fill="none"
          stroke={color}
          strokeWidth="9"
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circumference}`}
          style={{ transition: 'stroke-dasharray .7s ease' }}
        />
        <text x="50" y="45" textAnchor="middle" style={{ fontSize: 16, fontWeight: 700, fill: 'var(--ink)' }}>
          {value.toFixed(1).replace('.', ',')}
          {suffix}
        </text>
      </svg>
      <div className="small muted" style={{ marginTop: 2 }}>
        {label}
      </div>
    </div>
  );
}

// Formato de números, moneda COP y fechas — es-CO

const cop = new Intl.NumberFormat('es-CO', {
  style: 'currency',
  currency: 'COP',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const copDetailed = new Intl.NumberFormat('es-CO', {
  style: 'currency',
  currency: 'COP',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const num = new Intl.NumberFormat('es-CO', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

const compact = new Intl.NumberFormat('es-CO', {
  notation: 'compact',
  maximumFractionDigits: 1,
});

export const money = (n: number) => cop.format(Number.isFinite(n) ? n : 0);
export const money2 = (n: number) => copDetailed.format(Number.isFinite(n) ? n : 0);
export const moneyCompact = (n: number) => '$' + compact.format(Number.isFinite(n) ? n : 0);
export const qty = (n: number) => num.format(Number.isFinite(n) ? n : 0);

export const pct = (n: number, digits = 1) =>
  `${(Number.isFinite(n) ? n : 0).toFixed(digits).replace('.', ',')}%`;

export const dateShort = (iso: string) =>
  new Date(iso).toLocaleDateString('es-CO', { day: '2-digit', month: 'short' });

export const dateLong = (iso: string) =>
  new Date(iso).toLocaleDateString('es-CO', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });

export const dateTime = (iso: string) =>
  new Date(iso).toLocaleString('es-CO', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

export const timeShort = (iso: string) =>
  new Date(iso).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });

export const todayISO = () => new Date().toISOString();

export const inputDate = (iso: string) => iso.slice(0, 10);

export const relativeTime = (iso: string) => {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.round(diff / 60000);
  if (min < 1) return 'ahora';
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.round(h / 24);
  if (d === 1) return 'ayer';
  if (d < 30) return `hace ${d} días`;
  return dateShort(iso);
};

export const daysBetween = (a: string | Date, b: string | Date) =>
  Math.abs(new Date(a).getTime() - new Date(b).getTime()) / 86400000;

export const initials = (name: string) =>
  name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('');

export const uid = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;

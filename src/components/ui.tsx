import { createPortal } from 'react-dom';
import { cloneElement, isValidElement, useEffect, useId, useRef, useState } from 'react';
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { AlertTriangle, CheckCircle2, Info, Search, X, XCircle } from 'lucide-react';
import { useApp } from '../context/AppContext';

export const cx = (...parts: (string | false | null | undefined)[]) =>
  parts.filter(Boolean).join(' ');

/* ---------------------------------- Botones --------------------------------- */

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: 'sm' | 'md' | 'lg';
  block?: boolean;
  icon?: ReactNode;
}

export function Button({
  variant = 'secondary',
  size = 'md',
  block,
  icon,
  className,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      className={cx('btn', `btn-${variant}`, size !== 'md' && `btn-${size}`, block && 'btn-block', className)}
      {...rest}
    >
      {icon}
      {children}
    </button>
  );
}

export function IconButton({
  label,
  children,
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button className={cx('icon-btn', className)} aria-label={label} title={label} {...rest}>
      {children}
    </button>
  );
}

/* ---------------------------------- Tarjetas -------------------------------- */

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('card', className)}>{children}</div>;
}

export function CardHead({
  title,
  subtitle,
  actions,
  icon,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="card-head">
      {icon}
      <div>
        <h3>{title}</h3>
        {subtitle && <div className="sub">{subtitle}</div>}
      </div>
      {actions && <div className="card-head-actions">{actions}</div>}
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
  back,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  back?: ReactNode;
}) {
  return (
    <div className="page-head">
      {back}
      <div>
        <h1>{title}</h1>
        {subtitle && <div className="sub">{subtitle}</div>}
      </div>
      {actions && <div className="page-head-actions">{actions}</div>}
    </div>
  );
}

/* ----------------------------------- Stats ---------------------------------- */

export function StatCard({
  label,
  value,
  icon,
  tone = 'brand',
  foot,
  delta,
}: {
  label: string;
  value: ReactNode;
  icon: ReactNode;
  tone?: 'brand' | 'ok' | 'warn' | 'danger' | 'info' | 'muted';
  foot?: ReactNode;
  delta?: { value: string; up: boolean };
}) {
  return (
    <div className="stat">
      <div className="stat-top">
        <div>
          <div className="stat-label">{label}</div>
          <div className="stat-value">{value}</div>
        </div>
        <div className={cx('stat-icon', `tone-${tone}`)}>{icon}</div>
      </div>
      {(foot || delta) && (
        <div className="stat-foot">
          {delta && <span className={cx('delta', delta.up ? 'up' : 'down')}>{delta.value}</span>}
          {foot}
        </div>
      )}
    </div>
  );
}

/* ---------------------------------- Badges ---------------------------------- */

export function Badge({
  children,
  tone = 'muted',
  dot,
}: {
  children: ReactNode;
  tone?: 'ok' | 'warn' | 'danger' | 'info' | 'muted' | 'brand';
  dot?: boolean;
}) {
  return (
    <span className={cx('badge', `badge-${tone}`)}>
      {dot && <span className="badge-dot" />}
      {children}
    </span>
  );
}

export function ProductStatusBadge({ stock, minStock }: { stock: number; minStock: number }) {
  if (stock <= 0) return <Badge tone="danger" dot>Agotado</Badge>;
  if (stock <= minStock) return <Badge tone="warn" dot>Bajo mínimo</Badge>;
  return <Badge tone="ok" dot>Disponible</Badge>;
}

/* ---------------------------------- Campos ---------------------------------- */

export function Field({
  label,
  hint,
  error,
  children,
  className,
}: {
  label?: string;
  hint?: string;
  error?: string;
  children: ReactNode;
  className?: string;
}) {
  const id = useId();
  const control = isValidElement<{ id?: string; 'aria-label'?: string }>(children)
    ? cloneElement(children, {
        id: children.props.id ?? id,
        'aria-label': children.props['aria-label'] ?? label,
      })
    : children;

  return (
    <div className={cx('field', className)}>
      {label && <label htmlFor={id}>{label}</label>}
      {control}
      {error ? <span className="err">{error}</span> : hint ? <span className="hint">{hint}</span> : null}
    </div>
  );
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cx('input', props.className)} {...props} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cx('select', props.className)} {...props} />;
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cx('textarea', props.className)} {...props} />;
}

export function SearchInput({
  value,
  onChange,
  placeholder = 'Buscar…',
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
}) {
  return (
    <div className={cx('search-input', className)}>
      <Search size={15} />
      <input
        className="input"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

export function Tabs({
  tabs,
  active,
  onChange,
}: {
  tabs: { id: string; label: string; count?: number }[];
  active: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="tabs">
      {tabs.map((t) => (
        <button
          key={t.id}
          className={cx(active === t.id && 'active')}
          onClick={() => onChange(t.id)}
          type="button"
        >
          {t.label}
          {typeof t.count === 'number' && <span className="faint"> · {t.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Progress({ value, color }: { value: number; color?: string }) {
  return (
    <div className="progress">
      <div style={{ width: `${Math.min(100, Math.max(0, value))}%`, background: color }} />
    </div>
  );
}

/* ---------------------------------- Vacíos ---------------------------------- */

export function EmptyState({
  icon,
  title,
  message,
  action,
}: {
  icon: ReactNode;
  title: string;
  message?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">{icon}</div>
      <h4>{title}</h4>
      {message && <p>{message}</p>}
      {action}
    </div>
  );
}

export function EmptyRow({
  colSpan,
  message = 'Sin registros para mostrar.',
}: {
  colSpan: number;
  message?: string;
}) {
  return (
    <tr>
      <td
        colSpan={colSpan}
        style={{
          padding: '34px 16px',
          textAlign: 'center',
          color: 'var(--muted)',
          fontSize: 12.5,
          fontWeight: 500,
        }}
      >
        {message}
      </td>
    </tr>
  );
}

export function Loading({ rows = 3 }: { rows?: number }) {
  return (
    <div style={{ display: 'grid', gap: 10, padding: 18 }}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="skeleton" style={{ height: 44, opacity: 1 - i * 0.12 }} />
      ))}
    </div>
  );
}

/* ---------------------------------- Modal ----------------------------------- */

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  size,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'lg';
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={cx('modal', size === 'lg' && 'modal-lg')} ref={ref} role="dialog" aria-modal="true">
        <div className="modal-head">
          <div>
            <h3>{title}</h3>
            {subtitle && <div className="sub">{subtitle}</div>}
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Cerrar">
            <X size={18} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirmar',
  tone = 'primary',
  withReason,
  reasonLabel = 'Motivo',
  busy,
  onConfirm,
  onCancel,
  children,
}: {
  open: boolean;
  title: string;
  message?: string;
  confirmLabel?: string;
  tone?: 'primary' | 'danger';
  withReason?: boolean;
  reasonLabel?: string;
  busy?: boolean;
  onConfirm: (reason: string) => void;
  onCancel: () => void;
  children?: ReactNode;
}) {
  const [reason, setReason] = useState('');
  useEffect(() => {
    if (open) setReason('');
  }, [open]);

  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      footer={
        <>
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            Cancelar
          </Button>
          <Button
            variant={tone === 'danger' ? 'danger' : 'primary'}
            onClick={() => onConfirm(reason)}
            disabled={busy || (withReason && reason.trim().length < 4)}
          >
            {busy ? <span className="spinner" /> : null}
            {confirmLabel}
          </Button>
        </>
      }
    >
      {message && <p style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.6 }}>{message}</p>}
      {children}
      {withReason && (
        <Field label={reasonLabel} hint="Mínimo 4 caracteres. Queda registrado en auditoría.">
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Describa el motivo…"
          />
        </Field>
      )}
    </Modal>
  );
}

/* ---------------------------------- Toasts ---------------------------------- */

export function Toaster() {
  const { toasts, dismissToast } = useApp();
  const icons = {
    success: <CheckCircle2 size={17} color="var(--ok)" />,
    error: <XCircle size={17} color="var(--danger)" />,
    warn: <AlertTriangle size={17} color="var(--warn)" />,
    info: <Info size={17} color="var(--info)" />,
  };
  return (
    <div className="toast-stack">
      {toasts.map((t) => (
        <div key={t.id} className={cx('toast', t.kind)} onClick={() => dismissToast(t.id)}>
          {icons[t.kind]}
          <div>
            <strong>{t.title}</strong>
            {t.message && <span className="small muted">{t.message}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <div className="form-section-title">{children}</div>;
}

export function Money({ value, strong }: { value: number; strong?: boolean }) {
  return (
    <span className={strong ? 'bold ink' : undefined} style={{ fontVariantNumeric: 'tabular-nums' }}>
      {new Intl.NumberFormat('es-CO', {
        style: 'currency',
        currency: 'COP',
        maximumFractionDigits: 0,
      }).format(value)}
    </span>
  );
}

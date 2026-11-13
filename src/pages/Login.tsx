import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import {
  ArrowRight,
  Boxes,
  CheckCircle2,
  Eye,
  EyeOff,
  Layers,
  Lock,
  Mail,
  ShieldCheck,
  TrendingUp,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { db } from '../db/schema';
import { uid } from '../domain/format';
import { Button, Field, Input, Modal } from '../components/ui';

export function Login() {
  const { user, login, toast } = useApp();
  const [email, setEmail] = useState('');
  const [pin, setPin] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recoverOpen, setRecoverOpen] = useState(false);
  const [recoverEmail, setRecoverEmail] = useState('');
  const [recoverDone, setRecoverDone] = useState(false);

  if (user) return <Navigate to="/" replace />;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email, pin);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No fue posible iniciar sesión.');
    } finally {
      setBusy(false);
    }
  };

  const requestReset = async () => {
    if (!recoverEmail.trim()) return;
    await db.audit.add({
      id: uid(),
      entity: 'session',
      entityId: recoverEmail.trim().toLowerCase(),
      action: 'actualizar',
      summary: `Solicitud de recuperación de acceso para ${recoverEmail.trim()}`,
      userId: 'anon',
      userName: recoverEmail.trim(),
      at: new Date().toISOString(),
    });
    setRecoverDone(true);
    toast('Solicitud registrada', 'info', 'Un administrador validará su identidad y restablecerá el acceso.');
  };

  return (
    <div className="login-wrap">
      <section className="login-art">
        <div className="row" style={{ gap: 12 }}>
          <div className="brand-mark">
            <Boxes size={22} />
          </div>
          <div>
            <div className="brand-name">INVENTRA</div>
            <div className="brand-sub">Gestión integral de inventarios</div>
          </div>
        </div>

        <div className="login-hero">
          <h2>
            Todo su inventario,
            <br />
            bajo control.
          </h2>
          <p>
            Control en tiempo real de existencias, movimientos y producción. Trazabilidad por lote,
            costos actualizados y decisiones con datos confiables.
          </p>

          <div className="login-features">
            <div className="login-feature">
              <CheckCircle2 size={16} />
              <span>Kardex y trazabilidad completa de cada movimiento</span>
            </div>
            <div className="login-feature">
              <Layers size={16} />
              <span>Listas de materiales con costeo teórico y validación de faltantes</span>
            </div>
            <div className="login-feature">
              <TrendingUp size={16} />
              <span>Indicadores de rotación, cobertura y exactitud del inventario</span>
            </div>
            <div className="login-feature">
              <ShieldCheck size={16} />
              <span>Perfiles de acceso, auditoría y reversión autorizada</span>
            </div>
          </div>
        </div>

        <div className="login-legal">
          © 2026 INVENTRA · Datos almacenados localmente en el dispositivo
        </div>
      </section>

      <section className="login-panel">
        <div className="login-card">
          <h1>Iniciar sesión</h1>
          <p className="lead">Ingrese con las credenciales asignadas por el administrador.</p>

          <form onSubmit={submit} style={{ display: 'grid', gap: 14 }}>
            <Field label="Correo electrónico">
              <div style={{ position: 'relative' }}>
                <Mail
                  size={15}
                  style={{ position: 'absolute', left: 12, top: 13, color: 'var(--faint)' }}
                />
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="usuario@empresa.co"
                  aria-label="Correo electrónico"
                  style={{ paddingLeft: 36 }}
                  autoComplete="username"
                  required
                />
              </div>
            </Field>

            <Field label="Contraseña">
              <div style={{ position: 'relative' }}>
                <Lock
                  size={15}
                  style={{ position: 'absolute', left: 12, top: 13, color: 'var(--faint)' }}
                />
                <Input
                  type={show ? 'text' : 'password'}
                  value={pin}
                  onChange={(e) => setPin(e.target.value)}
                  placeholder="••••••••"
                  aria-label="Contraseña"
                  style={{ paddingLeft: 36, paddingRight: 40 }}
                  autoComplete="current-password"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShow((s) => !s)}
                  aria-label="Mostrar contraseña"
                  style={{
                    position: 'absolute',
                    right: 8,
                    top: 6,
                    border: 'none',
                    background: 'none',
                    color: 'var(--faint)',
                    cursor: 'pointer',
                    padding: 6,
                  }}
                >
                  {show ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </Field>

            {error && (
              <div
                style={{
                  background: 'var(--danger-soft)',
                  color: 'var(--danger)',
                  padding: '10px 12px',
                  borderRadius: 9,
                  fontSize: 12,
                  fontWeight: 550,
                }}
              >
                {error}
              </div>
            )}

            <Button type="submit" variant="primary" size="lg" block disabled={busy}>
              {busy ? <span className="spinner" /> : null}
              {busy ? 'Validando…' : 'Ingresar'}
              {!busy && <ArrowRight size={16} />}
            </Button>

            <button
              type="button"
              className="btn btn-ghost btn-sm"
              style={{ justifySelf: 'center' }}
              onClick={() => {
                setRecoverEmail(email);
                setRecoverDone(false);
                setRecoverOpen(true);
              }}
            >
              ¿Olvidó su contraseña?
            </button>
          </form>
        </div>
      </section>

      <Modal
        open={recoverOpen}
        onClose={() => setRecoverOpen(false)}
        title="Recuperar acceso"
        subtitle="Solicitud de restablecimiento de contraseña"
        footer={
          <>
            <Button variant="ghost" onClick={() => setRecoverOpen(false)}>
              Cerrar
            </Button>
            {!recoverDone && (
              <Button variant="primary" onClick={requestReset}>
                Enviar solicitud
              </Button>
            )}
          </>
        }
      >
        {recoverDone ? (
          <div className="row" style={{ gap: 10, color: 'var(--ok)' }}>
            <CheckCircle2 size={18} />
            <span className="small">
              Solicitud registrada. El administrador verificará su identidad y restablecerá el acceso.
            </span>
          </div>
        ) : (
          <>
            <p className="small muted" style={{ lineHeight: 1.6 }}>
              Por seguridad, el restablecimiento lo realiza un administrador desde el módulo de
              usuarios. La solicitud quedará registrada en la auditoría del sistema.
            </p>
            <Field label="Correo registrado">
              <Input
                type="email"
                value={recoverEmail}
                onChange={(e) => setRecoverEmail(e.target.value)}
                placeholder="usuario@empresa.co"
              />
            </Field>
          </>
        )}
      </Modal>
    </div>
  );
}

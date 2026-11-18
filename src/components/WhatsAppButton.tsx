import { useState } from 'react';
import { useApp } from '../context/AppContext';
import { db } from '../db/schema';
import { uid } from '../domain/format';
import { can } from '../domain/permissions';
import { isValidWhatsApp, whatsappLink } from '../domain/whatsapp';
import { Button, Field, Input, Modal } from './ui';

/** Glifo de WhatsApp (relleno, para el botón flotante). */
export function WhatsAppIcon({ size = 27 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="currentColor" aria-hidden="true" focusable="false">
      <path d="M16.04 4C9.42 4 4.05 9.37 4.05 15.99c0 2.11.55 4.17 1.6 5.99L4 28l6.16-1.61a11.94 11.94 0 0 0 5.88 1.53h.01c6.62 0 11.99-5.37 11.99-11.99S22.66 4 16.04 4zm0 21.9h-.01a9.9 9.9 0 0 1-5.05-1.38l-.36-.21-3.65.96.97-3.56-.23-.37a9.87 9.87 0 0 1-1.51-5.27c0-5.46 4.44-9.9 9.9-9.9 2.64 0 5.13 1.03 7 2.9a9.84 9.84 0 0 1 2.9 7c0 5.46-4.44 9.9-9.9 9.9zm5.43-7.41c-.3-.15-1.76-.87-2.03-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.17-.17.2-.35.22-.65.07-.3-.15-1.26-.46-2.4-1.48-.89-.79-1.49-1.77-1.66-2.07-.17-.3-.02-.46.13-.61.13-.13.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.07-.15-.67-1.61-.92-2.21-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.79.37-.27.3-1.04 1.02-1.04 2.48s1.06 2.88 1.21 3.08c.15.2 2.09 3.2 5.07 4.49.71.31 1.26.49 1.69.62.71.23 1.36.2 1.87.12.57-.08 1.76-.72 2.01-1.41.25-.69.25-1.29.17-1.41-.07-.13-.27-.2-.57-.35z" />
    </svg>
  );
}

/**
 * Botón flotante de WhatsApp.
 *
 * Si ya hay un número configurado abre el chat con un mensaje precargado. Si
 * no lo hay, el administrador puede registrarlo en el momento; el número queda
 * en la configuración de la empresa y se sincroniza con los demás equipos.
 */
export function WhatsAppButton() {
  const { user, settings, toast, reloadSettings } = useApp();
  const [setupOpen, setSetupOpen] = useState(false);
  const [number, setNumber] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const configured = isValidWhatsApp(settings?.whatsappNumber);

  const message = user
    ? `Hola, soy ${user.name}${settings?.companyName ? ` de ${settings.companyName}` : ''}. Le escribo desde Invencodi.`
    : `Hola, necesito ayuda con Invencodi${settings?.companyName ? ` — ${settings.companyName}` : ''}.`;

  const openWhatsApp = (value?: string | null) => {
    const link = whatsappLink(value, message);
    if (!link) return;
    const win = window.open(link, '_blank', 'noopener,noreferrer');
    if (!win) {
      toast(
        'Permita las ventanas emergentes',
        'warn',
        'El navegador bloqueó la apertura de WhatsApp. Habilite los emergentes para este sitio.',
      );
    }
  };

  const handleClick = () => {
    if (configured) {
      openWhatsApp(settings?.whatsappNumber);
      return;
    }
    if (user && can(user.role, 'settings.manage')) {
      setNumber(settings?.whatsappNumber ?? '');
      setError('');
      setSetupOpen(true);
      return;
    }
    toast(
      'WhatsApp sin configurar',
      'warn',
      'Solicite al administrador registrar el número de contacto en Configuración.',
    );
  };

  const save = async () => {
    if (!user || !settings) return;
    const value = number.trim();
    if (!isValidWhatsApp(value)) {
      setError('Escriba el número con indicativo de país (entre 10 y 15 dígitos).');
      return;
    }
    setBusy(true);
    try {
      const next = { ...settings, whatsappNumber: value };
      await db.settings.put(next);
      await db.audit.add({
        id: uid(),
        entity: 'settings',
        entityId: 'global',
        action: 'actualizar',
        summary: 'WhatsApp de contacto actualizado',
        before: settings,
        after: next,
        userId: user.id,
        userName: user.name,
        at: new Date().toISOString(),
      });
      await reloadSettings();
      setSetupOpen(false);
      toast('WhatsApp configurado', 'success', 'El botón abrirá el chat con ese número.');
      openWhatsApp(value);
    } catch (err) {
      toast(
        'No fue posible guardar',
        'error',
        err instanceof Error ? err.message : 'Intente nuevamente.',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        className="wa-fab"
        onClick={handleClick}
        aria-label="Abrir WhatsApp"
        title={configured ? 'Escríbanos por WhatsApp' : 'Configurar WhatsApp'}
      >
        <WhatsAppIcon />
      </button>

      <Modal
        open={setupOpen}
        onClose={() => setSetupOpen(false)}
        title="WhatsApp de contacto"
        subtitle="Número que abrirá el botón flotante"
        footer={
          <>
            <Button variant="ghost" onClick={() => setSetupOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={save} disabled={busy}>
              {busy ? 'Guardando…' : 'Guardar y abrir WhatsApp'}
            </Button>
          </>
        }
      >
        <Field
          label="Número con indicativo"
          error={error}
          hint="Ejemplo: +57 300 123 4567. Se guarda en la configuración y se comparte con los demás equipos."
        >
          <Input
            value={number}
            onChange={(e) => {
              setNumber(e.target.value);
              setError('');
            }}
            placeholder="+57 300 123 4567"
            inputMode="tel"
            autoComplete="tel"
            autoFocus
          />
        </Field>
      </Modal>
    </>
  );
}

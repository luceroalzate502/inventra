/**
 * Utilidades del canal de WhatsApp.
 *
 * El número se guarda tal como lo escribe el usuario (con espacios, guiones o
 * el signo +), pero el enlace `wa.me` exige solo dígitos e incluir el
 * indicativo del país.
 */

/** Deja únicamente los dígitos del número. */
export function whatsappDigits(value?: string | null): string {
  return (value ?? '').replace(/\D/g, '');
}

/** Un número utilizable por WhatsApp tiene entre 10 y 15 dígitos con indicativo. */
export function isValidWhatsApp(value?: string | null): boolean {
  const digits = whatsappDigits(value);
  return digits.length >= 10 && digits.length <= 15;
}

/**
 * Enlace que abre WhatsApp (aplicación en móvil, Web en escritorio) con el
 * chat del número indicado y un mensaje precargado opcional.
 */
export function whatsappLink(
  number: string | undefined | null,
  message?: string,
): string | null {
  const digits = whatsappDigits(number);
  if (!digits) return null;
  const text = message?.trim();
  return `https://wa.me/${digits}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
}

/** Presentación legible del número configurado. */
export function formatWhatsApp(value?: string | null): string {
  const raw = (value ?? '').trim();
  if (!raw) return '';
  return /^[\d\s]+$/.test(raw) ? `+${whatsappDigits(raw)}` : raw;
}

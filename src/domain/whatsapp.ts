/**
 * Utilidades del canal de WhatsApp.
 *
 * El número se guarda tal como lo escribe el usuario (con espacios, guiones o
 * el signo +), pero el enlace `wa.me` exige solo dígitos e incluir el
 * indicativo del país.
 */

/** Número de contacto de Invencodi. Se puede cambiar en Configuración. */
export const DEFAULT_WHATSAPP_NUMBER = '+57 3245408337';

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
 * Número efectivo del botón: el configurado en la empresa o, si no hay uno
 * válido, el número de contacto de fábrica.
 */
export function resolveWhatsAppNumber(
  settings?: { whatsappNumber?: string } | null,
): string {
  const configured = settings?.whatsappNumber?.trim();
  return configured && isValidWhatsApp(configured) ? configured : DEFAULT_WHATSAPP_NUMBER;
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

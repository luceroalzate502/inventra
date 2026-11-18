/**
 * Chat interno — utilidades compartidas.
 *
 * La sala es única para todos los roles. Cada equipo guarda localmente hasta
 * dónde leyó cada usuario (no se sincroniza: es una marca del dispositivo) y
 * los mensajes viajan por la nube como el resto de los datos.
 */

/** Evento que avisa a la interfaz que el usuario abrió/leyó el chat. */
export const CHAT_READ_EVENT = 'inventra:chat-read';

const markerKey = (userId: string) => `inventra.chat.lastRead.${userId}`;

/** Marca de lectura guardada en este equipo para el usuario indicado. */
export function readChatMarker(userId?: string | null): string | null {
  if (!userId) return null;
  try {
    return localStorage.getItem(markerKey(userId));
  } catch {
    return null;
  }
}

/** Guarda la marca de lectura y notifica a la barra de navegación. */
export function markChatRead(userId?: string | null, at?: string): void {
  if (!userId) return;
  const value = at ?? new Date().toISOString();
  try {
    localStorage.setItem(markerKey(userId), value);
    window.dispatchEvent(new CustomEvent(CHAT_READ_EVENT, { detail: { userId, at: value } }));
  } catch {
    /* almacenamiento no disponible: el chat sigue funcionando */
  }
}

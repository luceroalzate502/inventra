import type { Permission } from './permissions';
import { can } from './permissions';
import type { Role, SessionUser } from './types';
import { uid } from './format';

const SESSION_KEY = 'inventra.session';
const encoder = new TextEncoder();

const toHex = (buf: ArrayBuffer) =>
  Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

const fromHex = (hex: string) => {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
};

/** PBKDF2-SHA256, 120.000 iteraciones. */
export async function hashPin(pin: string, saltHex?: string): Promise<{ hash: string; salt: string }> {
  const salt = saltHex ?? toHex(crypto.getRandomValues(new Uint8Array(16)).buffer);
  const key = await crypto.subtle.importKey('raw', encoder.encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: fromHex(salt), iterations: 120000, hash: 'SHA-256' },
    key,
    256,
  );
  return { hash: toHex(bits), salt };
}

export async function verifyPin(pin: string, hash: string, salt: string): Promise<boolean> {
  const candidate = await hashPin(pin, salt);
  // comparación en tiempo constante
  if (candidate.hash.length !== hash.length) return false;
  let diff = 0;
  for (let i = 0; i < hash.length; i++) diff |= candidate.hash.charCodeAt(i) ^ hash.charCodeAt(i);
  return diff === 0;
}

export interface StoredSession {
  user: SessionUser;
  issuedAt: number;
  expiresAt: number;
}

export function saveSession(user: SessionUser, minutes: number): StoredSession {
  const now = Date.now();
  const session: StoredSession = { user, issuedAt: now, expiresAt: now + minutes * 60000 };
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  return session;
}

export function readSession(): StoredSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredSession;
    if (!parsed?.user?.id) return null;
    if (parsed.expiresAt < Date.now()) {
      localStorage.removeItem(SESSION_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function touchSession(minutes: number): void {
  const current = readSession();
  if (!current) return;
  current.expiresAt = Date.now() + minutes * 60000;
  localStorage.setItem(SESSION_KEY, JSON.stringify(current));
}

export function clearSession(): void {
  localStorage.removeItem(SESSION_KEY);
}

export function canDo(user: SessionUser | null, permission: Permission): boolean {
  if (!user) return false;
  return can(user.role as Role, permission);
}

export const newId = uid;

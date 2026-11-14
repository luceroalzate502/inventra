// Configuración local de la sincronización con Supabase.
//
// La URL y la llave anónima son públicas por diseño (viajan en el bundle),
// pero el acceso a los datos queda protegido por la cuenta de la nube que
// cada dispositivo inicia con Supabase Auth. La contraseña de esa cuenta
// nunca se guarda en este archivo: Supabase conserva la sesión renovable.

export interface CloudConfig {
  url: string;
  anonKey: string;
  email: string;
  autoSync: boolean;
  connectedAt: string;
}

const CONFIG_KEY = 'inventra.cloud.config';
const DEVICE_KEY = 'inventra.device.id';
const CURSOR_KEY = 'inventra.sync.cursor';
const LAST_SYNC_KEY = 'inventra.sync.last';
const RECONCILED_KEY = 'inventra.sync.reconciled.v3';

/** Limpia la URL y garantiza que termine sin barra final. */
export function normalizeCloudUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, '');
}

export function isValidCloudUrl(raw: string): boolean {
  try {
    const url = new URL(normalizeCloudUrl(raw));
    return url.protocol === 'https:' || url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  } catch {
    return false;
  }
}

export function getCloudConfig(): CloudConfig | null {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CloudConfig>;
    if (!parsed.url || !parsed.anonKey || !parsed.email) return null;
    return {
      url: normalizeCloudUrl(parsed.url),
      anonKey: parsed.anonKey,
      email: parsed.email,
      autoSync: parsed.autoSync !== false,
      connectedAt: parsed.connectedAt ?? new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

export function saveCloudConfig(config: CloudConfig): void {
  localStorage.setItem(
    CONFIG_KEY,
    JSON.stringify({
      ...config,
      url: normalizeCloudUrl(config.url),
      email: config.email.trim().toLowerCase(),
    }),
  );
}

export function patchCloudConfig(patch: Partial<CloudConfig>): void {
  const current = getCloudConfig();
  if (!current) return;
  saveCloudConfig({ ...current, ...patch });
}

export function clearCloudConfig(): void {
  localStorage.removeItem(CONFIG_KEY);
  localStorage.removeItem(CURSOR_KEY);
}

export function isCloudConfigured(): boolean {
  return getCloudConfig() !== null;
}

/** Identificador estable de este navegador/dispositivo. */
export function deviceId(): string {
  let id = localStorage.getItem(DEVICE_KEY);
  if (!id) {
    id =
      typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `dev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem(DEVICE_KEY, id);
  }
  return id;
}

/**
 * Sufijo corto para los consecutivos cuando hay nube. Evita que dos equipos
 * que trabajan sin conexión generen el mismo código legible.
 */
export function deviceSuffix(): string {
  const clean = deviceId().replace(/[^a-z0-9]/gi, '').toUpperCase();
  return clean.slice(-4).padStart(4, '0');
}

export function getSyncCursor(): string | null {
  return localStorage.getItem(CURSOR_KEY);
}

export function setSyncCursor(value: string): void {
  localStorage.setItem(CURSOR_KEY, value);
}

export function getLastSyncAt(): string | null {
  return localStorage.getItem(LAST_SYNC_KEY);
}

export function setLastSyncAt(value: string): void {
  localStorage.setItem(LAST_SYNC_KEY, value);
}

export function wasReconciled(): boolean {
  return localStorage.getItem(RECONCILED_KEY) === '1';
}

export function markReconciled(): void {
  localStorage.setItem(RECONCILED_KEY, '1');
}

export function clearReconciledFlag(): void {
  localStorage.removeItem(RECONCILED_KEY);
}

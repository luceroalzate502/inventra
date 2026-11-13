import { db } from './schema';
import { hashPin } from '../domain/auth';
import { uid } from '../domain/format';
import type { Settings, User } from '../domain/types';

/* ------------------------------------------------------------------ */
/* Seed base                                                           */
/*                                                                     */
/* La aplicación arranca sin datos operativos (productos, movimientos, */
/* BOM, producción, conteos ni auditoría). Solo se crean la           */
/* configuración inicial y las cuentas de acceso necesarias para      */
/* ingresar y administrar el sistema.                                  */
/* ------------------------------------------------------------------ */

const SEED_VERSION = 2;

const ADMIN_NAME = 'Lucero Alzate';
const ADMIN_EMAIL = 'lucero.alzate502@asys.edu.co';
const ADMIN_PIN = '1001415502';

/**
 * Actualiza la cuenta administradora existente a la titular solicitada.
 * Se ejecuta una sola vez por base de datos para no sobrescribir cambios
 * posteriores hechos desde el módulo de usuarios.
 */
async function ensureAdminAccount(): Promise<void> {
  const migrated = await db.counters.get('ADMIN_LUCERO');
  if (migrated?.value === 2) return;

  const { hash, salt } = await hashPin(ADMIN_PIN);
  const current = await db.users.where('role').equals('admin').first();

  if (current) {
    await db.users.update(current.id, {
      name: ADMIN_NAME,
      email: ADMIN_EMAIL,
      pinHash: hash,
      salt,
      active: true,
      failedAttempts: 0,
      lockedUntil: null,
      phone: '',
    });
  } else {
    await db.users.add({
      id: uid(),
      name: ADMIN_NAME,
      email: ADMIN_EMAIL,
      role: 'admin',
      pinHash: hash,
      salt,
      active: true,
      failedAttempts: 0,
      lockedUntil: null,
      createdAt: new Date().toISOString(),
      lastLoginAt: null,
      phone: '',
    });
  }

  await db.counters.put({ prefix: 'ADMIN_LUCERO', value: 2 });
}

export async function seedIfEmpty(): Promise<boolean> {
  const existing = await db.users.count();
  const seeded = await db.counters.get('SEED');
  if (existing > 0 && seeded?.value === SEED_VERSION) {
    await ensureAdminAccount();
    return false;
  }

  // Si existe una base anterior (por ejemplo, con datos de demostración),
  // se limpia para dejar el sistema en blanco y consistente.
  if (existing > 0) {
    await db.transaction('rw', db.tables, async () => {
      for (const table of db.tables) await table.clear();
    });
  }

  /* --- Configuración inicial --- */
  const settings: Settings = {
    key: 'global',
    companyName: 'Mi empresa',
    nit: '000.000.000-0',
    currency: 'COP',
    allowNegativeStock: false,
    sessionMinutes: 60,
    lowStockAlert: true,
    decimals: 2,
    warehouseManager: 'Administrador',
  };
  await db.settings.put(settings);

  /* --- Cuentas de acceso --- */
  const demoUsers: { name: string; email: string; role: User['role']; pin: string; phone: string }[] = [
    { name: ADMIN_NAME, email: ADMIN_EMAIL, role: 'admin', pin: ADMIN_PIN, phone: '' },
    { name: 'Carlos Ruiz', email: 'jefe@inventra.co', role: 'jefe', pin: 'jefe123', phone: '+57 310 555 0102' },
    { name: 'Marta Díaz', email: 'almacen@inventra.co', role: 'almacenista', pin: 'almacen123', phone: '+57 310 555 0103' },
    { name: 'Julián Pérez', email: 'produccion@inventra.co', role: 'produccion', pin: 'produccion123', phone: '+57 310 555 0104' },
    { name: 'Laura Sánchez', email: 'consulta@inventra.co', role: 'consulta', pin: 'consulta123', phone: '+57 310 555 0105' },
  ];

  const now = new Date().toISOString();
  const users: User[] = [];
  for (const u of demoUsers) {
    const { hash, salt } = await hashPin(u.pin);
    users.push({
      id: uid(),
      name: u.name,
      email: u.email,
      role: u.role,
      pinHash: hash,
      salt,
      active: true,
      failedAttempts: 0,
      lockedUntil: null,
      createdAt: now,
      lastLoginAt: null,
      phone: u.phone,
    });
  }
  await db.users.bulkAdd(users);

  await db.counters.put({ prefix: 'SEED', value: SEED_VERSION });
  await db.counters.put({ prefix: 'ADMIN_LUCERO', value: 2 });

  return true;
}

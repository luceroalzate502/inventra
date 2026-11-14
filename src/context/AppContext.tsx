import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { db } from '../db/schema';
import { clearSession, readSession, saveSession, touchSession, verifyPin } from '../domain/auth';
import { uid } from '../domain/format';
import type { SessionUser, Settings } from '../domain/types';

export type ToastKind = 'success' | 'error' | 'warn' | 'info';

export interface ToastItem {
  id: string;
  kind: ToastKind;
  title: string;
  message?: string;
}

interface AppContextValue {
  user: SessionUser | null;
  settings: Settings | null;
  ready: boolean;
  online: boolean;
  theme: 'light' | 'dark';
  login: (email: string, pin: string) => Promise<void>;
  logout: () => void;
  toast: (title: string, kind?: ToastKind, message?: string) => void;
  toasts: ToastItem[];
  dismissToast: (id: string) => void;
  toggleTheme: () => void;
  reloadSettings: () => Promise<void>;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [ready, setReady] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [theme, setTheme] = useState<'light' | 'dark'>(
    (localStorage.getItem('inventra.theme') as 'light' | 'dark') ?? 'light',
  );
  const timers = useRef<number[]>([]);

  const toast = useCallback((title: string, kind: ToastKind = 'info', message?: string) => {
    const id = uid();
    setToasts((prev) => [...prev.slice(-3), { id, kind, title, message }]);
    const t = window.setTimeout(() => {
      setToasts((prev) => prev.filter((x) => x.id !== id));
    }, 4600);
    timers.current.push(t);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((x) => x.id !== id));
  }, []);

  const reloadSettings = useCallback(async () => {
    const s = await db.settings.get('global');
    setSettings(s ?? null);
  }, []);

  useEffect(() => {
    (async () => {
      const s = await db.settings.get('global');
      setSettings(s ?? null);
      const session = readSession();
      if (session) {
        const stored = await db.users.get(session.user.id);
        if (stored?.active) setUser(session.user);
        else clearSession();
      }
      setReady(true);
    })();
    return () => timers.current.forEach((t) => clearTimeout(t));
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('inventra.theme', theme);
  }, [theme]);

  // Si otra sincronización trajo una configuración nueva, se refleja sin recargar.
  useEffect(() => {
    const onRemote = () => {
      void reloadSettings();
    };
    window.addEventListener('inventra:remote-applied', onRemote);
    return () => window.removeEventListener('inventra:remote-applied', onRemote);
  }, [reloadSettings]);

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  // Expiración de sesión + renovación por actividad
  useEffect(() => {
    if (!user) return;
    const minutes = settings?.sessionMinutes ?? 60;
    const check = window.setInterval(() => {
      if (!readSession()) {
        setUser(null);
        toast('Sesión finalizada', 'warn', 'Por inactividad. Vuelva a ingresar.');
      }
    }, 30000);
    const activity = () => touchSession(minutes);
    window.addEventListener('click', activity);
    window.addEventListener('keydown', activity);
    return () => {
      clearInterval(check);
      window.removeEventListener('click', activity);
      window.removeEventListener('keydown', activity);
    };
  }, [user, settings, toast]);

  const login = useCallback(
    async (email: string, pin: string) => {
      const normalized = email.trim().toLowerCase();
      const found = await db.users.where('email').equals(normalized).first();
      if (!found) {
        await db.audit.add({
          id: uid(),
          entity: 'session',
          entityId: normalized,
          action: 'login',
          summary: `Intento fallido: usuario inexistente (${normalized})`,
          userId: 'anon',
          userName: normalized,
          at: new Date().toISOString(),
        });
        throw new Error('Correo o contraseña incorrectos.');
      }
      if (!found.active) throw new Error('El usuario está inactivo. Contacte al administrador.');
      if (found.lockedUntil && found.lockedUntil > Date.now()) {
        const min = Math.ceil((found.lockedUntil - Date.now()) / 60000);
        throw new Error(`Usuario bloqueado por intentos fallidos. Reintente en ${min} min.`);
      }

      const ok = await verifyPin(pin, found.pinHash, found.salt);
      if (!ok) {
        const attempts = found.failedAttempts + 1;
        await db.users.update(found.id, {
          failedAttempts: attempts,
          lockedUntil: attempts >= 5 ? Date.now() + 5 * 60000 : null,
        });
        await db.audit.add({
          id: uid(),
          entity: 'session',
          entityId: found.id,
          action: 'login',
          summary: `Intento fallido (${attempts}/5)`,
          userId: found.id,
          userName: found.name,
          at: new Date().toISOString(),
        });
        throw new Error(
          attempts >= 5
            ? 'Usuario bloqueado 5 minutos por intentos fallidos.'
            : `Correo o contraseña incorrectos. Intento ${attempts} de 5.`,
        );
      }

      const sessionUser: SessionUser = {
        id: found.id,
        name: found.name,
        email: found.email,
        role: found.role,
      };
      const minutes = settings?.sessionMinutes ?? 60;
      saveSession(sessionUser, minutes);
      await db.users.update(found.id, {
        failedAttempts: 0,
        lockedUntil: null,
        lastLoginAt: new Date().toISOString(),
      });
      await db.audit.add({
        id: uid(),
        entity: 'session',
        entityId: found.id,
        action: 'login',
        summary: 'Inicio de sesión exitoso',
        userId: found.id,
        userName: found.name,
        at: new Date().toISOString(),
      });
      setUser(sessionUser);
      toast(`Bienvenido, ${found.name.split(' ')[0]}`, 'success', 'Sesión iniciada correctamente.');
    },
    [settings, toast],
  );

  const logout = useCallback(() => {
    clearSession();
    setUser(null);
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme((t) => (t === 'light' ? 'dark' : 'light'));
  }, []);

  const value = useMemo<AppContextValue>(
    () => ({
      user,
      settings,
      ready,
      online,
      theme,
      login,
      logout,
      toast,
      toasts,
      dismissToast,
      toggleTheme,
      reloadSettings,
    }),
    [user, settings, ready, online, theme, login, logout, toast, toasts, dismissToast, toggleTheme, reloadSettings],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp debe usarse dentro de AppProvider');
  return ctx;
}

import { useEffect, useReducer } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/schema';
import { setPermissionOverrides } from '../domain/permissions';

/**
 * Carga las autorizaciones que el administrador haya configurado y mantiene
 * actualizado el cache que usan todas las pantallas al evaluar `can()`.
 * Se llama una sola vez en la raíz de la aplicación: cuando cambia una regla,
 * este componente vuelve a dibujar todo el árbol con las nuevas reglas.
 */
export function usePermissionSync(): void {
  const rows = useLiveQuery(() => db.permissions.toArray(), []);
  const [, forceRender] = useReducer((n: number) => n + 1, 0);

  useEffect(() => {
    setPermissionOverrides(rows ?? []);
    forceRender();
  }, [rows]);
}

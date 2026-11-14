import { useSyncExternalStore } from 'react';
import { getSyncStatus, subscribeSync } from './engine';
import type { SyncStatus } from './engine';

/** Estado reactivo de la sincronización para la interfaz. */
export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(subscribeSync, getSyncStatus, getSyncStatus);
}

// Producto No Conforme (PNC): segregación, bloqueo de lote y análisis Kaizen.

import { db, nextCode } from '../db/schema';
import { uid } from './format';
import { BusinessError } from './movements';
import type { DefectType, NonConformity, PncStatus, Product, SessionUser, Shift } from './types';

const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

export interface PncInput {
  date?: string;
  productId: string;
  lotCode: string;
  qty: number;
  defectType: DefectType;
  source: NonConformity['source'];
  machineId?: string;
  shift?: Shift;
  orderId?: string;
  containment?: string;
  notes?: string;
  status?: PncStatus;
}

const TX = [db.pnc, db.products, db.lots, db.counters, db.audit, db.outbox, db.locationStock];

async function setLotBlocked(productId: string, lotCode: string, blocked: boolean): Promise<number> {
  if (!lotCode.trim()) return 0;
  const lots = await db.lots
    .where('[productId+code]')
    .equals([productId, lotCode.trim().toUpperCase()])
    .toArray();
  for (const lot of lots) await db.lots.update(lot.id, { blocked });
  return lots.length;
}

export async function createPnc(input: PncInput, user: SessionUser): Promise<NonConformity> {
  return db.transaction('rw', TX, async () => {
    if (input.qty <= 0) throw new BusinessError('QTY', 'La cantidad no conforme debe ser mayor que cero.');
    const product = await db.products.get(input.productId);
    if (!product) throw new BusinessError('PRODUCT', 'El producto no existe.');
    const lotCode = input.lotCode.trim().toUpperCase();
    if (!lotCode) throw new BusinessError('LOT', 'Indique el lote para poder segregarlo.');

    const code = await nextCode('PNC', 5);
    const createdAt = new Date().toISOString();
    const pnc: NonConformity = {
      id: uid(),
      code,
      date: input.date ?? createdAt.slice(0, 10),
      productId: product.id,
      productSku: product.sku,
      productName: product.name,
      lotCode,
      qty: round(input.qty),
      unitCost: product.cost,
      defectType: input.defectType,
      source: input.source,
      machineId: input.machineId,
      shift: input.shift,
      orderId: input.orderId,
      status: input.status ?? 'segregado',
      containment: input.containment?.trim() || 'Lote segregado y bloqueado para despacho.',
      rootCause: '',
      rootCauseDetail: '',
      correctiveAction: '',
      responsible: '',
      kaizenNotes: input.notes?.trim() ?? '',
      disposition: '',
      userId: user.id,
      userName: user.name,
      createdAt,
    };
    await db.pnc.add(pnc);

    if (pnc.status === 'segregado' || pnc.status === 'abierto') {
      await setLotBlocked(product.id, lotCode, true);
    }

    await db.audit.add({
      id: uid(),
      entity: 'pnc',
      entityId: pnc.id,
      action: 'crear',
      summary: `PNC ${code} · ${product.sku} · lote ${lotCode} · ${input.qty} ${product.uom} · ${input.defectType}`,
      after: pnc,
      userId: user.id,
      userName: user.name,
      at: createdAt,
    });
    await db.outbox.add({
      entity: 'pnc',
      entityId: pnc.id,
      action: 'upsert',
      payload: pnc,
      at: createdAt,
      synced: 0,
    });
    return pnc;
  });
}

export async function segregatePnc(id: string, user: SessionUser, containment?: string): Promise<NonConformity> {
  return db.transaction('rw', TX, async () => {
    const pnc = await db.pnc.get(id);
    if (!pnc) throw new BusinessError('NOT_FOUND', 'El PNC no existe.');
    if (pnc.status === 'cerrado' || pnc.status === 'desechado') {
      throw new BusinessError('STATE', 'El PNC ya está cerrado.');
    }
    const blocked = await setLotBlocked(pnc.productId, pnc.lotCode, true);
    const next: NonConformity = {
      ...pnc,
      status: 'segregado',
      containment: containment?.trim() || pnc.containment,
    };
    await db.pnc.put(next);
    await db.audit.add({
      id: uid(),
      entity: 'pnc',
      entityId: id,
      action: 'actualizar',
      summary: `PNC ${pnc.code} segregado · ${blocked} lote(s) bloqueado(s)`,
      before: { status: pnc.status },
      after: { status: 'segregado', blockedLots: blocked },
      userId: user.id,
      userName: user.name,
      at: new Date().toISOString(),
    });
    return next;
  });
}

export interface KaizenInput {
  rootCause: string;
  rootCauseDetail: string;
  correctiveAction: string;
  responsible: string;
  kaizenNotes: string;
}

export async function analyzePnc(id: string, input: KaizenInput, user: SessionUser): Promise<NonConformity> {
  return db.transaction('rw', [db.pnc, db.audit, db.outbox], async () => {
    const pnc = await db.pnc.get(id);
    if (!pnc) throw new BusinessError('NOT_FOUND', 'El PNC no existe.');
    if (!input.rootCause.trim()) throw new BusinessError('ROOT', 'Seleccione la causa raíz.');
    if (input.correctiveAction.trim().length < 8) {
      throw new BusinessError('ACTION', 'Describa una acción correctiva concreta (mínimo 8 caracteres).');
    }
    const next: NonConformity = {
      ...pnc,
      rootCause: input.rootCause,
      rootCauseDetail: input.rootCauseDetail.trim(),
      correctiveAction: input.correctiveAction.trim(),
      responsible: input.responsible.trim(),
      kaizenNotes: input.kaizenNotes.trim(),
      status: pnc.status === 'cerrado' ? pnc.status : 'en_analisis',
    };
    await db.pnc.put(next);
    await db.audit.add({
      id: uid(),
      entity: 'pnc',
      entityId: id,
      action: 'actualizar',
      summary: `Análisis Kaizen registrado para ${pnc.code} · causa: ${next.rootCause}`,
      before: pnc,
      after: next,
      userId: user.id,
      userName: user.name,
      at: new Date().toISOString(),
    });
    await db.outbox.add({
      entity: 'pnc',
      entityId: id,
      action: 'upsert',
      payload: next,
      at: new Date().toISOString(),
      synced: 0,
    });
    return next;
  });
}

export async function closePnc(
  id: string,
  disposition: 'cerrado' | 'reprocesado' | 'desechado',
  notes: string,
  user: SessionUser,
): Promise<NonConformity> {
  return db.transaction('rw', TX, async () => {
    const pnc = await db.pnc.get(id);
    if (!pnc) throw new BusinessError('NOT_FOUND', 'El PNC no existe.');
    if (!pnc.rootCause) {
      throw new BusinessError('KAIZEN', 'Antes de cerrar registre el análisis de causa raíz.');
    }
    if (!notes.trim()) throw new BusinessError('NOTES', 'Indique la disposición final o nota de cierre.');
    const closedAt = new Date().toISOString();
    const next: NonConformity = {
      ...pnc,
      status: disposition,
      disposition: notes.trim(),
      closedAt,
      kaizenNotes: pnc.kaizenNotes ? `${pnc.kaizenNotes}\nCierre: ${notes.trim()}` : `Cierre: ${notes.trim()}`,
    };
    await db.pnc.put(next);
    if (disposition === 'reprocesado') {
      await setLotBlocked(pnc.productId, pnc.lotCode, false);
    }
    await db.audit.add({
      id: uid(),
      entity: 'pnc',
      entityId: id,
      action: 'cierre',
      summary: `PNC ${pnc.code} cerrado como ${disposition}`,
      before: { status: pnc.status },
      after: { status: disposition, disposition: notes.trim() },
      userId: user.id,
      userName: user.name,
      at: closedAt,
    });
    return next;
  });
}

export function pncSummary(pncs: NonConformity[]) {
  const open = pncs.filter((p) => !['cerrado', 'reprocesado', 'desechado'].includes(p.status));
  const blocked = pncs.filter((p) => p.status === 'segregado');
  const qty = pncs.reduce((a, p) => a + p.qty, 0);
  const cost = pncs.reduce((a, p) => a + p.qty * p.unitCost, 0);
  return {
    total: pncs.length,
    open: open.length,
    blocked: blocked.length,
    qty: round(qty),
    cost: round(cost),
  };
}

export function pncByDefect(pncs: NonConformity[], products: Product[]) {
  const map = new Map<DefectType, { qty: number; cost: number; count: number }>();
  for (const p of pncs) {
    const current = map.get(p.defectType) ?? { qty: 0, cost: 0, count: 0 };
    current.qty += p.qty;
    current.cost += p.qty * (p.unitCost || products.find((x) => x.id === p.productId)?.cost || 0);
    current.count += 1;
    map.set(p.defectType, current);
  }
  return Array.from(map.entries()).map(([type, v]) => ({ type, ...v, qty: round(v.qty), cost: round(v.cost) }));
}

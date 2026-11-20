// Registro diario de producción por turno y máquina.
// Calcula OEE, índice de scrap y alimenta el MRP del programa diario.

import { db, nextCode } from '../db/schema';
import { uid } from './format';
import { applyMovement, BusinessError } from './movements';
import type {
  Bom,
  BomItem,
  DefectType,
  Machine,
  NonConformity,
  Product,
  ProductionRecord,
  SessionUser,
  Shift,
} from './types';
import { SHIFTS } from './types';
import type { ShiftDef } from './types';

const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;
const clamp = (n: number, min = 0, max = 100) => Math.min(max, Math.max(min, n));

export const localDateKey = (value: Date | string = new Date()): string => {
  if (typeof value === 'string') return value.slice(0, 10);
  const d = new Date(value);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
};

export const todayKey = () => localDateKey(new Date());

export const shiftMinutes = (shift: Shift, shifts: ShiftDef[] = SHIFTS) =>
  shifts.find((s) => s.value === shift)?.minutes ?? 360;

export interface RecordMetrics {
  produced: number;
  expected: number;
  runMinutes: number;
  availability: number;
  performance: number;
  quality: number;
  oee: number;
  scrapPct: number;
}

/** OEE = Disponibilidad × Rendimiento × Calidad. */
export function recordMetrics(record: ProductionRecord): RecordMetrics {
  const produced = record.goodQty + record.scrapQty;
  const planned = Math.max(0, record.plannedMinutes);
  const downtime = Math.min(planned, Math.max(0, record.downtimeMinutes));
  const runMinutes = Math.max(0, planned - downtime);
  const availability = planned > 0 ? clamp((runMinutes / planned) * 100) : 0;

  // Rendimiento = piezas reales frente a la capacidad teórica del tiempo efectivo.
  // Ya no depende de los "golpes" capturados manualmente.
  const cavities = Math.max(1, record.cavities || 1);
  const idealCycle = Math.max(0, record.idealCycleSeconds || 0);
  let expected = 0;
  let performance = 0;
  if (idealCycle > 0 && runMinutes > 0) {
    expected = ((runMinutes * 60) / idealCycle) * cavities;
    performance = expected > 0 ? clamp((produced / expected) * 100) : 0;
  } else if (record.plannedQty > 0) {
    expected = record.plannedQty;
    performance = clamp((produced / record.plannedQty) * 100);
  }

  const quality = produced > 0 ? clamp((record.goodQty / produced) * 100) : 0;
  const oee = (availability * performance * quality) / 10000;
  const scrapPct = produced > 0 ? (record.scrapQty / produced) * 100 : 0;

  return {
    produced,
    expected: round(expected),
    runMinutes: round(runMinutes),
    availability: round(availability, 1),
    performance: round(performance, 1),
    quality: round(quality, 1),
    oee: round(oee, 1),
    scrapPct: round(scrapPct, 1),
  };
}

export function standardUnitCost(
  product: Product,
  boms: Bom[],
  bomItems: BomItem[],
  products: Product[],
): number {
  const bom = boms.find((b) => b.productId === product.id && b.status === 'activo');
  if (!bom) return product.cost;
  const items = bomItems.filter((i) => i.bomId === bom.id);
  if (items.length === 0) return product.cost;
  const materials = items.reduce((acc, item) => {
    const component = products.find((p) => p.id === item.componentId);
    return acc + (component?.cost ?? 0) * item.qty * (1 + (item.wastePct || 0) / 100);
  }, 0);
  const output = bom.outputQty > 0 ? bom.outputQty : 1;
  return round((materials + bom.laborCost) / output, 2);
}

const DEFECT_BY_REASON: Record<string, DefectType> = {
  Rechupado: 'rechupado',
  'Ráfaga / rebaba': 'rafaga',
  'Peso fuera de especificación': 'peso',
  'Defecto dimensional': 'dimension',
  'Color / contaminación': 'color',
  'Arranque de máquina': 'otro',
  'Paro de molde': 'rebaba',
  'Otro defecto': 'otro',
};

export interface ProductionTargets {
  /** Capacidad teórica del turno, usada por el programa diario y el MRP. */
  plannedQty: number;
  /** Ciclos equivalentes a la producción real; se guarda solo como trazabilidad. */
  shots: number;
  cavities: number;
  idealCycleSeconds: number;
}

/**
 * Calcula automáticamente la cantidad programada y los ciclos equivalentes a
 * partir de la duración del turno, el ciclo ideal y las cavidades de la máquina.
 * El usuario ya no captura "piezas programadas" ni "golpes".
 */
export function deriveProductionTargets(input: {
  goodQty: number;
  scrapQty: number;
  cavities: number;
  idealCycleSeconds: number;
  plannedMinutes: number;
  downtimeMinutes?: number;
  plannedQty?: number;
  shots?: number;
}): ProductionTargets {
  const produced = Math.max(0, input.goodQty + input.scrapQty);
  const cavities = Math.max(1, Math.round(input.cavities) || 1);
  const idealCycleSeconds = Math.max(0, input.idealCycleSeconds || 0);
  const plannedMinutes = Math.max(0, input.plannedMinutes || 0);
  const capacity =
    idealCycleSeconds > 0 && plannedMinutes > 0
      ? ((plannedMinutes * 60) / idealCycleSeconds) * cavities
      : 0;
  return {
    plannedQty: round(input.plannedQty && input.plannedQty > 0 ? input.plannedQty : capacity || produced),
    shots: round(input.shots && input.shots > 0 ? input.shots : produced / cavities),
    cavities,
    idealCycleSeconds,
  };
}

export interface ProductionRecordInput {
  date: string;
  shift: Shift;
  machineId: string;
  productId: string;
  orderId?: string;
  goodQty: number;
  scrapQty: number;
  cavities: number;
  plannedMinutes: number;
  downtimeMinutes: number;
  idealCycleSeconds: number;
  scrapReason: string;
  notes?: string;
  locationId?: string;
  /** Valores calculados; se aceptan solo para compatibilidad con datos antiguos. */
  plannedQty?: number;
  shots?: number;
}

export async function createProductionRecord(
  input: ProductionRecordInput,
  user: SessionUser,
  at?: string,
): Promise<ProductionRecord> {
  return db.transaction('rw', [db.machines, db.products, db.productionRecords, db.counters, db.audit, db.outbox], async () => {
    if (!input.date) throw new BusinessError('DATE', 'Indique la fecha de producción.');
    if (!SHIFTS.some((s) => s.value === input.shift)) throw new BusinessError('SHIFT', 'Seleccione un turno válido.');
    if (input.goodQty < 0 || input.scrapQty < 0) throw new BusinessError('QTY', 'Las cantidades no pueden ser negativas.');
    if (input.goodQty + input.scrapQty <= 0) throw new BusinessError('QTY', 'Registre piezas conformes o scrap.');
    if (input.plannedMinutes <= 0) throw new BusinessError('TIME', 'El tiempo planificado debe ser mayor que cero.');
    if (input.downtimeMinutes < 0 || input.downtimeMinutes > input.plannedMinutes) {
      throw new BusinessError('TIME', 'El tiempo de paro no puede superar el tiempo planificado.');
    }

    const machine = await db.machines.get(input.machineId);
    if (!machine) throw new BusinessError('MACHINE', 'La máquina no existe.');
    if (machine.status !== 'activa') throw new BusinessError('MACHINE', 'La máquina no está activa.');
    const product = await db.products.get(input.productId);
    if (!product) throw new BusinessError('PRODUCT', 'El producto no existe.');

    const targets = deriveProductionTargets({
      goodQty: input.goodQty,
      scrapQty: input.scrapQty,
      cavities: input.cavities || machine.cavities || 1,
      idealCycleSeconds: input.idealCycleSeconds || machine.idealCycleSeconds || 0,
      plannedMinutes: input.plannedMinutes,
      plannedQty: input.plannedQty,
      shots: input.shots,
    });

    const code = await nextCode('PR', 5);
    const createdAt = at ?? new Date().toISOString();
    const record: ProductionRecord = {
      id: uid(),
      code,
      date: input.date,
      shift: input.shift,
      machineId: machine.id,
      machineCode: machine.code,
      machineName: machine.name,
      productId: product.id,
      productSku: product.sku,
      productName: product.name,
      orderId: input.orderId || undefined,
      plannedQty: targets.plannedQty,
      goodQty: round(input.goodQty),
      scrapQty: round(input.scrapQty),
      shots: targets.shots,
      cavities: targets.cavities,
      plannedMinutes: round(input.plannedMinutes),
      downtimeMinutes: round(input.downtimeMinutes),
      idealCycleSeconds: targets.idealCycleSeconds,
      scrapReason: input.scrapReason,
      notes: input.notes?.trim() ?? '',
      status: 'abierto',
      lotCode: `L-${input.date.replace(/-/g, '')}-T${input.shift}-${machine.code}`,
      locationId: input.locationId || product.locationId,
      userId: user.id,
      userName: user.name,
      createdAt,
    };

    await db.productionRecords.add(record);
    await db.audit.add({
      id: uid(),
      entity: 'production_record',
      entityId: record.id,
      action: 'crear',
      summary: `Registro ${record.code} · ${machine.code} · ${SHIFTS.find((s) => s.value === record.shift)?.label} · ${record.goodQty} conformes / ${record.scrapQty} scrap`,
      after: record,
      userId: user.id,
      userName: user.name,
      at: createdAt,
    });
    await db.outbox.add({
      entity: 'production_record',
      entityId: record.id,
      action: 'upsert',
      payload: record,
      at: createdAt,
      synced: 0,
    });
    return record;
  });
}

export async function validateProductionRecord(
  recordId: string,
  user: SessionUser,
  at?: string,
): Promise<ProductionRecord> {
  return db.transaction(
    'rw',
    [
      db.productionRecords,
      db.machines,
      db.products,
      db.movements,
      db.lots,
      db.counters,
      db.audit,
      db.outbox,
      db.settings,
      db.locations,
      db.locationStock,
      db.pnc,
      db.boms,
      db.bomItems,
    ],
    async () => {
      const record = await db.productionRecords.get(recordId);
      if (!record) throw new BusinessError('NOT_FOUND', 'El registro de producción no existe.');
      if (record.status === 'validado') throw new BusinessError('STATE', 'Este turno ya fue validado.');

      const product = await db.products.get(record.productId);
      if (!product) throw new BusinessError('PRODUCT', 'El producto terminado no existe.');

      let locationId = record.locationId || product.locationId;
      if (!locationId) {
        const curado = await db.locations.where('type').equals('curado').first();
        locationId = curado?.id;
      }

      const boms = await db.boms.toArray();
      const bomItems = await db.bomItems.toArray();
      const products = await db.products.toArray();
      const unitCost = standardUnitCost(product, boms, bomItems, products);
      const validatedAt = at ?? new Date().toISOString();

      let movementId: string | undefined;
      if (record.goodQty > 0) {
        const movement = await applyMovement(
          {
            type: 'PROD_IN',
            reason: 'Producción terminada',
            productId: record.productId,
            qty: record.goodQty,
            unitCost,
            lotCode: record.lotCode,
            locationId,
            refDoc: record.code,
            orderId: record.orderId,
            notes: `Validación ${record.code} · ${record.machineCode} · T${record.shift}`,
            at: validatedAt,
          },
          user,
        );
        movementId = movement.id;
      }

      let pncId: string | undefined;
      if (record.scrapQty > 0) {
        const pncCode = await nextCode('PNC', 5);
        const pnc: NonConformity = {
          id: uid(),
          code: pncCode,
          date: record.date,
          productId: record.productId,
          productSku: record.productSku,
          productName: record.productName,
          lotCode: record.lotCode,
          qty: record.scrapQty,
          unitCost,
          defectType: DEFECT_BY_REASON[record.scrapReason] ?? 'otro',
          source: 'produccion',
          machineId: record.machineId,
          shift: record.shift,
          orderId: record.orderId,
          productionRecordId: record.id,
          status: 'segregado',
          containment: 'Scrap segregado en el área de producción y pendiente de análisis.',
          rootCause: '',
          rootCauseDetail: '',
          correctiveAction: '',
          responsible: '',
          kaizenNotes: '',
          disposition: '',
          userId: user.id,
          userName: user.name,
          createdAt: validatedAt,
        };
        await db.pnc.add(pnc);
        pncId = pnc.id;
      }

      await db.productionRecords.update(record.id, {
        status: 'validado',
        locationId,
        movementId,
        pncId,
        validatedAt,
        validatedBy: user.name,
      });

      await db.audit.add({
        id: uid(),
        entity: 'production_record',
        entityId: record.id,
        action: 'cierre',
        summary: `Turno validado ${record.code} · ingreso ${record.goodQty} und · scrap ${record.scrapQty}`,
        before: { status: record.status },
        after: { status: 'validado', movementId, pncId, locationId },
        userId: user.id,
        userName: user.name,
        at: validatedAt,
      });

      const updated = await db.productionRecords.get(record.id);
      return updated as ProductionRecord;
    },
  );
}

/** Demanda diaria pendiente (programado − conforme) para alimentar el MRP. */
export function buildDailyDemand(
  records: ProductionRecord[],
  date: string,
): { productId: string; qty: number; records: ProductionRecord[] }[] {
  const map = new Map<string, { productId: string; qty: number; records: ProductionRecord[] }>();
  for (const r of records.filter((x) => x.date === date)) {
    const pending = Math.max(0, r.plannedQty - r.goodQty);
    if (pending <= 0) continue;
    const row = map.get(r.productId) ?? { productId: r.productId, qty: 0, records: [] };
    row.qty += pending;
    row.records.push(r);
    map.set(r.productId, row);
  }
  return Array.from(map.values()).map((r) => ({ ...r, qty: round(r.qty) }));
}

export interface PlantSummary {
  records: number;
  planned: number;
  good: number;
  scrap: number;
  produced: number;
  oee: number;
  availability: number;
  performance: number;
  quality: number;
  scrapPct: number;
  compliance: number;
}

export function summarize(records: ProductionRecord[]): PlantSummary {
  const planned = records.reduce((a, r) => a + r.plannedQty, 0);
  const good = records.reduce((a, r) => a + r.goodQty, 0);
  const scrap = records.reduce((a, r) => a + r.scrapQty, 0);
  const produced = good + scrap;
  const weight = records.reduce((a, r) => a + Math.max(1, r.plannedMinutes), 0);
  const weighted = (pick: (m: RecordMetrics) => number) =>
    weight > 0
      ? round(
          records.reduce((a, r) => a + pick(recordMetrics(r)) * Math.max(1, r.plannedMinutes), 0) / weight,
          1,
        )
      : 0;
  return {
    records: records.length,
    planned: round(planned),
    good: round(good),
    scrap: round(scrap),
    produced: round(produced),
    oee: weighted((m) => m.oee),
    availability: weighted((m) => m.availability),
    performance: weighted((m) => m.performance),
    quality: weighted((m) => m.quality),
    scrapPct: produced > 0 ? round((scrap / produced) * 100, 1) : 0,
    compliance: planned > 0 ? round((good / planned) * 100, 1) : 0,
  };
}

export function summarizeByShift(records: ProductionRecord[], shifts: ShiftDef[] = SHIFTS) {
  return shifts.map((s) => ({ shift: s, ...summarize(records.filter((r) => r.shift === s.value)) }));
}

export function summarizeByMachine(records: ProductionRecord[], machines: Machine[]) {
  return machines
    .map((machine) => ({
      machine,
      ...summarize(records.filter((r) => r.machineId === machine.id)),
    }))
    .filter((r) => r.records > 0)
    .sort((a, b) => b.oee - a.oee);
}

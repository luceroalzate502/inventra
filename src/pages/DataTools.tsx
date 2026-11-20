import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  AlertTriangle,
  CheckCircle2,
  Database,
  Download,
  Factory,
  FileSpreadsheet,
  Layers,
  Package,
  Upload,
} from 'lucide-react';
import { db } from '../db/schema';
import { useApp } from '../context/AppContext';
import { dateTime, money } from '../domain/format';
import { exportExcel } from '../domain/export';
import {
  TEMPLATES,
  downloadTemplate,
  importBoms,
  importMachines,
  importProducts,
  readExcelFile,
} from '../domain/importExport';
import type { ExcelRow, ImportResult } from '../domain/importExport';
import { DISPATCH_STATUS, MACHINE_TYPES, PNC_STATUS } from '../domain/types';
import type { SessionUser } from '../domain/types';
import {
  Badge,
  Button,
  Card,
  CardHead,
  PageHeader,
  StatCard,
} from '../components/ui';

type ImportKind = Exclude<keyof typeof TEMPLATES, 'locations'>;

const IMPORT_META: Record<
  ImportKind,
  {
    title: string;
    description: string;
    icon: typeof Package;
    color: string;
    run: (rows: ExcelRow[], user: SessionUser) => Promise<ImportResult>;
  }
> = {
  products: {
    title: 'Productos',
    description: 'Catálogo de SKU, tipo, costo y mínimos.',
    icon: Package,
    color: '#0f9b8e',
    run: importProducts,
  },
  boms: {
    title: 'Listas de materiales',
    description: 'Producto terminado, componentes, merma y mano de obra.',
    icon: Layers,
    color: '#3b82f6',
    run: importBoms,
  },
  machines: {
    title: 'Máquinas',
    description: 'Inyectoras, sopladoras, cavidades y ciclo ideal.',
    icon: Factory,
    color: '#f59e0b',
    run: importMachines,
  },
};

export function DataTools() {
  const { user, settings, toast } = useApp();
  const products = useLiveQuery(() => db.products.toArray(), []) ?? [];
  const boms = useLiveQuery(() => db.boms.toArray(), []) ?? [];
  const bomItems = useLiveQuery(() => db.bomItems.toArray(), []) ?? [];
  const machines = useLiveQuery(() => db.machines.toArray(), []) ?? [];
  const records = useLiveQuery(() => db.productionRecords.toArray(), []) ?? [];
  const pncs = useLiveQuery(() => db.pnc.toArray(), []) ?? [];
  const dispatches = useLiveQuery(() => db.dispatches.toArray(), []) ?? [];

  const [results, setResults] = useState<Partial<Record<ImportKind, ImportResult>>>({});
  const [busy, setBusy] = useState<ImportKind | null>(null);

  const company = settings?.companyName ?? 'Invencodi';

  const totals = useMemo(
    () => ({
      products: products.length,
      boms: boms.length,
      machines: machines.length,
      records: records.length,
      pncs: pncs.length,
      dispatches: dispatches.length,
    }),
    [products, boms, machines, records, pncs, dispatches],
  );

  const handleFile = async (kind: ImportKind, file: File | undefined) => {
    if (!file || !user) return;
    setBusy(kind);
    try {
      const rows = await readExcelFile(file);
      if (rows.length === 0) {
        toast('Archivo vacío', 'warn', 'La primera hoja no contiene filas con datos.');
        return;
      }
      const result = await IMPORT_META[kind].run(rows, user);
      setResults((prev) => ({ ...prev, [kind]: result }));
      toast(
        result.errors.length > 0 ? 'Importación con observaciones' : 'Importación completada',
        result.errors.length > 0 ? 'warn' : 'success',
        `${result.created} creados · ${result.updated} actualizados · ${result.skipped} omitidos`,
      );
    } catch (error) {
      toast('No se pudo importar', 'error', error instanceof Error ? error.message : undefined);
    } finally {
      setBusy(null);
    }
  };

  const exportProducts = () => {
    exportExcel('catalogo-productos.xlsx', [
      {
        name: 'Productos',
        rows: products.map((p) => ({
          SKU: p.sku,
          NOMBRE: p.name,
          TIPO: p.type,
          UOM: p.uom,
          COSTO: p.cost,
          STOCK: p.stock,
          STOCK_MIN: p.minStock,
          STOCK_MAX: p.maxStock,
          CODIGO_BARRAS: p.barcode,
          LOTE: p.lotTracked ? 'SI' : 'NO',
          CATEGORIA: p.category,
          DESCRIPCION: p.description,
          ESTADO: p.status,
        })),
        widths: [16, 34, 8, 8, 12, 12, 12, 12, 18, 8, 18, 40, 10],
      },
    ]);
  };

  const exportBoms = () => {
    const rows: Record<string, string | number>[] = boms.flatMap((bom): Record<string, string | number>[] => {
      const product = products.find((p) => p.id === bom.productId);
      const items = bomItems.filter((i) => i.bomId === bom.id);
      if (items.length === 0) {
        return [{
          BOM_CODIGO: bom.code,
          PRODUCTO_SKU: product?.sku ?? '',
          VERSION: bom.version,
          CANTIDAD_SALIDA: bom.outputQty,
          COMPONENTE_SKU: '',
          CANTIDAD: '',
          MERMA_PCT: '',
          MANO_OBRA: bom.laborCost,
          ESTADO: bom.status,
        }];
      }
      return items.map((item) => ({
        BOM_CODIGO: bom.code,
        PRODUCTO_SKU: product?.sku ?? '',
        VERSION: bom.version,
        CANTIDAD_SALIDA: bom.outputQty,
        COMPONENTE_SKU: products.find((p) => p.id === item.componentId)?.sku ?? '',
        CANTIDAD: item.qty,
        MERMA_PCT: item.wastePct,
        MANO_OBRA: bom.laborCost,
        ESTADO: bom.status,
      }));
    });
    exportExcel('catalogo-bom.xlsx', [{ name: 'BOM', rows, widths: [18, 18, 8, 14, 18, 10, 10, 12, 10] }]);
  };

  const exportMachines = () => {
    exportExcel('catalogo-maquinas.xlsx', [
      {
        name: 'Máquinas',
        rows: machines.map((m) => ({
          CODIGO: m.code,
          NOMBRE: m.name,
          TIPO: m.type,
          MARCA: m.brand,
          CAVIDADES: m.cavities,
          CICLO_IDEAL_SEG: m.idealCycleSeconds,
          ESTADO: m.status,
          NOTAS: m.notes,
        })),
        widths: [14, 26, 14, 16, 12, 16, 14, 40],
      },
    ]);
  };

  const exportProduction = () => {
    exportExcel('reporte-produccion-diaria.xlsx', [
      {
        name: 'Producción',
        rows: records
          .slice()
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .map((r) => ({
            Registro: r.code,
            Fecha: r.date,
            Turno: `T${r.shift}`,
            Máquina: r.machineCode,
            Producto: r.productSku,
            Nombre: r.productName,
            Lote: r.lotCode,
            Conformes: r.goodQty,
            Scrap: r.scrapQty,
            'Paro min': r.downtimeMinutes,
            'Ciclo ideal s': r.idealCycleSeconds,
            Estado: r.status,
            Responsable: r.userName,
          })),
        widths: [14, 12, 8, 12, 16, 30, 24, 12, 10, 12, 14, 12, 22],
      },
    ]);
  };

  const exportPnc = () => {
    exportExcel('reporte-pnc.xlsx', [
      {
        name: 'PNC',
        rows: pncs.map((p) => ({
          PNC: p.code,
          Fecha: p.date,
          SKU: p.productSku,
          Producto: p.productName,
          Lote: p.lotCode,
          Cantidad: p.qty,
          Defecto: p.defectType,
          Fuente: p.source,
          Estado: PNC_STATUS[p.status].label,
          'Causa raíz': p.rootCause,
          'Acción correctiva': p.correctiveAction,
          Responsable: p.responsible,
          'Costo COP': Math.round(p.qty * p.unitCost),
        })),
        widths: [14, 12, 16, 30, 24, 10, 22, 14, 22, 22, 40, 20, 14],
      },
    ]);
  };

  const exportDispatches = () => {
    exportExcel('reporte-despachos.xlsx', [
      {
        name: 'Despachos',
        rows: dispatches.flatMap((d) =>
          d.items.map((item) => ({
            Despacho: d.code,
            Fecha: d.date,
            Cliente: d.customer,
            Pedido: d.orderRef,
            Estado: DISPATCH_STATUS[d.status].label,
            SKU: item.sku,
            Producto: item.name,
            Lote: item.lotCode ?? '',
            Solicitado: item.requestedQty,
            Pickeado: item.pickedQty,
          })),
        ),
        widths: [14, 12, 26, 16, 16, 16, 30, 24, 12, 12],
      },
    ]);
  };

  return (
    <>
      <PageHeader
        title="Importación y exportación Excel"
        subtitle="Plantillas, carga masiva de catálogos y reportes operativos"
        actions={
          <Badge tone="brand">
            <Database size={12} /> {company}
          </Badge>
        }
      />

      <div className="kpi-grid">
        <StatCard label="Productos" value={totals.products} icon={<Package size={18} />} tone="brand" foot={<span>SKU en catálogo</span>} />
        <StatCard label="BOM" value={totals.boms} icon={<Layers size={18} />} tone="info" foot={<span>listas de materiales</span>} />
        <StatCard label="Máquinas" value={totals.machines} icon={<Factory size={18} />} tone="warn" foot={<span>{totals.records} registros de producción</span>} />
        <StatCard label="Operación" value={totals.pncs + totals.dispatches} icon={<FileSpreadsheet size={18} />} tone="ok" foot={<span>{totals.pncs} PNC · {totals.dispatches} despachos</span>} />
      </div>

      <Card>
        <CardHead
          title="Plantillas de importación"
          subtitle="Descargue la plantilla, complete los datos y cárguela en formato .xlsx"
          icon={<Upload size={18} color="var(--brand-3)" />}
        />
        <div className="card-pad">
          <div className="location-grid">
            {(Object.keys(IMPORT_META) as ImportKind[]).map((kind) => {
              const meta = IMPORT_META[kind];
              const template = TEMPLATES[kind];
              const Icon = meta.icon;
              const result = results[kind];
              return (
                <div
                  key={kind}
                  style={{
                    border: '1px solid var(--line)',
                    borderTop: `3px solid ${meta.color}`,
                    borderRadius: 14,
                    background: 'var(--surface)',
                    padding: 14,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 10,
                  }}
                >
                  <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
                    <div
                      className="stat-icon"
                      style={{ background: `${meta.color}18`, color: meta.color, width: 34, height: 34, flexShrink: 0 }}
                    >
                      <Icon size={17} />
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div className="bold">{meta.title}</div>
                      <div className="small muted" style={{ lineHeight: 1.45 }}>{meta.description}</div>
                    </div>
                  </div>

                  <div className="small faint mono truncate">{template.filename}</div>

                  <div className="row wrap" style={{ gap: 8 }}>
                    <Button
                      size="sm"
                      variant="secondary"
                      icon={<Download size={14} />}
                      onClick={() => downloadTemplate(template.filename, template.sheet, template.headers, template.sample)}
                    >
                      Plantilla
                    </Button>
                    <label
                      className="btn btn-secondary btn-sm"
                      style={{ cursor: busy ? 'wait' : 'pointer', margin: 0 }}
                    >
                      {busy === kind ? <span className="spinner" /> : <Upload size={14} />}
                      Importar
                      <input
                        type="file"
                        accept=".xlsx,.xls,.csv"
                        style={{ display: 'none' }}
                        disabled={busy !== null}
                        onChange={(e) => {
                          void handleFile(kind, e.target.files?.[0]);
                          e.target.value = '';
                        }}
                      />
                    </label>
                  </div>

                  {result && (
                    <div style={{ display: 'grid', gap: 6 }}>
                      <div className="row wrap" style={{ gap: 6 }}>
                        <Badge tone="ok">{result.created} creados</Badge>
                        <Badge tone="info">{result.updated} actualizados</Badge>
                        <Badge tone={result.skipped > 0 ? 'warn' : 'muted'}>{result.skipped} omitidos</Badge>
                      </div>
                      {result.errors.length > 0 && (
                        <div
                          className="small"
                          style={{
                            background: 'var(--warn-soft)',
                            color: 'var(--warn)',
                            borderRadius: 8,
                            padding: '8px 10px',
                            display: 'grid',
                            gap: 3,
                          }}
                        >
                          <span className="row" style={{ gap: 6 }}>
                            <AlertTriangle size={13} /> Observaciones
                          </span>
                          {result.errors.slice(0, 5).map((error, index) => (
                            <span key={index}>• {error}</span>
                          ))}
                          {result.errors.length > 5 && <span>+{result.errors.length - 5} más…</span>}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
        <div className="table-foot">
          <span>
            <CheckCircle2 size={13} style={{ verticalAlign: -2, marginRight: 4 }} />
            Las importaciones crean o actualizan registros por código (SKU, código BOM o máquina) y quedan en auditoría.
          </span>
        </div>
      </Card>

      <Card>
        <CardHead
          title="Exportar datos actuales"
          subtitle="Catálogos y reportes operativos en Excel"
          icon={<Download size={18} color="var(--brand-3)" />}
        />
        <div className="card-pad" style={{ display: 'grid', gap: 12 }}>
          <div className="meta-label">Catálogos</div>
          <div className="row wrap" style={{ gap: 8 }}>
            <Button variant="secondary" icon={<Package size={15} />} onClick={exportProducts}>
              Productos ({products.length})
            </Button>
            <Button variant="secondary" icon={<Layers size={15} />} onClick={exportBoms}>
              BOM ({boms.length})
            </Button>
            <Button variant="secondary" icon={<Factory size={15} />} onClick={exportMachines}>
              Máquinas ({machines.length})
            </Button>
          </div>

          <div className="meta-label" style={{ marginTop: 6 }}>Reportes operativos</div>
          <div className="row wrap" style={{ gap: 8 }}>
            <Button variant="secondary" icon={<FileSpreadsheet size={15} />} onClick={exportProduction}>
              Producción diaria ({records.length})
            </Button>
            <Button variant="secondary" icon={<FileSpreadsheet size={15} />} onClick={exportPnc}>
              PNC y Kaizen ({pncs.length})
            </Button>
            <Button variant="secondary" icon={<FileSpreadsheet size={15} />} onClick={exportDispatches}>
              Despachos ({dispatches.length})
            </Button>
          </div>

          <div className="small faint">
            Última carga: {records.length > 0 ? dateTime(records.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0].createdAt) : 'sin registros'}
            {' · '}Valor de inventario: {money(products.reduce((a, p) => a + Math.max(0, p.stock) * p.cost, 0))}
            {' · '}Tipos: {MACHINE_TYPES.length} máquinas
          </div>
        </div>
      </Card>
    </>
  );
}

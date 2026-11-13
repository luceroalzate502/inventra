import * as XLSX from 'xlsx';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

export interface SheetSpec {
  name: string;
  rows: Record<string, string | number | null | undefined>[];
  widths?: number[];
}

export function exportExcel(filename: string, sheets: SheetSpec[]) {
  const book = XLSX.utils.book_new();
  for (const sheet of sheets) {
    const ws = XLSX.utils.json_to_sheet(sheet.rows);
    if (sheet.widths) ws['!cols'] = sheet.widths.map((w) => ({ wch: w }));
    XLSX.utils.book_append_sheet(book, ws, sheet.name.slice(0, 31));
  }
  XLSX.writeFile(book, filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`);
}

export function exportCsv(filename: string, rows: Record<string, string | number | null | undefined>[]) {
  const ws = XLSX.utils.json_to_sheet(rows);
  const csv = XLSX.utils.sheet_to_csv(ws, { FS: ';' });
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export interface PdfSpec {
  filename: string;
  title: string;
  subtitle?: string;
  company: string;
  columns: string[];
  rows: (string | number)[][];
  landscape?: boolean;
  user?: string;
  totals?: string[];
}

export function exportPdf(spec: PdfSpec) {
  const doc = new jsPDF({
    orientation: spec.landscape ? 'landscape' : 'portrait',
    unit: 'pt',
    format: 'a4',
  });
  const pageWidth = doc.internal.pageSize.getWidth();

  doc.setFillColor(14, 46, 58);
  doc.rect(0, 0, pageWidth, 64, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(14);
  doc.text(spec.company, 40, 28);
  doc.setFontSize(8.5);
  doc.setTextColor(190, 214, 214);
  doc.text('Sistema de gestión integral de inventarios · INVENTRA', 40, 45);

  doc.setTextColor(15, 23, 42);
  doc.setFontSize(15);
  doc.text(spec.title, 40, 92);
  if (spec.subtitle) {
    doc.setFontSize(9);
    doc.setTextColor(100, 116, 139);
    doc.text(spec.subtitle, 40, 108);
  }

  const generated = new Date().toLocaleString('es-CO');
  doc.setFontSize(8);
  doc.setTextColor(100, 116, 139);
  doc.text(`Generado: ${generated}${spec.user ? ` · ${spec.user}` : ''}`, pageWidth - 40, 92, {
    align: 'right',
  });

  autoTable(doc, {
    head: [spec.columns],
    body: spec.rows,
    startY: 122,
    margin: { left: 40, right: 40 },
    styles: { fontSize: 7.6, cellPadding: 5, textColor: [30, 41, 59], lineColor: [226, 232, 240], lineWidth: 0.5 },
    headStyles: { fillColor: [14, 92, 99], textColor: 255, fontStyle: 'bold', fontSize: 7.8 },
    alternateRowStyles: { fillColor: [246, 249, 251] },
    didDrawPage: () => {
      const pages = doc.getNumberOfPages();
      doc.setFontSize(7.5);
      doc.setTextColor(148, 163, 184);
      doc.text(
        `Página ${doc.getCurrentPageInfo().pageNumber} de ${pages}`,
        pageWidth - 40,
        doc.internal.pageSize.getHeight() - 20,
        { align: 'right' },
      );
      doc.text('Documento generado automáticamente — INVENTRA', 40, doc.internal.pageSize.getHeight() - 20);
    },
  });

  if (spec.totals?.length) {
    const lastY = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY;
    const y = (lastY ?? 140) + 22;
    doc.setFontSize(9);
    doc.setTextColor(15, 23, 42);
    spec.totals.forEach((line, i) => doc.text(line, 40, y + i * 13));
  }

  doc.save(spec.filename.endsWith('.pdf') ? spec.filename : `${spec.filename}.pdf`);
}

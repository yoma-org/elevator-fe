import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

export interface YearlyMatrixResponse {
  equipment: {
    code: string;
    type: string;
    building_name: string;
    team: string | null;
    category: string | null;
  };
  range: { startYear: number; startMonth: number; endYear: number; endMonth: number };
  months: Array<{ year: number; month: number }>;
  legend: Record<string, string>;
  categories: Array<{
    category: string;
    items: Array<{ label: string; statuses: Record<string, string> }>;
  }>;
}

const pad = (n: number) => String(n).padStart(2, "0");

export function downloadYearlyMmprPdf(data: YearlyMatrixResponse): void {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const mx = 8;
  const contentW = pageW - mx * 2;

  const GREEN: [number, number, number] = [0, 100, 60];
  const LIGHT_GREEN: [number, number, number] = [223, 243, 230];
  const GRAY: [number, number, number] = [110, 110, 110];

  // ── Header bar ──
  doc.setFillColor(...GREEN);
  doc.rect(0, 0, pageW, 18, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(12);
  doc.setFont("helvetica", "bold");
  doc.text(`YEARLY MMPR — ${data.equipment.type} ${data.equipment.code}`, pageW / 2, 8, { align: "center" });
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  const sub = [
    data.equipment.building_name,
    data.equipment.team ? `Team ${data.equipment.team}` : null,
    data.equipment.category,
  ].filter(Boolean).join("  •  ");
  doc.text(sub, pageW / 2, 14, { align: "center" });

  doc.setTextColor(30, 30, 30);

  // ── Legend ──
  let y = 22;
  doc.setFontSize(8);
  doc.setFont("helvetica", "bold");
  doc.text("Legend:", mx, y);
  doc.setFont("helvetica", "normal");
  doc.text("Good = v      Adjusted = o      Repair or Replace = X      N/A = -", mx + 14, y);
  y += 4;

  // ── Build header rows ──
  // Row 1: Year headers (span multiple month columns)
  // Row 2: Month numbers
  // Row 3: Category / Item rows in body
  const months = data.months;

  // Group contiguous months by year for row 1
  const yearGroups: Array<{ year: number; count: number }> = [];
  for (const mm of months) {
    const last = yearGroups[yearGroups.length - 1];
    if (last && last.year === mm.year) last.count += 1;
    else yearGroups.push({ year: mm.year, count: 1 });
  }

  const firstColLabel = "Item";
  const yearHeaderRow: any[] = [{ content: firstColLabel, rowSpan: 2, styles: { valign: "middle", halign: "left", fontStyle: "bold" } }];
  for (const g of yearGroups) {
    yearHeaderRow.push({ content: String(g.year), colSpan: g.count, styles: { halign: "center", fontStyle: "bold" } });
  }
  const monthHeaderRow = months.map((mm) => ({ content: String(mm.month), styles: { halign: "center" } }));

  // Precompute column widths
  const totalCols = months.length;
  const itemColW = Math.min(72, Math.max(50, contentW - totalCols * 8));
  const monthColW = (contentW - itemColW) / totalCols;

  // Build body rows: category separators + items
  const body: any[] = [];
  for (const cat of data.categories) {
    // Category header row (full width bold)
    body.push([
      {
        content: cat.category,
        colSpan: 1 + totalCols,
        styles: {
          fontStyle: "bold",
          fillColor: LIGHT_GREEN,
          textColor: GREEN,
          halign: "left",
          fontSize: 8,
          cellPadding: 1.8,
        },
      } as any,
    ]);
    for (const item of cat.items ?? []) {
      const row: any[] = [{ content: item.label, styles: { fontStyle: "normal", halign: "left" } }];
      for (const mm of months) {
        const key = `${mm.year}-${pad(mm.month)}`;
        const sym = item.statuses?.[key] ?? "";
        const color: [number, number, number] =
          sym === "v" ? [0, 130, 60] :
          sym === "o" ? [200, 120, 0] :
          sym === "x" ? [200, 30, 30] :
          sym === "-" ? GRAY :
          GRAY;
        row.push({
          content: sym,
          styles: {
            halign: "center",
            textColor: color,
            fontStyle: sym === "x" ? "bold" : "normal",
          },
        });
      }
      body.push(row);
    }
  }

  // Column styles
  const columnStyles: Record<number, any> = { 0: { cellWidth: itemColW, fontSize: 7.5 } };
  for (let i = 1; i <= totalCols; i++) columnStyles[i] = { cellWidth: monthColW, halign: "center", fontSize: 8 };

  autoTable(doc, {
    startY: y,
    head: [yearHeaderRow, monthHeaderRow],
    body,
    theme: "grid",
    headStyles: {
      fillColor: GREEN,
      textColor: 255,
      fontSize: 8,
      fontStyle: "bold",
      halign: "center",
      valign: "middle",
      cellPadding: 1.5,
    },
    styles: { fontSize: 7.5, cellPadding: 1.2, lineColor: [200, 200, 200], lineWidth: 0.1 },
    columnStyles,
    margin: { left: mx, right: mx },
  });

  // Footer
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setDrawColor(...GREEN);
    doc.setLineWidth(0.4);
    doc.line(mx, pageH - 10, pageW - mx, pageH - 10);
    doc.setFontSize(7);
    doc.setTextColor(...GRAY);
    doc.text(`Yearly MMPR — ${data.equipment.code} @ ${data.equipment.building_name}`, mx, pageH - 6);
    doc.text(`Generated: ${new Date().toLocaleString()}`, pageW / 2, pageH - 6, { align: "center" });
    doc.text(`Page ${i} / ${pageCount}`, pageW - mx, pageH - 6, { align: "right" });
  }

  const filename = `MMPR_Yearly_${data.equipment.code || "equipment"}_${data.range.startYear}-${data.range.endYear}.pdf`;
  doc.save(filename);
}

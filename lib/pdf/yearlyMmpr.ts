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
  stats: {
    totalVisits: number;
    firstVisit: string | null;
    lastVisit: string | null;
  };
}

const pad = (n: number) => String(n).padStart(2, "0");
const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const [datePart] = iso.split("T");
  const [y, m, d] = datePart.split("-").map(Number);
  return `${String(d).padStart(2, "0")} ${MONTH_NAMES[m - 1]} ${y}`;
}

function fmtPeriod(r: { startYear: number; startMonth: number; endYear: number; endMonth: number }): string {
  return `${MONTH_NAMES[r.startMonth - 1]} ${r.startYear} – ${MONTH_NAMES[r.endMonth - 1]} ${r.endYear}`;
}

/** Count distinct months that have at least one item with a non-empty checklist status. */
function monthsWithChecklist(data: YearlyMatrixResponse): number {
  const months = new Set<string>();
  for (const cat of data.categories ?? []) {
    for (const item of cat.items ?? []) {
      for (const [monthKey, sym] of Object.entries(item.statuses ?? {})) {
        if (sym && sym.trim() !== "") months.add(monthKey);
      }
    }
  }
  return months.size;
}

function buildYearlyMmprDoc(data: YearlyMatrixResponse): jsPDF {
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

  // ── General Information ──
  let y = 22;
  const genInfoLabelStyles = {
    fontStyle: "bold" as const,
    fillColor: LIGHT_GREEN,
    textColor: GRAY,
    cellWidth: 26,
  };
  autoTable(doc, {
    startY: y,
    body: [
      [
        { content: "Building", styles: genInfoLabelStyles },
        data.equipment.building_name || "—",
        { content: "Lift No.", styles: genInfoLabelStyles },
        data.equipment.code || "—",
        { content: "Team", styles: genInfoLabelStyles },
        data.equipment.team ?? "—",
      ],
      [
        { content: "Equipment Type", styles: genInfoLabelStyles },
        data.equipment.type || "—",
        { content: "Category", styles: genInfoLabelStyles },
        data.equipment.category ?? "—",
        { content: "Period", styles: genInfoLabelStyles },
        fmtPeriod(data.range),
      ],
      [
        { content: "Total Month", styles: genInfoLabelStyles },
        String(monthsWithChecklist(data)),
        { content: "First Maintenance", styles: genInfoLabelStyles },
        fmtDate(data.stats.firstVisit),
        { content: "Latest Maintenance", styles: genInfoLabelStyles },
        fmtDate(data.stats.lastVisit),
      ],
    ],
    theme: "grid",
    styles: { fontSize: 8, cellPadding: 2.5, lineColor: [200, 200, 200], lineWidth: 0.1 },
    margin: { left: mx, right: mx },
  });
  y = (doc as any).lastAutoTable.finalY + 5;

  // ── Legend ──
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

  return doc;
}

function makeFilename(data: YearlyMatrixResponse): string {
  return `MMPR_Yearly_${data.equipment.code || "equipment"}_${data.range.startYear}-${data.range.endYear}.pdf`;
}

export function downloadYearlyMmprPdf(data: YearlyMatrixResponse): void {
  const doc = buildYearlyMmprDoc(data);
  doc.save(makeFilename(data));
}

/** Build a blob URL for the MMPR PDF — caller is responsible for window navigation. */
export function buildYearlyMmprBlobUrl(data: YearlyMatrixResponse): string {
  const doc = buildYearlyMmprDoc(data);
  return String(doc.output("bloburl"));
}

/**
 * Open the MMPR PDF in a new browser tab (read-only view, never download).
 *
 * IMPORTANT: This calls `window.open` AFTER awaiting data, so it can be
 * blocked by the browser's pop-up policy. Prefer the click-handler pattern:
 *   const win = window.open("about:blank", "_blank");      // sync, with user gesture
 *   const data = await fetchData();
 *   win.location.href = buildYearlyMmprBlobUrl(data);
 */
export function openYearlyMmprPdf(data: YearlyMatrixResponse): void {
  const blobUrl = buildYearlyMmprBlobUrl(data);
  const win = window.open(blobUrl, "_blank", "noopener,noreferrer");
  if (!win) {
    alert("Pop-up blocked. Please allow pop-ups for this site to view the MMPR PDF in a new tab.");
  }
}

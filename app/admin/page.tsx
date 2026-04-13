"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import * as XLSX from "xlsx";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import BatchUploadModal from "../../components/BatchUploadModal";
import { useAdminSession } from "../../lib/admin-session-context";
import { can, visibleStatuses, NEXT_STATUS } from "../../lib/permissions";

// ─── useDebounce hook ─────────────────────────────────────────────────────────
function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001/api";

// ─── CSS animations (injected once) ───────────────────────────────────────────

const ANIM_STYLES = `
  @keyframes fadeIn   { from { opacity:0 } to { opacity:1 } }
  @keyframes slideUp  { from { opacity:0; transform:translateY(18px) scale(.97) } to { opacity:1; transform:translateY(0) scale(1) } }
  @keyframes shimmer  { 0%{background-position:-400px 0} 100%{background-position:400px 0} }
  @keyframes pulse2   { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:.6;transform:scale(.95)} }
  @keyframes toastIn  { from{opacity:0;transform:translateY(12px)} to{opacity:1;transform:translateY(0)} }
  @keyframes toastOut { from{opacity:1;transform:translateY(0)} to{opacity:0;transform:translateY(12px)} }
  @keyframes spinArc  { to{transform:rotate(360deg)} }
  .card-hover { transition: box-shadow .18s, transform .18s, border-color .18s; }
  .card-hover:hover { box-shadow:0 6px 24px rgba(0,0,0,.09); transform:translateY(-2px); border-color:#4ade80 !important; }
  .btn-green { transition: background-color .15s, transform .1s, box-shadow .15s; }
  .btn-green:hover { background-color:#15643c !important; box-shadow:0 3px 10px rgba(26,122,74,.35); }
  .btn-green:active { transform:scale(.97); }
  .overlay-fade { animation: fadeIn .18s ease; }
  .modal-slide { animation: slideUp .22s cubic-bezier(.22,.61,.36,1) both; }
  .skeleton { background: linear-gradient(90deg,#f0f0f0 25%,#e0e0e0 50%,#f0f0f0 75%); background-size:400px 100%; animation:shimmer 1.4s infinite linear; border-radius:6px; }
  .active-pulse { animation: pulse2 2s ease-in-out infinite; }
  .filter-pill { display:inline-flex; align-items:center; gap:4px; padding:2px 8px 2px 10px; border-radius:9999px; font-size:11px; font-weight:600; background:#f0fdf4; color:#166534; border:1px solid #bbf7d0; transition:all .15s; }
  .filter-pill:hover { background:#dcfce7; border-color:#86efac; }
  .filter-pill button { display:flex; align-items:center; justify-content:center; width:16px; height:16px; border-radius:50%; background:transparent; transition:background .12s; }
  .filter-pill button:hover { background:rgba(22,101,52,.12); }
  .priority-bar { position:absolute; left:0; top:0; bottom:0; width:3px; border-radius:3px 0 0 3px; }
  .table-row { transition: background .12s; }
  .table-row:hover { background:#f9fafb; }
`;

// ─── types ─────────────────────────────────────────────────────────────────────

interface WorkOrder {
  id: string; building: string; equipment_code: string; equipment_type: string;
  status: string; maintenance_type: string; technician_name: string;
  arrival_date_time: string; findings: string | null; work_performed: string | null;
  parts_used: Array<{ name: string; quantity: number; status?: 'replaced' | 'needs-replacement' }> | null;
  priority: string; submitted_at: string; created_at: string;
}

interface WorkOrderDetail extends WorkOrder {
  building_id: string; equipmentId: string;
  checklist_results: { equipment_type: string | null; templateName?: string | null; checkedCount: number; totalCount: number;
    categories: Array<{ category: string; items: Array<{ label: string; checked: boolean; status?: string }> }> } | null;
  remarks: string | null;
  internal_notes: Array<{ id: string; at: string; author: string; kind: string; text: string }> | null;
  photos: Array<{ name: string; mimeType: string; size: number; dataUrl: string }> | null;
  technician_signature: string | null;
  customer_signature: string | null;
  assigned_to: string | null; updated_at: string;
}

interface Stats { myQueue: number; projectsThisMonth: number; activeJobs: number; avgResponseTimeMin: number; avgWorkDurationHrs: number; }
interface BuildingItem { id: string; name: string; }
interface EquipmentItem { id: string; equipment_code: string; equipment_type: string; location: string | null; }

// ─── status config ─────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<string, { label: string; bg: string; text: string; dot?: string }> = {
  scheduled:      { label: "SCHEDULED",         bg: "#f3f4f6", text: "#374151", dot: "#9ca3af" },
  received:       { label: "CBS RECEIVED",       bg: "#fef9c3", text: "#713f12", dot: "#ca8a04" },
  "pc-review":    { label: "PC REVIEW",          bg: "#dbeafe", text: "#1e40af", dot: "#3b82f6" },
  "comm-review":  { label: "COMMERCIAL REVIEW",  bg: "#ede9fe", text: "#5b21b6", dot: "#8b5cf6" },
  "invoice-ready":{ label: "INVOICE READY",      bg: "#cffafe", text: "#155e75", dot: "#06b6d4" },
  closed:         { label: "CLOSED",             bg: "#d1fae5", text: "#065f46", dot: "#10b981" },
  // legacy aliases kept for existing DB records
  pending:        { label: "PC REVIEW",           bg: "#dbeafe", text: "#1e40af", dot: "#3b82f6" },
  "in-progress":  { label: "PC REVIEW",          bg: "#dbeafe", text: "#1e40af", dot: "#3b82f6" },
  active:         { label: "PC REVIEW",          bg: "#dbeafe", text: "#1e40af", dot: "#3b82f6" },
  completed:      { label: "PC REVIEW",          bg: "#dbeafe", text: "#1e40af", dot: "#3b82f6" },
  "commercial-review": { label: "COMMERCIAL REVIEW", bg: "#ede9fe", text: "#5b21b6", dot: "#8b5cf6" },
  cancelled:      { label: "CANCELLED",          bg: "#fee2e2", text: "#991b1b", dot: "#ef4444" },
};
function getStatusCfg(s: string) { return STATUS_CONFIG[s] ?? { label: s.toUpperCase(), bg: "#f3f4f6", text: "#374151", dot: "#9ca3af" }; }

// ─── PDF Report Generator ─────────────────────────────────────────────────────

function downloadReportPdf(d: WorkOrderDetail, mmprResponse?: { mmpr: any; reports: any[] }) {
  const doc = new jsPDF({ orientation: "landscape" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const mx = 10; // margin x
  const contentW = pageW - mx * 2;
  let y = 8;

  const GREEN: [number, number, number] = [0, 100, 60];
  const DARK: [number, number, number] = [30, 30, 30];
  const GRAY: [number, number, number] = [100, 100, 100];
  const LIGHT_GREEN: [number, number, number] = [230, 245, 235];

  // ── Helper: section title ──
  function sectionTitle(num: string, title: string) {
    if (y > pageH - 25) { doc.addPage(); y = 10; }
    doc.setFillColor(...GREEN);
    doc.rect(mx, y, contentW, 7, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    doc.text(`${num}. ${title}`, mx + 3, y + 5);
    y += 9;
    doc.setTextColor(...DARK);
  }

  // ── Helper: status symbol ──
  function statusSymbol(status?: string): string {
    if (!status) return "—";
    const s = status.toLowerCase();
    if (s.includes("good")) return "\u2713";   // ✓
    if (s.includes("adjust")) return "O";
    if (s.includes("repair")) return "X";
    if (s.includes("na")) return "N/A";
    return status;
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // HEADER
  // ═══════════════════════════════════════════════════════════════════════════════
  doc.setFillColor(...GREEN);
  doc.rect(0, 0, pageW, 22, "F");

  // Company name
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(14);
  doc.setFont("helvetica", "bold");
  doc.text("YOMA ELEVATOR", mx + 2, 9);
  doc.setFontSize(8);
  doc.setFont("helvetica", "normal");
  doc.text("Yoma Elevator Co., Ltd.", mx + 2, 15);

  // Title centered
  doc.setFontSize(13);
  doc.setFont("helvetica", "bold");
  doc.text("MAINTENANCE MANAGEMENT PLANNING RECORD", pageW / 2, 10, { align: "center" });

  // Report code + status right
  doc.setFontSize(11);
  doc.text(d.id ?? "", pageW - mx - 2, 9, { align: "right" });
  doc.setFontSize(8);
  doc.setFont("helvetica", "normal");
  doc.text(getStatusCfg(d.status).label, pageW - mx - 2, 15, { align: "right" });

  // Thin accent line
  doc.setFillColor(0, 180, 100);
  doc.rect(0, 22, pageW, 1.2, "F");

  y = 27;

  // ═══════════════════════════════════════════════════════════════════════════════
  // 1. EQUIPMENT INFORMATION
  // ═══════════════════════════════════════════════════════════════════════════════
  sectionTitle("1", "Equipment Information");

  autoTable(doc, {
    startY: y,
    body: [
      ["ELE Type", d.equipment_type ?? "—", "Report Code", d.id ?? "—", "Status", getStatusCfg(d.status).label],
      ["Building", d.building ?? "—", "Car / Lift No.", d.equipment_code ?? "—", "Priority", d.priority ?? "—"],
      ["Maintenance Type", d.maintenance_type ?? "—", "Technician", d.technician_name ?? "—", "Assigned To", d.assigned_to ?? "—"],
      ["Arrival Date", d.arrival_date_time ? fmtDate(d.arrival_date_time) : "—", "Arrival Time", d.arrival_date_time ? fmtTime(d.arrival_date_time) : "—", "Submitted", d.submitted_at ? fmtDate(d.submitted_at) : "—"],
    ],
    theme: "grid",
    styles: { fontSize: 8, cellPadding: 2.5 },
    columnStyles: {
      0: { fontStyle: "bold", cellWidth: 30, textColor: GRAY, fillColor: LIGHT_GREEN },
      1: { cellWidth: 60 },
      2: { fontStyle: "bold", cellWidth: 30, textColor: GRAY, fillColor: LIGHT_GREEN },
      3: { cellWidth: 60 },
      4: { fontStyle: "bold", cellWidth: 28, textColor: GRAY, fillColor: LIGHT_GREEN },
      5: { cellWidth: 52 },
    },
    margin: { left: mx, right: mx },
  });
  y = (doc as any).lastAutoTable.finalY + 6;

  // ═══════════════════════════════════════════════════════════════════════════════
  // 2. PARTS REPLACEMENT RECORD
  // ═══════════════════════════════════════════════════════════════════════════════
  if (d.parts_used && d.parts_used.length > 0) {
    sectionTitle("2", "Parts Replacement Record");

    autoTable(doc, {
      startY: y,
      head: [["No.", "Name of Part", "Qty", "Status", "Replaced By", "Date"]],
      body: d.parts_used.map((p, i) => [
        String(i + 1),
        p.name,
        String(p.quantity),
        p.status === "needs-replacement" ? "Needs Replacement" : "Replaced",
        d.technician_name ?? "—",
        d.arrival_date_time ? fmtDate(d.arrival_date_time) : "—",
      ]),
      theme: "grid",
      headStyles: { fillColor: GREEN, textColor: 255, fontSize: 8, fontStyle: "bold" },
      styles: { fontSize: 8, cellPadding: 2.5 },
      columnStyles: {
        0: { cellWidth: 12, halign: "center" },
        1: { cellWidth: 80 },
        2: { cellWidth: 16, halign: "center" },
        3: { cellWidth: 38 },
        4: { cellWidth: 40 },
        5: { cellWidth: 30, halign: "center" },
      },
      didParseCell: (data: any) => {
        if (data.section === "body" && data.column.index === 3 && data.cell.text[0] === "Needs Replacement") {
          data.cell.styles.textColor = [180, 83, 9];
          data.cell.styles.fontStyle = "bold";
        }
      },
      margin: { left: mx, right: mx },
    });
    y = (doc as any).lastAutoTable.finalY + 6;
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 3. MAINTENANCE RECORD (Checklist)
  // ═══════════════════════════════════════════════════════════════════════════════
  if (d.checklist_results && d.checklist_results.categories.length > 0) {
    const cr = d.checklist_results;
    sectionTitle("3", `Maintenance Record — Checklist (${cr.checkedCount}/${cr.totalCount})`);

    // Legend
    doc.setFontSize(7);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...GRAY);
    doc.text("Good (\u2713)    Adjusted (O)    Repair (X)    N/A    — Not checked", mx + 3, y);
    y += 5;

    const checkRows: (string | { content: string; styles?: Record<string, unknown> })[][] = [];
    let rowNum = 0;

    cr.categories.forEach(cat => {
      // Category header row
      checkRows.push([{ content: cat.category.toUpperCase(), styles: { fontStyle: "bold" as const, fillColor: [240, 248, 240] as [number, number, number], colSpan: 4 } }, "", "", ""]);
      cat.items.forEach(item => {
        rowNum++;
        const sym = statusSymbol(item.status);
        const symColor: [number, number, number] =
          sym === "\u2713" ? [0, 130, 60] :
          sym === "O" ? [200, 120, 0] :
          sym === "X" ? [200, 30, 30] :
          [120, 120, 120];
        checkRows.push([
          String(rowNum),
          item.label,
          { content: sym, styles: { textColor: symColor, fontStyle: "bold" as const, halign: "center" as const, fontSize: 10 } },
          item.status ? item.status.charAt(0).toUpperCase() + item.status.slice(1) : "—",
        ]);
      });
    });

    autoTable(doc, {
      startY: y,
      head: [["No.", "Item", "Result", "Status"]],
      body: checkRows,
      theme: "grid",
      headStyles: { fillColor: GREEN, textColor: 255, fontSize: 8, fontStyle: "bold" },
      styles: { fontSize: 7.5, cellPadding: 2 },
      columnStyles: {
        0: { cellWidth: 12, halign: "center" },
        1: { cellWidth: 160 },
        2: { cellWidth: 18, halign: "center" },
        3: { cellWidth: 35 },
      },
      margin: { left: mx, right: mx },
    });
    y = (doc as any).lastAutoTable.finalY + 6;
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 4. FINDINGS & WORK PERFORMED
  // ═══════════════════════════════════════════════════════════════════════════════
  if (d.findings || d.work_performed) {
    sectionTitle("4", "Findings & Work Performed");

    const rows: string[][] = [];
    if (d.findings) rows.push(["Findings", d.findings]);
    if (d.work_performed) rows.push(["Work Performed", d.work_performed]);

    autoTable(doc, {
      startY: y,
      body: rows,
      theme: "grid",
      styles: { fontSize: 8, cellPadding: 3 },
      columnStyles: {
        0: { fontStyle: "bold", cellWidth: 35, textColor: GRAY, fillColor: LIGHT_GREEN },
        1: { cellWidth: contentW - 35 },
      },
      margin: { left: mx, right: mx },
    });
    y = (doc as any).lastAutoTable.finalY + 6;
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // 5. REMARKS
  // ═══════════════════════════════════════════════════════════════════════════════
  if (d.remarks) {
    sectionTitle("5", "Remarks");

    autoTable(doc, {
      startY: y,
      body: [[d.remarks]],
      theme: "grid",
      styles: { fontSize: 8, cellPadding: 3 },
      margin: { left: mx, right: mx },
    });
    y = (doc as any).lastAutoTable.finalY + 6;
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // MMPR SECTIONS (6-11) — only if mmprResponse provided
  // ═══════════════════════════════════════════════════════════════════════════════
  const mmpr = mmprResponse?.mmpr;
  let sectionNum = 6;

  // 6. Break Armature Gap
  if (mmpr?.break_armature_gap?.length > 0) {
    sectionTitle(String(sectionNum), "Break Armature Gap Setting Value");
    autoTable(doc, {
      startY: y,
      head: [["Item", "Standard Value", "Checked Value", "Date", "Checked By"]],
      body: mmpr.break_armature_gap.map((r: any) => [r.item ?? "", r.standardValue ?? "", r.checkedValue ?? "", r.date ?? "", r.checkedBy ?? ""]),
      theme: "grid",
      headStyles: { fillColor: GREEN, textColor: 255, fontSize: 8, fontStyle: "bold" },
      styles: { fontSize: 8, cellPadding: 2.5 },
      margin: { left: mx, right: mx },
    });
    y = (doc as any).lastAutoTable.finalY + 6;
    sectionNum++;
  }

  // 7. Rope Investigation
  if (mmpr?.rope_investigation?.length > 0) {
    sectionTitle(String(sectionNum), "Rope Investigation Result");
    autoTable(doc, {
      startY: y,
      head: [["Sheave Position", "Ropes Checked", "Result", "Date", "Checked By"]],
      body: mmpr.rope_investigation.map((r: any) => [r.sheavePosition ?? "", r.ropesChecked ?? "", r.result ?? "", r.checkedDate ?? "", r.checkedBy ?? ""]),
      theme: "grid",
      headStyles: { fillColor: GREEN, textColor: 255, fontSize: 8, fontStyle: "bold" },
      styles: { fontSize: 8, cellPadding: 2.5 },
      margin: { left: mx, right: mx },
    });
    y = (doc as any).lastAutoTable.finalY + 6;
    sectionNum++;
  }

  // 8. Work Instructions
  if (mmpr?.work_instructions?.length > 0) {
    sectionTitle(String(sectionNum), "Work Instruction in Regular Service Periods");
    autoTable(doc, {
      startY: y,
      head: [["No.", "Date", "Name", "Item", "Contents"]],
      body: mmpr.work_instructions.map((r: any, i: number) => [String(i + 1), r.date ?? "", r.name ?? "", r.item ?? "", r.contents ?? ""]),
      theme: "grid",
      headStyles: { fillColor: GREEN, textColor: 255, fontSize: 8, fontStyle: "bold" },
      styles: { fontSize: 8, cellPadding: 2.5 },
      columnStyles: { 0: { cellWidth: 12, halign: "center" } },
      margin: { left: mx, right: mx },
    });
    y = (doc as any).lastAutoTable.finalY + 6;
    sectionNum++;
  }

  // 9. Work Details
  if (mmpr?.work_details?.length > 0) {
    sectionTitle(String(sectionNum), "Work Details in Regular Service Periods");
    autoTable(doc, {
      startY: y,
      head: [["No.", "Date", "Name", "Item", "Contents"]],
      body: mmpr.work_details.map((r: any, i: number) => [String(i + 1), r.date ?? "", r.name ?? "", r.item ?? "", r.contents ?? ""]),
      theme: "grid",
      headStyles: { fillColor: GREEN, textColor: 255, fontSize: 8, fontStyle: "bold" },
      styles: { fontSize: 8, cellPadding: 2.5 },
      columnStyles: { 0: { cellWidth: 12, halign: "center" } },
      margin: { left: mx, right: mx },
    });
    y = (doc as any).lastAutoTable.finalY + 6;
    sectionNum++;
  }

  // 10. Major Repairs
  if (mmpr?.major_repairs?.length > 0) {
    sectionTitle(String(sectionNum), "Major Repair Works Record");
    autoTable(doc, {
      startY: y,
      head: [["No.", "Date", "Work Done By", "Checked By", "Details of Works Carried Out", "Remarks"]],
      body: mmpr.major_repairs.map((r: any, i: number) => [String(i + 1), r.date ?? "", r.workDoneBy ?? "", r.checkedBy ?? "", r.details ?? "", r.remarks ?? ""]),
      theme: "grid",
      headStyles: { fillColor: GREEN, textColor: 255, fontSize: 8, fontStyle: "bold" },
      styles: { fontSize: 8, cellPadding: 2.5 },
      columnStyles: { 0: { cellWidth: 12, halign: "center" } },
      margin: { left: mx, right: mx },
    });
    y = (doc as any).lastAutoTable.finalY + 6;
    sectionNum++;
  }

  // 11. Call Back Records
  if (mmpr?.call_back_records?.length > 0) {
    sectionTitle(String(sectionNum), "Call Back Record");
    autoTable(doc, {
      startY: y,
      head: [["No.", "Date", "PIC", "Checked By", "Received", "Arrived", "Completion", "Trouble Found", "Action Taken"]],
      body: mmpr.call_back_records.map((r: any, i: number) => [String(i + 1), r.date ?? "", r.pic ?? "", r.checkedBy ?? "", r.received ?? "", r.arrived ?? "", r.completion ?? "", r.troubleFound ?? "", r.actionTaken ?? ""]),
      theme: "grid",
      headStyles: { fillColor: GREEN, textColor: 255, fontSize: 8, fontStyle: "bold" },
      styles: { fontSize: 7, cellPadding: 2 },
      columnStyles: { 0: { cellWidth: 10, halign: "center" } },
      margin: { left: mx, right: mx },
    });
    y = (doc as any).lastAutoTable.finalY + 6;
    sectionNum++;
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // SIGNATURES
  // ═══════════════════════════════════════════════════════════════════════════════
  if (d.technician_signature || d.customer_signature) {
    sectionTitle(String(sectionNum), "Signatures");

    const sigW = 70;
    const sigH = 25;
    const colW = contentW / 2;

    // Signature boxes
    const leftX = mx;
    const rightX = mx + colW;

    // Technician signature (left)
    doc.setDrawColor(200, 200, 200);
    doc.setLineWidth(0.3);
    doc.rect(leftX, y, colW - 4, sigH + 14);
    doc.setFontSize(8);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...GRAY);
    doc.text("Technician Signature", leftX + 3, y + 5);
    if (d.technician_signature) {
      try { doc.addImage(d.technician_signature, "PNG", leftX + (colW - 4 - sigW) / 2, y + 8, sigW, sigH); } catch {}
    }
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.text(d.technician_name ?? "", leftX + 3, y + sigH + 11);

    // Customer signature (right)
    doc.rect(rightX, y, colW - 4, sigH + 14);
    doc.setFontSize(8);
    doc.setFont("helvetica", "bold");
    doc.text("Customer Signature", rightX + 3, y + 5);
    if (d.customer_signature) {
      try { doc.addImage(d.customer_signature, "PNG", rightX + (colW - 4 - sigW) / 2, y + 8, sigW, sigH); } catch {}
    }

    y += sigH + 20;
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // FOOTER on every page
  // ═══════════════════════════════════════════════════════════════════════════════
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    // Bottom line
    doc.setDrawColor(...GREEN);
    doc.setLineWidth(0.5);
    doc.line(mx, pageH - 12, pageW - mx, pageH - 12);
    // Footer text
    doc.setFontSize(7);
    doc.setTextColor(...GRAY);
    doc.text(`MMPR — ${d.id ?? ""} — ${d.building ?? ""}`, mx, pageH - 8);
    doc.text(`Generated: ${new Date().toLocaleString()}`, pageW / 2, pageH - 8, { align: "center" });
    doc.text(`Page ${i} / ${pageCount}`, pageW - mx, pageH - 8, { align: "right" });
  }

  doc.save(`MMPR_${d.id ?? "unknown"}_${new Date().toISOString().slice(0, 10)}.pdf`);
}

function fmtDate(iso: string) { if (!iso) return "-"; const d = new Date(iso); return `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}/${d.getFullYear()}`; }
function fmtTime(iso: string) { if (!iso) return "-"; const d = new Date(iso); return `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`; }

// ─── Toast ─────────────────────────────────────────────────────────────────────

interface ToastMsg { id: number; text: string; kind: "success" | "error"; }

function Toast({ msg, onDone }: { msg: ToastMsg; onDone: () => void }) {
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    const t1 = setTimeout(() => setLeaving(true), 2800);
    const t2 = setTimeout(() => onDone(), 3200);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [onDone]);
  return (
    <div
      style={{
        animation: leaving ? "toastOut .35s ease forwards" : "toastIn .25s ease",
        backgroundColor: msg.kind === "success" ? "#15803d" : "#dc2626",
      }}
      className="flex items-center gap-2 text-white text-sm font-medium px-4 py-3 rounded-lg shadow-lg min-w-[220px]"
    >
      <span>{msg.kind === "success" ? "✓" : "✕"}</span>
      <span>{msg.text}</span>
    </div>
  );
}

function ToastContainer({ toasts, remove }: { toasts: ToastMsg[]; remove: (id: number) => void }) {
  if (!toasts.length) return null;
  return (
    <div className="fixed bottom-6 right-6 z-[100] flex flex-col gap-2 items-end">
      {toasts.map(m => <Toast key={m.id} msg={m} onDone={() => remove(m.id)} />)}
    </div>
  );
}

// ─── AnimatedNumber ────────────────────────────────────────────────────────────

function AnimatedNumber({ target }: { target: number }) {
  const [display, setDisplay] = useState(0);
  const raf = useRef<number>(0);
  const start = useRef<number | null>(null);
  const from = useRef(0);
  const dur = 600;

  useEffect(() => {
    from.current = display;
    start.current = null;
    const step = (ts: number) => {
      if (!start.current) start.current = ts;
      const p = Math.min((ts - start.current) / dur, 1);
      const ease = 1 - Math.pow(1 - p, 3);
      setDisplay(Math.round(from.current + (target - from.current) * ease));
      if (p < 1) raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  return <>{display}</>;
}

// ─── Stat Icons (SVG) ─────────────────────────────────────────────────────────

const STAT_ICONS: Record<string, { svg: ReactNode; bg: string; iconBg: string; iconColor: string }> = {
  queue: {
    bg: "linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%)",
    iconBg: "#bbf7d0", iconColor: "#166534",
    svg: <svg width="18" height="18" viewBox="0 0 20 20" fill="none"><rect x="3" y="3" width="14" height="14" rx="2" stroke="currentColor" strokeWidth="1.5"/><path d="M7 7h6M7 10h6M7 13h4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>,
  },
  projects: {
    bg: "linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%)",
    iconBg: "#bfdbfe", iconColor: "#1e40af",
    svg: <svg width="18" height="18" viewBox="0 0 20 20" fill="none"><rect x="2" y="4" width="16" height="13" rx="2" stroke="currentColor" strokeWidth="1.5"/><path d="M2 7h16M6 2v4M14 2v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>,
  },
  active: {
    bg: "linear-gradient(135deg, #fef2f2 0%, #fee2e2 100%)",
    iconBg: "#fecaca", iconColor: "#991b1b",
    svg: <svg width="18" height="18" viewBox="0 0 20 20" fill="none"><path d="M3 10h3l2-5 4 10 2-5h3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  },
  response: {
    bg: "linear-gradient(135deg, #fefce8 0%, #fef9c3 100%)",
    iconBg: "#fde68a", iconColor: "#92400e",
    svg: <svg width="18" height="18" viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="7.5" stroke="currentColor" strokeWidth="1.5"/><path d="M10 5.5v5l3.5 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>,
  },
  duration: {
    bg: "linear-gradient(135deg, #fdf4ff 0%, #f3e8ff 100%)",
    iconBg: "#e9d5ff", iconColor: "#6b21a8",
    svg: <svg width="18" height="18" viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="7.5" stroke="currentColor" strokeWidth="1.5"/><path d="M10 6v4.5h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/><path d="M15 3l2 2M5 3L3 5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>,
  },
};

// ─── StatCard ──────────────────────────────────────────────────────────────────

function StatCard({ iconKey, label, value, unit, ok, active, onClick }: { iconKey: string; label: string; value: string | number; unit?: string; ok?: boolean; active?: boolean; onClick?: () => void; }) {
  const isNum = typeof value === "number";
  const cfg = STAT_ICONS[iconKey] ?? STAT_ICONS.queue;
  return (
    <div
      className={`flex-1 rounded-xl px-5 py-4 border min-w-0 card-hover ${onClick ? "cursor-pointer" : ""}`}
      style={{
        animation: "slideUp .3s ease both",
        background: active ? "linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%)" : cfg.bg,
        borderColor: active ? "#16a34a" : "rgba(0,0,0,.06)",
        boxShadow: active ? "0 0 0 2px rgba(22,163,74,.25)" : "0 1px 3px rgba(0,0,0,.04)",
      }}
      onClick={onClick}
    >
      <div className="flex items-center gap-2.5 mb-3">
        <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: active ? "#bbf7d0" : cfg.iconBg, color: active ? "#166534" : cfg.iconColor }}>
          {cfg.svg}
        </div>
        <span className={`text-xs font-semibold uppercase tracking-wide ${active ? "text-green-700" : "text-gray-500"}`}>{label}</span>
      </div>
      <div className="flex items-baseline gap-1">
        <span className={`text-3xl font-bold ${active ? "text-green-700" : "text-gray-800"}`}>
          {isNum ? <AnimatedNumber target={value as number} /> : value}
        </span>
        {unit && <span className="text-sm font-semibold text-gray-400 uppercase ml-1">{unit}</span>}
        {ok !== undefined && (
          <span className="ml-auto">
            {ok
              ? <span className="inline-flex items-center gap-1 text-[10px] font-bold text-green-700 bg-green-100 px-2 py-0.5 rounded-full">OK</span>
              : <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full">WARN</span>
            }
          </span>
        )}
      </div>
    </div>
  );
}

// ─── StatusBadge ──────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const cfg = getStatusCfg(status);
  return (
    <span
      className="text-xs font-bold px-2.5 py-1 rounded-full whitespace-nowrap flex items-center gap-1.5"
      style={{ backgroundColor: cfg.bg, color: cfg.text }}
    >
      {cfg.dot && <span style={{ width: 6, height: 6, borderRadius: "50%", backgroundColor: cfg.dot, display: "inline-block", flexShrink: 0 }} />}
      {cfg.label}
    </span>
  );
}

// ─── SkeletonCard ──────────────────────────────────────────────────────────────

function SkeletonCard() {
  return (
    <div className="bg-white rounded-lg border border-gray-100 p-4 space-y-3">
      <div className="flex justify-between items-center">
        <div className="skeleton h-4 w-32" />
        <div className="skeleton h-5 w-24 rounded-full" />
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-2">
        {[1,2,3,4].map(i => <div key={i} className="skeleton h-3 w-full" />)}
      </div>
      <div className="grid grid-cols-2 gap-x-4">
        <div className="skeleton h-3 w-4/5" />
        <div className="skeleton h-3 w-4/5" />
      </div>
      <div className="skeleton h-3 w-full" />
      <div className="skeleton h-3 w-3/4" />
      <div className="skeleton h-7 w-24 rounded mt-1" />
    </div>
  );
}

// ─── WorkOrderCard ─────────────────────────────────────────────────────────────

const PRIORITY_COLORS: Record<string, { bar: string; bg: string; text: string }> = {
  Urgent: { bar: "#dc2626", bg: "#fef2f2", text: "#991b1b" },
  High:   { bar: "#f97316", bg: "#fff7ed", text: "#9a3412" },
  Medium: { bar: "#eab308", bg: "#fefce8", text: "#854d0e" },
  Low:    { bar: "#6b7280", bg: "#f9fafb", text: "#374151" },
};

function WorkOrderCard({ order, onClick, index }: { order: WorkOrder; onClick: () => void; index: number; }) {
  const prio = PRIORITY_COLORS[order.priority] ?? PRIORITY_COLORS.Medium;
  const isHighPrio = order.priority === "High" || order.priority === "Urgent";
  return (
    <div
      onClick={onClick}
      className="bg-white rounded-xl border border-gray-200 p-4 card-hover cursor-pointer group relative overflow-hidden"
      style={{ animation: `slideUp .25s ${index * 0.04}s ease both` }}
    >
      {/* Priority color bar */}
      <div className="priority-bar" style={{ backgroundColor: prio.bar }} />

      {/* Header: code + status */}
      <div className="flex items-center justify-between mb-3 gap-2 pl-1">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="text-sm font-bold text-gray-800 font-mono tracking-tight truncate">{order.id ?? "—"}</span>
          <span className="hidden sm:inline text-[10px] text-gray-400 font-medium px-1.5 py-0.5 bg-gray-100 rounded">{order.equipment_type}</span>
        </div>
        <div className="flex items-center gap-2">
          {isHighPrio && (
            <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full flex items-center gap-1" style={{ backgroundColor: prio.bg, color: prio.text }}>
              <svg width="10" height="10" viewBox="0 0 12 12" fill="none"><path d="M6 1l1.5 3.2L11 4.8 8.5 7.2l.6 3.8L6 9.2 2.9 11l.6-3.8L1 4.8l3.5-.6z" fill="currentColor"/></svg>
              {order.priority}
            </span>
          )}
          <StatusBadge status={order.status} />
        </div>
      </div>

      {/* Info grid */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs mb-3 pl-1">
        <div className="flex items-center gap-1.5">
          <svg width="11" height="11" viewBox="0 0 12 12" fill="none" className="text-gray-400 shrink-0"><path d="M2 2h8v8H2z" stroke="currentColor" strokeWidth="1.1"/><path d="M4 1v2M8 1v2M2 5h8" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round"/></svg>
          <span className="text-gray-700 font-medium">{order.building}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <svg width="11" height="11" viewBox="0 0 12 12" fill="none" className="text-gray-400 shrink-0"><rect x="3" y="1" width="6" height="10" rx="1" stroke="currentColor" strokeWidth="1.1"/><path d="M5 8h2" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round"/></svg>
          <span className="text-gray-700 font-medium">{order.equipment_code}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <svg width="11" height="11" viewBox="0 0 12 12" fill="none" className="text-gray-400 shrink-0"><circle cx="6" cy="4" r="2.5" stroke="currentColor" strokeWidth="1.1"/><path d="M1.5 11c0-2.5 2-4.5 4.5-4.5s4.5 2 4.5 4.5" stroke="currentColor" strokeWidth="1.1"/></svg>
          <span className="text-gray-700 font-medium">{order.technician_name}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <svg width="11" height="11" viewBox="0 0 12 12" fill="none" className="text-gray-400 shrink-0"><circle cx="6" cy="6" r="5" stroke="currentColor" strokeWidth="1.1"/><path d="M6 3v3.5l2.5 1.5" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round"/></svg>
          <span className="text-gray-700 font-medium">{fmtDate(order.arrival_date_time)} {fmtTime(order.arrival_date_time)}</span>
        </div>
      </div>

      {/* Maintenance type tag */}
      <div className="flex items-center gap-2 mb-3 pl-1">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-500 bg-gray-100 px-2 py-0.5 rounded">{order.maintenance_type}</span>
      </div>

      {/* Findings preview */}
      {order.findings && (
        <p className="text-xs text-gray-500 mb-3 line-clamp-2 leading-relaxed border-l-2 border-gray-200 pl-2.5">{order.findings}</p>
      )}

      {/* Needs Replacement indicator */}
      {order.parts_used?.some(p => p.status === "needs-replacement") && (
        <div className="flex items-center gap-1.5 mb-3 pl-1 py-1.5 px-2.5 rounded-lg bg-amber-50 border border-amber-200">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M8 1L1 14h14L8 1z" stroke="#d97706" strokeWidth="1.3" strokeLinejoin="round"/><path d="M8 6v3.5M8 12v.5" stroke="#d97706" strokeWidth="1.3" strokeLinecap="round"/></svg>
          <span className="text-[10px] font-bold text-amber-700 uppercase tracking-wide">Parts Need Replacement</span>
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between pt-2 border-t border-gray-100 pl-1">
        <span className="text-[10px] text-gray-400">{order.submitted_at ? `Submitted ${fmtDate(order.submitted_at)}` : ""}</span>
        <span className="text-xs text-green-700 font-medium opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1">
          View details
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M3.5 2L7 5l-3.5 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>
        </span>
      </div>
    </div>
  );
}

// ─── AddProjectModal ───────────────────────────────────────────────────────────

function AddProjectModal({ onClose, onCreated, token }: { onClose: () => void; onCreated: (msg: string) => void; token?: string | null }) {
  const [buildings, setBuildings] = useState<BuildingItem[]>([]);
  const [equipment, setEquipment] = useState<EquipmentItem[]>([]);
  const [building_id, setBuildingId] = useState("");
  const [equipmentId, setEquipmentId] = useState("");
  const [calledPerson, setCalledPerson] = useState("");
  const [calledTime, setCalledTime] = useState("");
  const [issue, setIssue] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch(`${API_BASE}/equipment/buildings`).then(r => r.json()).then(res => setBuildings(res?.data ?? res)).catch(console.error);
  }, []);

  useEffect(() => {
    if (!building_id) { setEquipment([]); setEquipmentId(""); return; }
    fetch(`${API_BASE}/equipment/by-building?building_id=${building_id}`).then(r => r.json()).then(res => { setEquipment(res?.data ?? res); setEquipmentId(""); }).catch(console.error);
  }, [building_id]);

  async function handleSubmit(e: { preventDefault(): void }) {
    e.preventDefault();
    setError("");
    if (!building_id || !equipmentId || !calledPerson || !calledTime || !issue) { setError("Please fill in all required fields."); return; }
    setSubmitting(true);
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const res = await fetch(`${API_BASE}/maintenance-reports/admin/cbs-call`, {
        method: "POST", headers,
        body: JSON.stringify({ building_id, equipmentId, calledPerson, calledTime, issue }),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d?.message ?? "Failed to create CBS Call"); }
      const data = await res.json();
      onCreated(`CBS Call created: ${data.report_code}`);
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  const inputCls = "w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm outline-none transition-all focus:border-green-600 focus:ring-2 focus:ring-green-100";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 overlay-fade" style={{ backgroundColor: "rgba(0,0,0,0.45)" }} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-slide bg-white rounded-xl shadow-2xl w-full max-w-lg overflow-hidden">
        <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100">
          <h2 className="text-base font-bold uppercase tracking-wide text-gray-800">Add New CBS Call</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 transition-colors p-1 rounded hover:bg-gray-100">
            <svg width="18" height="18" viewBox="0 0 20 20" fill="none"><path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1.5">Building Name <span className="text-red-500">*</span></label>
            <select value={building_id} onChange={e => setBuildingId(e.target.value)} className={inputCls} style={{ borderColor: building_id ? "#16a34a" : undefined }}>
              <option value="">Select building...</option>
              {buildings.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1.5">Lift No. <span className="text-red-500">*</span></label>
            <select value={equipmentId} onChange={e => setEquipmentId(e.target.value)} disabled={!building_id} className={`${inputCls} disabled:opacity-50 disabled:cursor-not-allowed`}>
              <option value="">Select lift...</option>
              {equipment.map(eq => <option key={eq.id} value={eq.id}>{eq.equipment_code}{eq.location ? ` — ${eq.location}` : ""}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1.5">Called Person <span className="text-red-500">*</span></label>
            <input type="text" name="calledPerson" value={calledPerson} onChange={e => setCalledPerson(e.target.value)} placeholder="e.g., U Tin Maung" className={inputCls} />
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1.5">Called Time <span className="text-red-500">*</span></label>
            <input type="datetime-local" name="calledTime" value={calledTime} onChange={e => setCalledTime(e.target.value)} className={inputCls} />
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1.5">Issue Description <span className="text-red-500">*</span></label>
            <textarea name="issue" value={issue} onChange={e => setIssue(e.target.value)} placeholder="Describe the issue reported..." rows={3} className={`${inputCls} resize-none`} />
          </div>

          {error && (
            <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              <span>⚠</span><span>{error}</span>
            </div>
          )}

          <div className="flex gap-3 pt-1">
            <button type="submit" disabled={submitting} className="btn-green flex-1 py-3 rounded-lg text-sm font-bold text-white flex items-center justify-center gap-2 disabled:opacity-60 shadow-sm active:scale-[.97] transition-all" style={{ backgroundColor: "#1a7a4a" }}>
              {submitting
                ? <><svg width="14" height="14" viewBox="0 0 14 14" style={{ animation: "spinArc .7s linear infinite" }}><circle cx="7" cy="7" r="5" fill="none" stroke="rgba(255,255,255,.4)" strokeWidth="2"/><path d="M7 2A5 5 0 0 1 12 7" stroke="white" strokeWidth="2" strokeLinecap="round" fill="none"/></svg>Creating...</>
                : <><svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 7.5l3.5 3.5L12 3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>Create CBS Call</>
              }
            </button>
            <button type="button" onClick={onClose} className="px-5 py-3 rounded-lg text-sm font-medium text-gray-600 border border-gray-200 hover:bg-gray-50 hover:border-gray-300 active:scale-[.97] transition-all">Cancel</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Section / InfoRow ─────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <h3 className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-3 flex items-center gap-2">
        <span className="flex-1 border-t border-gray-100" />
        {title}
        <span className="flex-1 border-t border-gray-100" />
      </h3>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-2 gap-2 text-sm py-1 border-b border-gray-50 last:border-0">
      <span className="text-gray-400 uppercase text-xs font-semibold tracking-wide">{label}</span>
      <span className="text-gray-800 font-medium">{value || "—"}</span>
    </div>
  );
}

// ─── NoteForm ─────────────────────────────────────────────────────────────────

function NoteForm({ code, onAdded, token, authorName }: { code: string; onAdded: (note: { id: string; at: string; author: string; kind: string; text: string }) => void; token?: string | null; authorName?: string }) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);

  const author = authorName ?? "ADMIN";

  const handleSubmit = async () => {
    if (!text.trim()) return;
    setSending(true);
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Bearer ${token}`;
      await fetch(`${API_BASE}/maintenance-reports/admin/${code}/notes`, {
        method: "POST",
        headers,
        body: JSON.stringify({ text: text.trim(), kind: "dispatch", author }),
      });
      const newNote = { id: crypto.randomUUID(), at: new Date().toISOString(), author, kind: "dispatch", text: text.trim() };
      onAdded(newNote);
      setText("");
    } catch { /* ignore */ } finally {
      setSending(false);
    }
  };

  return (
    <div className="rounded-xl border border-gray-200 bg-gray-50 p-3">
      <textarea
        className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none resize-none focus:border-green-500 focus:ring-2 focus:ring-green-100 transition-all"
        rows={2}
        placeholder="Add a note..."
        value={text}
        onChange={e => setText(e.target.value)}
        onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey && text.trim()) { e.preventDefault(); handleSubmit(); } }}
      />
      <div className="flex items-center gap-2 mt-2">
        <button
          onClick={handleSubmit}
          disabled={sending || !text.trim()}
          className="ml-auto text-xs font-semibold px-4 py-1.5 rounded-lg text-white disabled:opacity-50 transition-all active:scale-95"
          style={{ backgroundColor: "#1a7a4a" }}
        >
          {sending ? "Sending..." : "Add Note"}
        </button>
      </div>
    </div>
  );
}

// ─── MmprSection ──────────────────────────────────────────────────────────────

function MmprSection({ title, children, onAdd }: { title: string; children: React.ReactNode; onAdd: () => void }) {
  return (
    <div className="rounded-xl border border-gray-200 overflow-hidden">
      <div className="flex items-center justify-between bg-gray-50 px-4 py-2.5 border-b border-gray-200">
        <h4 className="text-xs font-bold text-gray-600 uppercase tracking-wider">{title}</h4>
        <button onClick={onAdd} className="text-xs rounded-lg px-2.5 py-1 bg-green-50 hover:bg-green-100 text-green-700 font-semibold transition-all flex items-center gap-1">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M6 2v8M2 6h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
          Add
        </button>
      </div>
      <div className="p-3 space-y-2">
        {Array.isArray(children) && (children as any[]).length === 0 ? (
          <p className="text-xs text-gray-400 text-center py-3">No records yet. Click Add to start.</p>
        ) : (children as any)?.length === 0 || !children ? (
          <p className="text-xs text-gray-400 text-center py-3">No records yet. Click Add to start.</p>
        ) : children}
      </div>
    </div>
  );
}

// ─── DetailModal ───────────────────────────────────────────────────────────────

function DetailModal({ code, onClose, onStatusChange, onToast, onDetailUpdated, role, token, userName }: {
  code: string; onClose: () => void;
  onStatusChange: (code: string, status: string) => void;
  onToast: (msg: string, kind: "success" | "error") => void;
  onDetailUpdated?: () => void;
  role?: string;
  token?: string | null;
  userName?: string;
}) {
  const [detail, setDetail] = useState<WorkOrderDetail | null>(null);
  const [tab, setTab] = useState<"info" | "notes" | "mmpr">("info");
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [lightbox, setLightbox] = useState<{ index: number; photos: Array<{ dataUrl: string; name: string }> } | null>(null);
  const [equipmentList, setEquipmentList] = useState<EquipmentItem[]>([]);
  const [editEquipmentId, setEditEquipmentId] = useState("");

  // MMPR state
  const [mmprData, setMmprData] = useState<{ mmpr: any; reports: any[] } | null>(null);
  const [mmprYear, setMmprYear] = useState(new Date().getFullYear());
  const [mmprSaving, setMmprSaving] = useState(false);
  const [mmprDraft, setMmprDraft] = useState<Record<string, any>>({});

  const editableStatuses = ["pc-review", "comm-review", "pending", "completed", "commercial-review"];
  const isEditable = detail ? editableStatuses.includes(detail.status) : false;

  const authHeaders: Record<string, string> = token ? { "Authorization": `Bearer ${token}` } : {};

  useEffect(() => {
    setDetail(null);
    setEditing(false);
    fetch(`${API_BASE}/maintenance-reports/admin/${code}`, { headers: authHeaders }).then(r => r.json()).then(setDetail).catch(console.error);
  }, [code]);

  function startEditing() {
    if (!detail) return;
    setEditEquipmentId(detail.equipmentId);
    fetch(`${API_BASE}/equipment/by-building?building_id=${detail.building_id}`, { headers: authHeaders })
      .then(r => r.json())
      .then(res => { const list = res?.data ?? res; setEquipmentList(Array.isArray(list) ? list : []); })
      .catch(() => setEquipmentList([]));
    setEditing(true);
  }

  const selectedEquipment = equipmentList.find(e => e.id === editEquipmentId);
  const hasChanges = detail && editEquipmentId !== detail.equipmentId;

  async function handleSaveEdit() {
    if (!hasChanges) return;
    setSaving(true);
    try {
      const res = await fetch(`${API_BASE}/maintenance-reports/admin/${code}`, {
        method: "PATCH", headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify({ equipmentId: editEquipmentId }),
      });
      if (!res.ok) throw new Error("Failed to save");
      const updated = await fetch(`${API_BASE}/maintenance-reports/admin/${code}`, { headers: authHeaders }).then(r => r.json());
      setDetail(updated);
      setEditing(false);
      onToast("Equipment updated successfully", "success");
      onDetailUpdated?.();
    } catch {
      onToast("Failed to update details", "error");
    } finally {
      setSaving(false);
    }
  }

  async function handleStatusChange(status: string) {
    setSaving(true);
    try {
      await fetch(`${API_BASE}/maintenance-reports/admin/${code}/status`, { method: "PATCH", headers: { "Content-Type": "application/json", ...authHeaders }, body: JSON.stringify({ status }) });
      onStatusChange(code, status);
      if (detail) setDetail({ ...detail, status });
      setEditing(false);
      onToast(`Status updated to ${getStatusCfg(status).label}`, "success");
    } catch {
      onToast("Failed to update status", "error");
    } finally {
      setSaving(false);
    }
  }

  // Fetch MMPR data when tab switches to mmpr
  useEffect(() => {
    if (tab !== "mmpr" || !detail) return;
    setMmprData(null);
    fetch(`${API_BASE}/mmpr/${detail.equipmentId}?year=${mmprYear}`, { headers: authHeaders })
      .then(r => r.json())
      .then(d => { setMmprData(d); setMmprDraft({ break_armature_gap: d.mmpr.break_armature_gap ?? [], rope_investigation: d.mmpr.rope_investigation ?? [], work_instructions: d.mmpr.work_instructions ?? [], work_details: d.mmpr.work_details ?? [], major_repairs: d.mmpr.major_repairs ?? [], call_back_records: d.mmpr.call_back_records ?? [] }); })
      .catch(console.error);
  }, [tab, detail?.equipmentId, mmprYear]);

  async function handleMmprSave() {
    if (!detail) return;
    setMmprSaving(true);
    try {
      await fetch(`${API_BASE}/mmpr/${detail.equipmentId}?year=${mmprYear}`, {
        method: "PUT", headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify(mmprDraft),
      });
      onToast("MMPR data saved", "success");
      // Refresh
      const d = await fetch(`${API_BASE}/mmpr/${detail.equipmentId}?year=${mmprYear}`, { headers: authHeaders }).then(r => r.json());
      setMmprData(d);
    } catch {
      onToast("Failed to save MMPR data", "error");
    } finally {
      setMmprSaving(false);
    }
  }

  // Helper to update a JSONB array field in mmprDraft
  function updateMmprRow(field: string, index: number, value: Record<string, unknown>) {
    setMmprDraft(prev => {
      const arr = [...(prev[field] ?? [])];
      arr[index] = { ...arr[index], ...value };
      return { ...prev, [field]: arr };
    });
  }
  function addMmprRow(field: string, template: Record<string, unknown>) {
    setMmprDraft(prev => ({ ...prev, [field]: [...(prev[field] ?? []), template] }));
  }
  function removeMmprRow(field: string, index: number) {
    setMmprDraft(prev => ({ ...prev, [field]: (prev[field] ?? []).filter((_: unknown, i: number) => i !== index) }));
  }

  const editInputCls = "w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none transition-all focus:border-green-600 focus:ring-2 focus:ring-green-100 resize-none";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 overlay-fade" style={{ backgroundColor: "rgba(0,0,0,0.45)" }} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-slide bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
        <div style={{ backgroundColor: "#1a3a2a" }} className="px-6 py-4 flex items-center justify-between flex-shrink-0">
          <h2 className="text-white font-bold text-base tracking-wide font-mono">{code}</h2>
          <div className="flex items-center gap-3">
            {detail && (
              <>
                <span className="text-xs rounded px-2 py-1 bg-white/20 text-white font-semibold">
                  {getStatusCfg(detail.status).label}
                </span>
                {can(role, detail.status, "download") && (
                  <button
                    onClick={async () => {
                      try {
                        const mmpr = await fetch(`${API_BASE}/mmpr/${detail.equipmentId}?year=${new Date(detail.arrival_date_time).getFullYear()}`, { headers: authHeaders }).then(r => r.json());
                        downloadReportPdf(detail, mmpr);
                        onToast("MMPR generated", "success");
                      } catch { downloadReportPdf(detail); onToast("MMPR generated (without MMPR data)", "success"); }
                    }}
                    className="text-xs rounded-lg px-3.5 py-1.5 bg-white/20 hover:bg-white/30 border border-white/30 text-white font-semibold transition-all flex items-center gap-1.5 hover:scale-[1.03] active:scale-95"
                  >
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M3.5 1.75h4.375L11.5 5.375v6.875a1 1 0 01-1 1h-6a1 1 0 01-1-1v-10a1 1 0 011-1z" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/><path d="M7.875 1.75v3.625H11.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                    Generate MMPR
                  </button>
                )}
                {can(role, detail.status, "approve") && NEXT_STATUS[detail.status as keyof typeof NEXT_STATUS] && (
                  <button
                    onClick={() => handleStatusChange(NEXT_STATUS[detail.status as keyof typeof NEXT_STATUS])}
                    disabled={saving}
                    className="text-xs rounded px-3 py-1 bg-green-500 hover:bg-green-400 text-white font-semibold transition-all disabled:opacity-50"
                  >
                    {saving ? "..." : `Approve → ${getStatusCfg(NEXT_STATUS[detail.status as keyof typeof NEXT_STATUS]).label}`}
                  </button>
                )}
              </>
            )}
            <button onClick={onClose} className="text-white hover:text-gray-300 ml-1 p-1 rounded hover:bg-white/10 transition-colors">
              <svg width="18" height="18" viewBox="0 0 20 20" fill="none"><path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
            </button>
          </div>
        </div>

        <div className="flex border-b border-gray-200 flex-shrink-0">
          {(["info", "notes", "mmpr"] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-6 py-3 text-sm font-medium transition-all relative flex items-center gap-2 ${tab === t ? "text-green-700" : "text-gray-500 hover:text-gray-700"}`}>
              {t === "info" ? (
                <><svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.2"/><path d="M7 5v1M7 7.5v3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>Details</>
              ) : t === "notes" ? (
                <><svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 3h10v7H5l-3 2V3z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/><path d="M5 6h4M5 8h2" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/></svg>Activity
                {detail && detail.internal_notes && detail.internal_notes.length > 0 && (
                  <span className="text-[10px] font-bold bg-gray-100 text-gray-500 rounded-full px-1.5 py-0.5 min-w-[20px] text-center">{detail.internal_notes.length}</span>
                )}
                </>
              ) : (
                <><svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M3.5 1.75h4.375L11.5 5.375v6.875a1 1 0 01-1 1h-6a1 1 0 01-1-1v-10a1 1 0 011-1z" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/><path d="M7.875 1.75v3.625H11.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/></svg>MMPR</>
              )}
              {tab === t && <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-green-700 rounded-t" style={{ animation: "fadeIn .15s ease" }} />}
            </button>
          ))}
        </div>

        <div className="overflow-y-auto flex-1 p-6">
          {!detail ? (
            <div className="space-y-3 py-2">
              {[1,2,3,4,5].map(i => <div key={i} className="skeleton h-4 w-full" style={{ width: `${70 + i * 5}%` }} />)}
            </div>
          ) : tab === "info" ? (
            <div className="space-y-5" style={{ animation: "fadeIn .2s ease" }}>
              {/* Status timeline */}
              <div className="flex items-center gap-0 overflow-x-auto pb-2 -mx-1">
                {(["received", "pc-review", "comm-review", "invoice-ready", "closed"] as const).map((s, i, arr) => {
                  const cfg = getStatusCfg(s);
                  const statusOrder = ["scheduled", "received", "pc-review", "comm-review", "invoice-ready", "closed"];
                  const currentIdx = statusOrder.indexOf(detail.status);
                  const thisIdx = statusOrder.indexOf(s);
                  const isPast = thisIdx < currentIdx;
                  const isCurrent = thisIdx === currentIdx;
                  return (
                    <div key={s} className="flex items-center flex-shrink-0">
                      <div className="flex flex-col items-center gap-1 px-1">
                        <div
                          className="w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-bold transition-all"
                          style={{
                            backgroundColor: isCurrent ? cfg.bg : isPast ? "#d1fae5" : "#f3f4f6",
                            color: isCurrent ? cfg.text : isPast ? "#065f46" : "#9ca3af",
                            border: isCurrent ? `2px solid ${cfg.dot}` : "2px solid transparent",
                            boxShadow: isCurrent ? `0 0 0 3px ${cfg.bg}` : "none",
                          }}
                        >
                          {isPast ? <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M2 5l2.5 2.5L8 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg> : (i + 1)}
                        </div>
                        <span className={`text-[8px] font-semibold uppercase tracking-wide whitespace-nowrap ${isCurrent ? "text-gray-800" : isPast ? "text-green-700" : "text-gray-400"}`}>
                          {cfg.label.length > 10 ? cfg.label.slice(0, 8) + "…" : cfg.label}
                        </span>
                      </div>
                      {i < arr.length - 1 && (
                        <div className="w-4 h-0.5 flex-shrink-0 rounded-full" style={{ backgroundColor: isPast ? "#86efac" : "#e5e7eb" }} />
                      )}
                    </div>
                  );
                })}
              </div>

              <Section title="Information">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6">
                  <InfoRow label="Report Code" value={detail.id ?? "—"} />
                  <InfoRow label="Status" value={getStatusCfg(detail.status).label} />
                  <InfoRow label="Building Name" value={detail.building} />
                  <InfoRow label="Lift No." value={detail.equipment_code} />
                  <InfoRow label="Equipment Type" value={detail.equipment_type} />
                  <InfoRow label="Maintenance Type" value={detail.maintenance_type} />
                  <InfoRow label="Technician" value={detail.technician_name} />
                  <InfoRow label="Assigned To" value={detail.assigned_to ?? "—"} />
                  <InfoRow label="Arrival Date" value={fmtDate(detail.arrival_date_time)} />
                  <InfoRow label="Arrival Time" value={fmtTime(detail.arrival_date_time)} />
                  <InfoRow label="Priority" value={detail.priority} />
                </div>
              </Section>
              <Section title="SLA Performance">
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-green-50 rounded-lg p-3 text-center">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-green-600 mb-1">Response Time</p>
                    <p className="text-lg font-bold text-green-800">45 <span className="text-xs font-semibold text-green-600">min</span></p>
                  </div>
                  <div className="bg-blue-50 rounded-lg p-3 text-center">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-blue-600 mb-1">Work Duration</p>
                    <p className="text-lg font-bold text-blue-800">2.3 <span className="text-xs font-semibold text-blue-600">hrs</span></p>
                  </div>
                </div>
              </Section>

              {editing && (
                <>
                  <Section title="Edit Equipment">
                    <div className="space-y-3">
                      <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
                        <p className="text-xs font-semibold text-gray-400 uppercase mb-1">Original</p>
                        <p className="text-sm text-gray-700">{detail.equipment_type} — {detail.equipment_code}</p>
                      </div>
                      <div>
                        <label className="block text-sm font-semibold text-gray-700 mb-1.5">New Equipment (Lift No.) <span className="text-red-500">*</span></label>
                        {equipmentList.length === 0 ? (
                          <div className="skeleton h-10 w-full" />
                        ) : (
                          <select value={editEquipmentId} onChange={e => setEditEquipmentId(e.target.value)} className={editInputCls + " bg-white"}>
                            {equipmentList.map(eq => (
                              <option key={eq.id} value={eq.id}>{eq.equipment_type} — {eq.equipment_code}{eq.location ? ` (${eq.location})` : ""}</option>
                            ))}
                          </select>
                        )}
                      </div>
                      {selectedEquipment && hasChanges && (
                        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                          <p className="text-xs font-semibold text-amber-600 uppercase mb-1">Changed to</p>
                          <p className="text-sm text-amber-800">{selectedEquipment.equipment_type} — {selectedEquipment.equipment_code}</p>
                        </div>
                      )}
                    </div>
                  </Section>
                  <div className="flex gap-3 pt-2">
                    <button onClick={handleSaveEdit} disabled={saving || !hasChanges} className="btn-green px-5 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-60" style={{ backgroundColor: "#1a7a4a" }}>
                      {saving ? "Saving..." : "Save Changes"}
                    </button>
                    <button onClick={() => setEditing(false)} disabled={saving} className="px-4 py-2 rounded-lg text-sm font-medium text-gray-600 border border-gray-200 hover:bg-gray-50">Cancel</button>
                  </div>
                </>
              )}

              {detail.findings && <Section title="Issue Description"><p className="text-sm text-gray-700 leading-relaxed">{detail.findings}</p></Section>}
              {detail.work_performed && <Section title="Action Taken"><p className="text-sm text-gray-700 leading-relaxed">{detail.work_performed}</p></Section>}
              {detail.remarks && <Section title="Remarks"><p className="text-sm text-gray-700 leading-relaxed">{detail.remarks}</p></Section>}
              {!editing && isEditable && (
                <button onClick={startEditing} className="btn-green px-4 py-2 rounded-lg text-sm font-semibold text-white flex items-center gap-1.5" style={{ backgroundColor: "#1a7a4a" }}>
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 8.5V10h1.5L9.2 4.3 7.7 2.8 2 8.5zM10.3 3.2l-1.5-1.5.7-.7 1.5 1.5-.7.7z" fill="currentColor"/></svg>
                  Edit Equipment
                </button>
              )}

              {detail.parts_used && detail.parts_used.length > 0 && (() => {
                const hasNeedsReplacement = detail.parts_used.some(p => p.status === "needs-replacement");
                return hasNeedsReplacement ? (
                  <div className="rounded-xl border-2 border-amber-400 bg-amber-50 p-4" style={{ animation: "fadeIn .3s ease" }}>
                    <div className="flex items-center gap-2 mb-3">
                      <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M9 1.5L1 16h16L9 1.5z" stroke="#d97706" strokeWidth="1.5" strokeLinejoin="round"/><path d="M9 7v3.5M9 13v.5" stroke="#d97706" strokeWidth="1.5" strokeLinecap="round"/></svg>
                      <h3 className="text-sm font-bold text-amber-800 uppercase tracking-wide">Parts — Needs Replacement</h3>
                    </div>
                    <p className="text-xs text-amber-700 mb-3">The following parts have been flagged for replacement. Please reach out to the customer with spare part quotations.</p>
                    <ul className="space-y-2">{detail.parts_used.map((p,i) => (
                      <li key={i} className={`text-sm flex items-center gap-2 rounded-lg px-3 py-2 ${
                        p.status === "needs-replacement"
                          ? "bg-amber-100 border border-amber-300 text-amber-800 font-semibold"
                          : "bg-white border border-gray-200 text-gray-700"
                      }`}>
                        {p.status === "needs-replacement" && (
                          <span className="flex-shrink-0 w-2 h-2 rounded-full bg-amber-500" />
                        )}
                        {p.name} &times; {p.quantity}
                        {p.status === "needs-replacement" && (
                          <span className="ml-auto text-[10px] font-bold text-amber-600 uppercase tracking-wide">Action Required</span>
                        )}
                      </li>
                    ))}</ul>
                  </div>
                ) : (
                  <Section title="Parts">
                    <ul className="space-y-1.5">{detail.parts_used.map((p,i) => (
                      <li key={i} className="text-sm text-gray-700">{p.name} &times; {p.quantity}</li>
                    ))}</ul>
                  </Section>
                );
              })()}
              {detail.checklist_results && (
                <Section title="Checklist Results">
                  <div className="mb-2 flex items-center gap-2">
                    <span className="text-sm text-gray-600">{detail.checklist_results.checkedCount} / {detail.checklist_results.totalCount} items checked</span>
                    <span className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                      <span className="h-full bg-green-500 rounded-full block" style={{ width: `${Math.round(detail.checklist_results.checkedCount / Math.max(detail.checklist_results.totalCount, 1) * 100)}%`, transition: "width .4s ease" }} />
                    </span>
                  </div>
                  {detail.checklist_results.categories.map((cat, ci) => (
                    <div key={ci} className="mb-3">
                      <p className="text-xs font-semibold text-gray-500 uppercase mb-1">{cat.category}</p>
                      <ul className="space-y-0.5">{cat.items.map((item, ii) => (
                        <li key={ii} className="flex items-center gap-2 text-xs text-gray-700">
                          <span>{item.checked ? "✅" : "⬜"}</span><span>{item.label}</span>
                        </li>
                      ))}</ul>
                    </div>
                  ))}
                </Section>
              )}
              {detail.photos && detail.photos.length > 0 && (
                <Section title={`Photos (${detail.photos.length})`}>
                  <div className="flex gap-3 overflow-x-auto pb-2" style={{ scrollSnapType: "x mandatory", WebkitOverflowScrolling: "touch" }}>
                    {detail.photos.map((photo, i) => (
                      <button key={i} onClick={() => setLightbox({ index: i, photos: detail.photos! })} className="group flex-shrink-0 w-36 rounded-lg overflow-hidden border border-gray-200 hover:border-green-400 transition-all hover:shadow-md text-left cursor-zoom-in" style={{ scrollSnapAlign: "start" }}>
                        <img src={photo.dataUrl} alt={photo.name} className="w-full h-28 object-cover bg-gray-50 group-hover:scale-105 transition-transform duration-200" />
                        <div className="px-2 py-1.5 bg-white">
                          <p className="text-[11px] text-gray-600 truncate">{photo.name}</p>
                          <p className="text-[10px] text-gray-400">{(photo.size / 1024).toFixed(0)} KB</p>
                        </div>
                      </button>
                    ))}
                  </div>
                </Section>
              )}
              {lightbox && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center overlay-fade" style={{ backgroundColor: "rgba(0,0,0,0.85)" }} onClick={() => setLightbox(null)}>
                  <button onClick={() => setLightbox(null)} className="absolute top-4 right-4 text-white/80 hover:text-white bg-black/40 hover:bg-black/60 rounded-full w-10 h-10 flex items-center justify-center transition-all z-10">
                    <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
                  </button>
                  <p className="absolute top-4 left-1/2 -translate-x-1/2 text-white/70 text-sm font-medium bg-black/40 px-3 py-1.5 rounded-lg whitespace-nowrap">
                    {lightbox.photos[lightbox.index].name} — {lightbox.index + 1} / {lightbox.photos.length}
                  </p>
                  {lightbox.photos.length > 1 && (
                    <>
                      <button onClick={e => { e.stopPropagation(); setLightbox(prev => prev ? { ...prev, index: (prev.index - 1 + prev.photos.length) % prev.photos.length } : null); }} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/80 hover:text-white bg-black/40 hover:bg-black/60 rounded-full w-10 h-10 flex items-center justify-center transition-all">
                        <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M11 4L6 9l5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                      </button>
                      <button onClick={e => { e.stopPropagation(); setLightbox(prev => prev ? { ...prev, index: (prev.index + 1) % prev.photos.length } : null); }} className="absolute right-3 top-1/2 -translate-y-1/2 text-white/80 hover:text-white bg-black/40 hover:bg-black/60 rounded-full w-10 h-10 flex items-center justify-center transition-all">
                        <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M7 4l5 5-5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                      </button>
                    </>
                  )}
                  <img src={lightbox.photos[lightbox.index].dataUrl} alt={lightbox.photos[lightbox.index].name} className="max-w-[90vw] max-h-[85vh] object-contain rounded-lg shadow-2xl" style={{ animation: "slideUp .2s ease" }} onClick={e => e.stopPropagation()} />
                </div>
              )}
              {(detail.technician_signature || detail.customer_signature) && (
                <Section title="Signatures">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {detail.technician_signature && (
                      <div className="border border-gray-200 rounded-lg p-3">
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-2">Technician Signature</p>
                        <img src={detail.technician_signature} alt="Technician Signature" className="w-full h-24 object-contain bg-gray-50 rounded" />
                      </div>
                    )}
                    {detail.customer_signature && (
                      <div className="border border-gray-200 rounded-lg p-3">
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-2">Customer Signature</p>
                        <img src={detail.customer_signature} alt="Customer Signature" className="w-full h-24 object-contain bg-gray-50 rounded" />
                      </div>
                    )}
                  </div>
                </Section>
              )}
            </div>
          ) : tab === "notes" ? (
            <div style={{ animation: "fadeIn .2s ease" }}>
              {/* Notes timeline */}
              <div className="space-y-0">
                {!detail.internal_notes || detail.internal_notes.length === 0
                  ? (
                    <div className="text-center py-12">
                      <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-gray-100 flex items-center justify-center">
                        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" className="text-gray-400"><path d="M4 4h12v12H4z" stroke="currentColor" strokeWidth="1.3"/><path d="M7 8h6M7 11h4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg>
                      </div>
                      <p className="text-sm text-gray-400">No activity yet.</p>
                    </div>
                  )
                  : [...detail.internal_notes].sort((a,b) => new Date(b.at).getTime() - new Date(a.at).getTime()).map((note, i, arr) => (
                    <div key={note.id} className="flex gap-3 group">
                      {/* Timeline line */}
                      <div className="flex flex-col items-center flex-shrink-0">
                        <div className="w-2.5 h-2.5 rounded-full mt-1.5 flex-shrink-0" style={{ backgroundColor: note.kind === "system" ? "#86efac" : note.kind === "dispatch" ? "#93c5fd" : note.kind === "review" ? "#c4b5fd" : "#fcd34d" }} />
                        {i < arr.length - 1 && <div className="w-0.5 flex-1 bg-gray-100 my-1" />}
                      </div>
                      {/* Content */}
                      <div className="pb-4 flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-xs font-semibold text-gray-700">{note.author}</span>
                          <span className="text-[10px] px-2 py-0.5 rounded-full font-medium" style={{
                            backgroundColor: note.kind === "system" ? "#f0fdf4" : note.kind === "dispatch" ? "#eff6ff" : note.kind === "review" ? "#f5f3ff" : "#fffbeb",
                            color: note.kind === "system" ? "#166534" : note.kind === "dispatch" ? "#1e40af" : note.kind === "review" ? "#5b21b6" : "#92400e",
                          }}>{note.kind}</span>
                          <span className="text-[10px] text-gray-400 ml-auto">{fmtDate(note.at)} {fmtTime(note.at)}</span>
                        </div>
                        <p className="text-sm text-gray-700 leading-relaxed">{note.text}</p>
                      </div>
                    </div>
                  ))
                }
              </div>
            </div>
          ) : (
            /* MMPR Tab */
            <div style={{ animation: "fadeIn .2s ease" }}>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-bold text-gray-800">MMPR Data — {detail.equipment_code}</h3>
                <div className="flex items-center gap-2">
                  <select value={mmprYear} onChange={e => setMmprYear(Number(e.target.value))} className="border border-gray-300 rounded-lg px-2 py-1 text-sm">
                    {[2024, 2025, 2026, 2027].map(yr => <option key={yr} value={yr}>{yr}</option>)}
                  </select>
                  <button onClick={handleMmprSave} disabled={mmprSaving} className="text-xs rounded-lg px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white font-semibold transition-all disabled:opacity-50">
                    {mmprSaving ? "Saving..." : "Save"}
                  </button>
                </div>
              </div>

              {!mmprData ? (
                <div className="space-y-3 py-2">{[1,2,3].map(i => <div key={i} className="skeleton h-4 w-full" style={{ width: `${60 + i * 10}%` }} />)}</div>
              ) : (
                <div className="space-y-5">
                  {/* Break Armature Gap */}
                  <MmprSection title="Break Armature Gap Setting" onAdd={() => addMmprRow("break_armature_gap", { item: "", standardValue: "", checkedValue: "", date: "", checkedBy: "" })}>
                    {(mmprDraft.break_armature_gap ?? []).map((row: any, i: number) => (
                      <div key={i} className="grid grid-cols-6 gap-2 items-center">
                        <input className={editInputCls} placeholder="Item" value={row.item ?? ""} onChange={e => updateMmprRow("break_armature_gap", i, { item: e.target.value })} />
                        <input className={editInputCls} placeholder="Standard" value={row.standardValue ?? ""} onChange={e => updateMmprRow("break_armature_gap", i, { standardValue: e.target.value })} />
                        <input className={editInputCls} placeholder="Checked" value={row.checkedValue ?? ""} onChange={e => updateMmprRow("break_armature_gap", i, { checkedValue: e.target.value })} />
                        <input className={editInputCls} type="date" value={row.date ?? ""} onChange={e => updateMmprRow("break_armature_gap", i, { date: e.target.value })} />
                        <input className={editInputCls} placeholder="Checked By" value={row.checkedBy ?? ""} onChange={e => updateMmprRow("break_armature_gap", i, { checkedBy: e.target.value })} />
                        <button onClick={() => removeMmprRow("break_armature_gap", i)} className="text-red-400 hover:text-red-600 text-xs">Remove</button>
                      </div>
                    ))}
                  </MmprSection>

                  {/* Rope Investigation */}
                  <MmprSection title="Rope Investigation Result" onAdd={() => addMmprRow("rope_investigation", { sheavePosition: "", ropesChecked: "", checkedDate: "", checkedBy: "", result: "" })}>
                    {(mmprDraft.rope_investigation ?? []).map((row: any, i: number) => (
                      <div key={i} className="grid grid-cols-6 gap-2 items-center">
                        <input className={editInputCls} placeholder="Sheave Position" value={row.sheavePosition ?? ""} onChange={e => updateMmprRow("rope_investigation", i, { sheavePosition: e.target.value })} />
                        <input className={editInputCls} placeholder="Ropes Checked" value={row.ropesChecked ?? ""} onChange={e => updateMmprRow("rope_investigation", i, { ropesChecked: e.target.value })} />
                        <input className={editInputCls} placeholder="Result" value={row.result ?? ""} onChange={e => updateMmprRow("rope_investigation", i, { result: e.target.value })} />
                        <input className={editInputCls} type="date" value={row.checkedDate ?? ""} onChange={e => updateMmprRow("rope_investigation", i, { checkedDate: e.target.value })} />
                        <input className={editInputCls} placeholder="Checked By" value={row.checkedBy ?? ""} onChange={e => updateMmprRow("rope_investigation", i, { checkedBy: e.target.value })} />
                        <button onClick={() => removeMmprRow("rope_investigation", i)} className="text-red-400 hover:text-red-600 text-xs">Remove</button>
                      </div>
                    ))}
                  </MmprSection>

                  {/* Work Instructions */}
                  <MmprSection title="Work Instruction in Regular Service" onAdd={() => addMmprRow("work_instructions", { date: "", name: "", item: "", contents: "" })}>
                    {(mmprDraft.work_instructions ?? []).map((row: any, i: number) => (
                      <div key={i} className="grid grid-cols-5 gap-2 items-center">
                        <input className={editInputCls} type="date" value={row.date ?? ""} onChange={e => updateMmprRow("work_instructions", i, { date: e.target.value })} />
                        <input className={editInputCls} placeholder="Name" value={row.name ?? ""} onChange={e => updateMmprRow("work_instructions", i, { name: e.target.value })} />
                        <input className={editInputCls} placeholder="Item" value={row.item ?? ""} onChange={e => updateMmprRow("work_instructions", i, { item: e.target.value })} />
                        <input className={editInputCls} placeholder="Contents" value={row.contents ?? ""} onChange={e => updateMmprRow("work_instructions", i, { contents: e.target.value })} />
                        <button onClick={() => removeMmprRow("work_instructions", i)} className="text-red-400 hover:text-red-600 text-xs">Remove</button>
                      </div>
                    ))}
                  </MmprSection>

                  {/* Work Details */}
                  <MmprSection title="Work Details in Regular Service" onAdd={() => addMmprRow("work_details", { date: "", name: "", item: "", contents: "" })}>
                    {(mmprDraft.work_details ?? []).map((row: any, i: number) => (
                      <div key={i} className="grid grid-cols-5 gap-2 items-center">
                        <input className={editInputCls} type="date" value={row.date ?? ""} onChange={e => updateMmprRow("work_details", i, { date: e.target.value })} />
                        <input className={editInputCls} placeholder="Name" value={row.name ?? ""} onChange={e => updateMmprRow("work_details", i, { name: e.target.value })} />
                        <input className={editInputCls} placeholder="Item" value={row.item ?? ""} onChange={e => updateMmprRow("work_details", i, { item: e.target.value })} />
                        <input className={editInputCls} placeholder="Contents" value={row.contents ?? ""} onChange={e => updateMmprRow("work_details", i, { contents: e.target.value })} />
                        <button onClick={() => removeMmprRow("work_details", i)} className="text-red-400 hover:text-red-600 text-xs">Remove</button>
                      </div>
                    ))}
                  </MmprSection>

                  {/* Major Repairs */}
                  <MmprSection title="Major Repair Works Record" onAdd={() => addMmprRow("major_repairs", { date: "", workDoneBy: "", checkedBy: "", details: "", remarks: "" })}>
                    {(mmprDraft.major_repairs ?? []).map((row: any, i: number) => (
                      <div key={i} className="grid grid-cols-6 gap-2 items-center">
                        <input className={editInputCls} type="date" value={row.date ?? ""} onChange={e => updateMmprRow("major_repairs", i, { date: e.target.value })} />
                        <input className={editInputCls} placeholder="Work Done By" value={row.workDoneBy ?? ""} onChange={e => updateMmprRow("major_repairs", i, { workDoneBy: e.target.value })} />
                        <input className={editInputCls} placeholder="Checked By" value={row.checkedBy ?? ""} onChange={e => updateMmprRow("major_repairs", i, { checkedBy: e.target.value })} />
                        <input className={editInputCls} placeholder="Details" value={row.details ?? ""} onChange={e => updateMmprRow("major_repairs", i, { details: e.target.value })} />
                        <input className={editInputCls} placeholder="Remarks" value={row.remarks ?? ""} onChange={e => updateMmprRow("major_repairs", i, { remarks: e.target.value })} />
                        <button onClick={() => removeMmprRow("major_repairs", i)} className="text-red-400 hover:text-red-600 text-xs">Remove</button>
                      </div>
                    ))}
                  </MmprSection>

                  {/* Call Back Records */}
                  <MmprSection title="Call Back Record" onAdd={() => addMmprRow("call_back_records", { date: "", pic: "", checkedBy: "", received: "", arrived: "", completion: "", troubleFound: "", actionTaken: "" })}>
                    {(mmprDraft.call_back_records ?? []).map((row: any, i: number) => (
                      <div key={i} className="space-y-2">
                        <div className="grid grid-cols-4 gap-2">
                          <input className={editInputCls} type="date" value={row.date ?? ""} onChange={e => updateMmprRow("call_back_records", i, { date: e.target.value })} />
                          <input className={editInputCls} placeholder="PIC" value={row.pic ?? ""} onChange={e => updateMmprRow("call_back_records", i, { pic: e.target.value })} />
                          <input className={editInputCls} placeholder="Checked By" value={row.checkedBy ?? ""} onChange={e => updateMmprRow("call_back_records", i, { checkedBy: e.target.value })} />
                          <button onClick={() => removeMmprRow("call_back_records", i)} className="text-red-400 hover:text-red-600 text-xs justify-self-end">Remove</button>
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                          <input className={editInputCls} placeholder="Received" value={row.received ?? ""} onChange={e => updateMmprRow("call_back_records", i, { received: e.target.value })} />
                          <input className={editInputCls} placeholder="Arrived" value={row.arrived ?? ""} onChange={e => updateMmprRow("call_back_records", i, { arrived: e.target.value })} />
                          <input className={editInputCls} placeholder="Completion" value={row.completion ?? ""} onChange={e => updateMmprRow("call_back_records", i, { completion: e.target.value })} />
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <input className={editInputCls} placeholder="Trouble Found" value={row.troubleFound ?? ""} onChange={e => updateMmprRow("call_back_records", i, { troubleFound: e.target.value })} />
                          <input className={editInputCls} placeholder="Action Taken" value={row.actionTaken ?? ""} onChange={e => updateMmprRow("call_back_records", i, { actionTaken: e.target.value })} />
                        </div>
                      </div>
                    ))}
                  </MmprSection>

                  {/* Aggregated maintenance reports for this year */}
                  {mmprData.reports.length > 0 && (
                    <div className="rounded-xl border border-gray-200 p-4">
                      <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">Service Visits in {mmprYear} ({mmprData.reports.length})</h4>
                      <div className="space-y-2">
                        {mmprData.reports.map((r: any, i: number) => (
                          <div key={i} className="flex items-center gap-3 text-xs text-gray-700 py-1.5 border-b border-gray-100 last:border-0">
                            <span className="font-mono font-bold text-green-700">{r.report_code}</span>
                            <span>{fmtDate(r.arrival_date_time)}</span>
                            <span className="text-gray-400">|</span>
                            <span>{r.technician_name}</span>
                            <span className="ml-auto"><StatusBadge status={r.status} /></span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Sticky note form at bottom — only on activity tab + if user can comment */}
        {tab === "notes" && detail && (can(role, detail.status, "comment") || can(role, detail.status, "review")) && (
          <div className="border-t border-gray-200 bg-white p-4 rounded-b-2xl">
            <NoteForm code={code} token={token} authorName={userName} onAdded={(note) => {
              setDetail(prev => prev ? { ...prev, internal_notes: [...(prev.internal_notes ?? []), note] } : prev);
              onToast("Note added", "success");
            }} />
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

export default function AdminDashboard() {
  return (
    <Suspense>
      <AdminDashboardInner />
    </Suspense>
  );
}

function AdminDashboardInner() {
  const urlSearchParams = useSearchParams();
  const initialSearch = urlSearchParams.get("search") ?? "";
  const { session, role, token } = useAdminSession();

  const [orders, setOrders] = useState<WorkOrder[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const [showAddProject, setShowAddProject] = useState(false);
  const [showBatchUpload, setShowBatchUpload] = useState(false);
  const [toasts, setToasts] = useState<ToastMsg[]>([]);
  const toastId = useRef(0);

  // Use fallback role when no session (before admin_users table is set up)
  const effectiveRole = role ?? "operation";

  const authHeaders: Record<string, string> = token ? { "Authorization": `Bearer ${token}` } : {};

  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [searchQuery, setSearchQuery] = useState(initialSearch);
  const [buildingFilter, setBuildingFilter] = useState("all");
  const [projectNameFilter, setProjectNameFilter] = useState("");
  const [partsFilter, setPartsFilter] = useState("");
  const [statsFilter, setStatsFilter] = useState<"myQueue" | "projectsThisMonth" | "activeJobs" | null>(null);
  const [viewMode, setViewMode] = useState<"card" | "table">("card");

  // Debounced search values
  const debouncedSearch = useDebounce(searchQuery, 300);
  const debouncedBuilding = useDebounce(buildingFilter, 300);
  const debouncedProject = useDebounce(projectNameFilter, 300);
  const debouncedParts = useDebounce(partsFilter, 300);

  function addToast(text: string, kind: "success" | "error" = "success") {
    const id = ++toastId.current;
    setToasts(p => [...p, { id, text, kind }]);
  }
  function removeToast(id: number) { setToasts(p => p.filter(t => t.id !== id)); }

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (fromDate) params.set("from", fromDate);
      if (toDate) params.set("to", toDate);
      if (statusFilter && statusFilter !== "all") params.set("status", statusFilter);
      const [ordersRes, statsRes] = await Promise.all([
        fetch(`${API_BASE}/maintenance-reports/admin/list?${params}`, { headers: authHeaders }),
        fetch(`${API_BASE}/maintenance-reports/admin/stats?${params}`, { headers: authHeaders }),
      ]);
      if (!ordersRes.ok) { console.error("Failed to fetch orders:", ordersRes.status); return; }
      setOrders(await ordersRes.json());
      setStats(await statsRes.json());
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [fromDate, toDate, statusFilter, token]);

  useEffect(() => { setCurrentPage(1); setStatsFilter(null); void fetchData(); }, [fetchData]);

  const uniqueBuildings = useMemo(() => [...new Set(orders.map(o => o.building).filter(Boolean))].sort(), [orders]);
  const uniqueProjectNames = useMemo(() => [...new Set(orders.map(o => o.maintenance_type).filter(Boolean))].sort(), [orders]);
  const uniqueParts = useMemo(() => {
    const names = new Set<string>();
    orders.forEach(o => o.parts_used?.forEach(p => { if (p.name.trim()) names.add(p.name.trim()); }));
    return [...names].sort();
  }, [orders]);
  const uniqueReportCodes = useMemo(() => orders.map(o => o.id).filter(Boolean).sort(), [orders]);

  const sortedOrders = useMemo(() => {
    let filtered = orders;

    if (debouncedSearch) filtered = filtered.filter(o => o.id?.toLowerCase().includes(debouncedSearch.toLowerCase()));
    if (debouncedBuilding && debouncedBuilding !== "all") {
      const q = debouncedBuilding.toLowerCase();
      filtered = filtered.filter(o => o.building?.toLowerCase().includes(q));
    }
    if (debouncedProject) {
      const q = debouncedProject.toLowerCase();
      filtered = filtered.filter(o => o.maintenance_type?.toLowerCase().includes(q) || o.id?.toLowerCase().includes(q));
    }
    if (debouncedParts) {
      const q = debouncedParts.toLowerCase();
      filtered = filtered.filter(o => o.parts_used?.some(p => p.name.toLowerCase().includes(q)));
    }

    if (statsFilter) {
      filtered = filtered.filter((o) => {
        if (statsFilter === "myQueue") return o.status !== "invoice-ready" && o.status !== "closed" && o.status !== "cancelled";
        if (statsFilter === "activeJobs") return o.status === "pc-review";
        if (statsFilter === "projectsThisMonth") {
          const now = new Date();
          const d = new Date(o.arrival_date_time);
          return d.getUTCFullYear() === now.getUTCFullYear() && d.getUTCMonth() === now.getUTCMonth();
        }
        return true;
      });
    }

    return [...filtered].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }, [orders, debouncedSearch, debouncedBuilding, debouncedProject, debouncedParts, statsFilter]);

  const totalPages = Math.max(1, Math.ceil(sortedOrders.length / pageSize));
  const paginatedOrders = sortedOrders.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  function handleStatusChange(code: string, status: string) {
    setOrders(p => p.map(o => o.id === code ? { ...o, status } : o));
  }

  const inputCls = "border border-gray-300 rounded px-2 py-1 text-sm outline-none transition-all focus:border-green-600 focus:ring-2 focus:ring-green-100";

  return (
    <>
      <style>{ANIM_STYLES}</style>

      {/* Sticky filter bar */}
      <div className="bg-white rounded-xl border border-gray-200 mb-4 sticky top-3 z-10 shadow-sm overflow-hidden">
        {/* Row 1: Date range + Status + Actions */}
        <div className="px-4 py-3 flex flex-wrap items-center gap-3 border-b border-gray-100">
          <div className="flex items-center gap-2 text-sm text-gray-700">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="text-gray-400"><rect x="1" y="2.5" width="12" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.2"/><path d="M1 5.5h12M4 1v3M10 1v3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg>
            <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} className={`${inputCls} w-[130px]`} />
            <span className="text-gray-300">—</span>
            <input type="date" value={toDate} onChange={e => setToDate(e.target.value)} className={`${inputCls} w-[130px]`} />
          </div>
          <div className="h-5 w-px bg-gray-200 hidden sm:block" />
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className={`${inputCls} bg-white`}>
            <option value="all">All Statuses</option>
            {visibleStatuses(effectiveRole).map(s => (
              <option key={s} value={s}>{getStatusCfg(s).label}</option>
            ))}
          </select>
          <div className="ml-auto flex items-center gap-2">
            {can(effectiveRole, "invoice-ready", "download") && <button
              disabled={orders.length === 0}
              onClick={() => {
                const rows = orders.map((o) => ({
                  "Report Code": o.id ?? "",
                  "Building": o.building ?? "",
                  "Equipment Code": o.equipment_code ?? "",
                  "Equipment Type": o.equipment_type ?? "",
                  "Status": getStatusCfg(o.status).label,
                  "Maintenance Type": o.maintenance_type ?? "",
                  "Technician": o.technician_name ?? "",
                  "Arrival Date": o.arrival_date_time ? fmtDate(o.arrival_date_time) : "",
                  "Arrival Time": o.arrival_date_time ? fmtTime(o.arrival_date_time) : "",
                  "Priority": o.priority ?? "",
                  "Findings": o.findings ?? "",
                  "Work Performed": o.work_performed ?? "",
                  "Parts Used": o.parts_used?.map((p: { name: string; quantity: number }) => `${p.name} x${p.quantity}`).join(", ") ?? "",
                  "Submitted At": o.submitted_at ? fmtDate(o.submitted_at) : "",
                }));
                const ws = XLSX.utils.json_to_sheet(rows);
                const wb = XLSX.utils.book_new();
                XLSX.utils.book_append_sheet(wb, ws, "Work Orders");
                ws["!cols"] = Object.keys(rows[0] ?? {}).map(() => ({ wch: 20 }));
                XLSX.writeFile(wb, `Finance_Report_${new Date().toISOString().slice(0, 10)}.xlsx`);
              }}
              className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40 transition-all active:scale-95"
            >
              <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M6.5 1v8M3.5 6.5L6.5 9l3-2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/><path d="M2 10.5h9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
              Export
            </button>}
            {effectiveRole === "operation" && (
              <button onClick={() => setShowBatchUpload(true)} className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition-all active:scale-95">
                <svg width="13" height="13" viewBox="0 0 14 14" fill="none"><path d="M7 10V2M4 5l3-3 3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/><path d="M2 11h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
                Batch Upload
              </button>
            )}
            {can(effectiveRole, "received", "approve") && (
              <button onClick={() => setShowAddProject(true)} className="btn-green text-xs font-semibold px-4 py-2 rounded-lg text-white flex items-center gap-1.5 shadow-sm active:scale-95 transition-all" style={{ backgroundColor: "#1a7a4a" }}>
                <svg width="12" height="12" viewBox="0 0 14 14" fill="none"><path d="M7 2v10M2 7h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
                Add Project
              </button>
            )}
          </div>
        </div>

        {/* Row 2: Search filters */}
        <div className="px-4 py-2.5 flex flex-wrap items-center gap-2 sm:gap-3 bg-gray-50/60">
          <div className="flex items-center gap-1.5 text-sm">
            <svg width="13" height="13" viewBox="0 0 14 14" fill="none" className="text-gray-400"><circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.3"/><path d="M9.5 9.5L13 13" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
            <input type="text" list="report-code-list" placeholder="Report code" value={searchQuery} onChange={e => { setSearchQuery(e.target.value); setCurrentPage(1); }} className={`${inputCls} w-28 sm:w-32`} />
            <datalist id="report-code-list">{uniqueReportCodes.map(c => <option key={c} value={c} />)}</datalist>
          </div>
          <div className="h-4 w-px bg-gray-200 hidden sm:block" />
          <input type="text" list="building-list" placeholder="Building" value={buildingFilter === "all" ? "" : buildingFilter} onChange={e => { setBuildingFilter(e.target.value || "all"); setCurrentPage(1); }} className={`${inputCls} w-28 sm:w-40`} />
          <datalist id="building-list">{uniqueBuildings.map(b => <option key={b} value={b} />)}</datalist>
          <input type="text" list="project-name-list" placeholder="Project name" value={projectNameFilter} onChange={e => { setProjectNameFilter(e.target.value); setCurrentPage(1); }} className={`${inputCls} w-28 sm:w-36`} />
          <datalist id="project-name-list">{uniqueProjectNames.map(n => <option key={n} value={n} />)}</datalist>
          <input type="text" list="parts-list" placeholder="Item / Parts" value={partsFilter} onChange={e => { setPartsFilter(e.target.value); setCurrentPage(1); }} className={`${inputCls} w-28 sm:w-32`} />
          <datalist id="parts-list">{uniqueParts.map(p => <option key={p} value={p} />)}</datalist>
        </div>

        {/* Row 3: Active filter pills */}
        {(searchQuery || (buildingFilter && buildingFilter !== "all") || projectNameFilter || partsFilter || fromDate || toDate || statusFilter !== "all" || statsFilter) && (
          <div className="px-4 py-2 flex flex-wrap items-center gap-2 border-t border-gray-100 bg-white">
            <span className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider mr-1">Filters:</span>
            {fromDate && (
              <span className="filter-pill">From: {fromDate}<button onClick={() => setFromDate("")}><svg width="8" height="8" viewBox="0 0 8 8"><path d="M1 1l6 6M7 1L1 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg></button></span>
            )}
            {toDate && (
              <span className="filter-pill">To: {toDate}<button onClick={() => setToDate("")}><svg width="8" height="8" viewBox="0 0 8 8"><path d="M1 1l6 6M7 1L1 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg></button></span>
            )}
            {statusFilter !== "all" && (
              <span className="filter-pill">Status: {getStatusCfg(statusFilter).label}<button onClick={() => setStatusFilter("all")}><svg width="8" height="8" viewBox="0 0 8 8"><path d="M1 1l6 6M7 1L1 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg></button></span>
            )}
            {searchQuery && (
              <span className="filter-pill">Code: {searchQuery}<button onClick={() => setSearchQuery("")}><svg width="8" height="8" viewBox="0 0 8 8"><path d="M1 1l6 6M7 1L1 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg></button></span>
            )}
            {buildingFilter && buildingFilter !== "all" && (
              <span className="filter-pill">Building: {buildingFilter}<button onClick={() => setBuildingFilter("all")}><svg width="8" height="8" viewBox="0 0 8 8"><path d="M1 1l6 6M7 1L1 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg></button></span>
            )}
            {projectNameFilter && (
              <span className="filter-pill">Project: {projectNameFilter}<button onClick={() => setProjectNameFilter("")}><svg width="8" height="8" viewBox="0 0 8 8"><path d="M1 1l6 6M7 1L1 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg></button></span>
            )}
            {partsFilter && (
              <span className="filter-pill">Parts: {partsFilter}<button onClick={() => setPartsFilter("")}><svg width="8" height="8" viewBox="0 0 8 8"><path d="M1 1l6 6M7 1L1 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg></button></span>
            )}
            {statsFilter && (
              <span className="filter-pill">Stat: {statsFilter === "myQueue" ? "My Queue" : statsFilter === "projectsThisMonth" ? "This Month" : "Active"}<button onClick={() => setStatsFilter(null)}><svg width="8" height="8" viewBox="0 0 8 8"><path d="M1 1l6 6M7 1L1 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg></button></span>
            )}
            <button
              onClick={() => { setSearchQuery(""); setBuildingFilter("all"); setProjectNameFilter(""); setPartsFilter(""); setFromDate(""); setToDate(""); setStatusFilter("all"); setStatsFilter(null); setCurrentPage(1); }}
              className="text-[10px] text-red-500 hover:text-red-700 font-semibold transition-colors ml-auto flex items-center gap-1"
            >
              <svg width="10" height="10" viewBox="0 0 10 10"><path d="M2 2l6 6M8 2L2 8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
              Clear all
            </button>
          </div>
        )}
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-4">
        <StatCard iconKey="queue" label="My Queue" value={stats?.myQueue ?? 0} active={statsFilter === "myQueue"} onClick={() => { setStatsFilter(f => f === "myQueue" ? null : "myQueue"); setCurrentPage(1); }} />
        <StatCard iconKey="projects" label="Projects This Month" value={stats?.projectsThisMonth ?? 0} active={statsFilter === "projectsThisMonth"} onClick={() => { setStatsFilter(f => f === "projectsThisMonth" ? null : "projectsThisMonth"); setCurrentPage(1); }} />
        <StatCard iconKey="active" label="Active Jobs" value={stats?.activeJobs ?? 0} active={statsFilter === "activeJobs"} onClick={() => { setStatsFilter(f => f === "activeJobs" ? null : "activeJobs"); setCurrentPage(1); }} />
        <StatCard iconKey="response" label="Avg Response" value={stats?.avgResponseTimeMin ?? 45} unit="MIN" ok={true} />
        <StatCard iconKey="duration" label="Avg Duration" value={stats?.avgWorkDurationHrs ?? 2.3} unit="HRS" ok={true} />
      </div>

      {/* Work orders header */}
      <div className="rounded-t-xl px-5 py-3 flex items-center justify-between" style={{ backgroundColor: "#1a3a2a" }}>
        <div className="flex items-center gap-3">
          <h2 className="text-white font-bold text-sm uppercase tracking-widest">
            {statsFilter === "myQueue" ? "My Queue" : statsFilter === "projectsThisMonth" ? "Projects This Month" : statsFilter === "activeJobs" ? "Active Jobs" : "Work Orders"}
          </h2>
          {!loading && (
            <span className="text-green-400/80 text-xs font-medium bg-white/10 px-2 py-0.5 rounded-full">
              {sortedOrders.length}{sortedOrders.length !== orders.length ? ` / ${orders.length}` : ""}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          {/* View toggle */}
          <div className="flex items-center gap-1 bg-white/10 rounded-lg p-0.5">
            <button onClick={() => setViewMode("card")} className={`p-1.5 rounded transition-all ${viewMode === "card" ? "bg-white/20 text-white" : "text-white/50 hover:text-white/80"}`} title="Card view">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="1" y="1" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.2"/><rect x="8" y="1" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.2"/><rect x="1" y="8" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.2"/><rect x="8" y="8" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.2"/></svg>
            </button>
            <button onClick={() => setViewMode("table")} className={`p-1.5 rounded transition-all ${viewMode === "table" ? "bg-white/20 text-white" : "text-white/50 hover:text-white/80"}`} title="Table view">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M1 3h12M1 7h12M1 11h12" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
            </button>
          </div>
          {statsFilter && (
            <button onClick={() => { setStatsFilter(null); setCurrentPage(1); }} className="text-xs text-green-300 hover:text-white transition-colors flex items-center gap-1">
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
              Clear stat filter
            </button>
          )}
        </div>
      </div>

      {/* Work orders list */}
      {loading ? (
        <div className="bg-white rounded-b-xl border border-t-0 border-gray-200 p-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}
          </div>
        </div>
      ) : sortedOrders.length === 0 ? (
        <div className="bg-white rounded-b-xl border border-t-0 border-gray-200 p-16 text-center" style={{ animation: "fadeIn .3s ease" }}>
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-gray-100 flex items-center justify-center">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" className="text-gray-400"><rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" strokeWidth="1.5"/><path d="M8 8h8M8 12h8M8 16h4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>
          </div>
          <p className="text-gray-500 font-medium">{orders.length === 0 ? "No work orders found" : "No results match your filters"}</p>
          <p className="text-gray-400 text-sm mt-1">{orders.length === 0 ? "Create a new CBS Call to get started." : "Try adjusting or clearing your filters."}</p>
          {orders.length === 0 && (
            <button onClick={() => setShowAddProject(true)} className="btn-green mt-4 text-sm font-semibold px-5 py-2.5 rounded-lg text-white inline-flex items-center gap-2 shadow-sm active:scale-95 transition-all" style={{ backgroundColor: "#1a7a4a" }}>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 2v10M2 7h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
              Add Project
            </button>
          )}
        </div>
      ) : (
        <div className="bg-white rounded-b-xl border border-t-0 border-gray-200 p-4">
          {viewMode === "card" ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {paginatedOrders.map((order, i) => (
                <WorkOrderCard key={order.id ?? order.created_at} order={order} index={i} onClick={() => order.id && setSelectedCode(order.id)} />
              ))}
            </div>
          ) : (
            /* Table view */
            <div className="overflow-x-auto -mx-4 px-4">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="text-left text-[10px] font-bold uppercase tracking-wider text-gray-400 px-3 py-2.5">Code</th>
                    <th className="text-left text-[10px] font-bold uppercase tracking-wider text-gray-400 px-3 py-2.5">Building</th>
                    <th className="text-left text-[10px] font-bold uppercase tracking-wider text-gray-400 px-3 py-2.5 hidden md:table-cell">Equipment</th>
                    <th className="text-left text-[10px] font-bold uppercase tracking-wider text-gray-400 px-3 py-2.5 hidden lg:table-cell">Technician</th>
                    <th className="text-left text-[10px] font-bold uppercase tracking-wider text-gray-400 px-3 py-2.5">Type</th>
                    <th className="text-left text-[10px] font-bold uppercase tracking-wider text-gray-400 px-3 py-2.5">Priority</th>
                    <th className="text-left text-[10px] font-bold uppercase tracking-wider text-gray-400 px-3 py-2.5">Date</th>
                    <th className="text-left text-[10px] font-bold uppercase tracking-wider text-gray-400 px-3 py-2.5">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedOrders.map((order, i) => {
                    const prio = PRIORITY_COLORS[order.priority] ?? PRIORITY_COLORS.Medium;
                    return (
                      <tr key={order.id ?? order.created_at} onClick={() => order.id && setSelectedCode(order.id)}
                        className="table-row cursor-pointer border-b border-gray-50 last:border-0"
                        style={{ animation: `fadeIn .2s ${i * 0.02}s ease both` }}>
                        <td className="px-3 py-2.5 font-mono font-bold text-gray-800 text-xs whitespace-nowrap">{order.id ?? "—"}</td>
                        <td className="px-3 py-2.5 text-gray-700 font-medium text-xs">{order.building}</td>
                        <td className="px-3 py-2.5 text-gray-600 text-xs hidden md:table-cell">{order.equipment_code}</td>
                        <td className="px-3 py-2.5 text-gray-600 text-xs hidden lg:table-cell">{order.technician_name}</td>
                        <td className="px-3 py-2.5"><span className="text-[10px] font-semibold uppercase text-gray-500 bg-gray-100 px-2 py-0.5 rounded">{order.maintenance_type}</span></td>
                        <td className="px-3 py-2.5">
                          <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full" style={{ backgroundColor: prio.bg, color: prio.text }}>{order.priority}</span>
                        </td>
                        <td className="px-3 py-2.5 text-gray-600 text-xs whitespace-nowrap">{fmtDate(order.arrival_date_time)}</td>
                        <td className="px-3 py-2.5">
                          <div className="flex items-center gap-1.5">
                            <StatusBadge status={order.status} />
                            {order.parts_used?.some(p => p.status === "needs-replacement") && (
                              <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 border border-amber-300 px-1.5 py-0.5 text-[9px] font-bold text-amber-700 uppercase whitespace-nowrap" title="Parts need replacement">
                                <svg width="10" height="10" viewBox="0 0 16 16" fill="none"><path d="M8 1L1 14h14L8 1z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/><path d="M8 6v3.5M8 12v.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
                                Parts
                              </span>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination + page size */}
          {(totalPages > 1 || sortedOrders.length > 10) && (
            <div className="flex flex-wrap items-center justify-between mt-4 pt-4 border-t border-gray-100 gap-3">
              <div className="flex items-center gap-3">
                <span className="text-xs text-gray-500">
                  Showing {(currentPage - 1) * pageSize + 1}–{Math.min(currentPage * pageSize, sortedOrders.length)} of {sortedOrders.length}
                </span>
                <div className="flex items-center gap-1.5 text-xs text-gray-500">
                  <span>Show</span>
                  {[10, 25, 50].map(size => (
                    <button key={size} onClick={() => { setPageSize(size); setCurrentPage(1); }}
                      className={`min-w-[32px] py-1 rounded border text-xs transition-all ${pageSize === size ? "bg-green-700 text-white border-green-700 font-bold" : "border-gray-200 text-gray-500 hover:bg-gray-50"}`}>
                      {size}
                    </button>
                  ))}
                </div>
              </div>
              {totalPages > 1 && (
                <div className="flex items-center gap-1">
                  <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1}
                    className="px-2.5 py-1.5 text-xs rounded border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-all">
                    ‹ Prev
                  </button>
                  {Array.from({ length: totalPages }, (_, i) => i + 1)
                    .filter(p => p === 1 || p === totalPages || Math.abs(p - currentPage) <= 1)
                    .reduce<(number | "ellipsis")[]>((acc, p, idx, arr) => {
                      if (idx > 0 && p - (arr[idx - 1] as number) > 1) acc.push("ellipsis");
                      acc.push(p);
                      return acc;
                    }, [])
                    .map((item, idx) =>
                      item === "ellipsis" ? (
                        <span key={`e${idx}`} className="px-1.5 text-xs text-gray-400">…</span>
                      ) : (
                        <button key={item} onClick={() => setCurrentPage(item)}
                          className={`min-w-[30px] py-1.5 text-xs rounded border transition-all ${currentPage === item ? "bg-green-700 text-white border-green-700 font-bold" : "border-gray-200 text-gray-600 hover:bg-gray-50"}`}>
                          {item}
                        </button>
                      )
                    )}
                  <button onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages}
                    className="px-2.5 py-1.5 text-xs rounded border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-all">
                    Next ›
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Detail modal */}
      {selectedCode && (
        <DetailModal
          code={selectedCode}
          onClose={() => setSelectedCode(null)}
          onStatusChange={handleStatusChange}
          onToast={addToast}
          onDetailUpdated={fetchData}
          role={effectiveRole}
          token={token}
          userName={session?.name ?? session?.email}
        />
      )}

      {/* Add Project modal */}
      {showAddProject && (
        <AddProjectModal
          onClose={() => setShowAddProject(false)}
          onCreated={(msg) => { void fetchData(); addToast(msg, "success"); }}
          token={token}
        />
      )}

      {/* Batch Upload modal */}
      {showBatchUpload && (
        <BatchUploadModal
          onClose={() => setShowBatchUpload(false)}
          onDone={() => { void fetchData(); addToast("Batch upload completed", "success"); }}
          buildings={uniqueBuildings}
        />
      )}

      {/* Toast container */}
      <ToastContainer toasts={toasts} remove={removeToast} />
    </>
  );
}

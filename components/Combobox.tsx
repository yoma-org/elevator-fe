"use client";

import { useEffect, useMemo, useRef, useState } from "react";

export interface ComboboxOption {
  value: string;
  label: string;
}

interface ComboboxProps {
  options: ComboboxOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  disabledMessage?: string;
  error?: boolean;
  className?: string;
}

function isTouchDevice(): boolean {
  if (typeof window === "undefined") return false;
  return "ontouchstart" in window || navigator.maxTouchPoints > 0;
}

export function Combobox({
  options,
  value,
  onChange,
  placeholder = "Select...",
  disabled = false,
  disabledMessage,
  error = false,
  className = "",
}: ComboboxProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [isMobile, setIsMobile] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = useMemo(() => options.find((o) => o.value === value), [options, value]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, query]);

  // Detect mobile breakpoint (< 640px)
  useEffect(() => {
    function check() { setIsMobile(window.innerWidth < 640); }
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  // Close on outside click
  useEffect(() => {
    function onClick(e: MouseEvent | TouchEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    }
    document.addEventListener("mousedown", onClick);
    document.addEventListener("touchstart", onClick);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("touchstart", onClick);
    };
  }, []);

  // Focus input when opening — but skip on touch devices to avoid auto-popping the keyboard
  useEffect(() => {
    if (open) {
      if (!isTouchDevice() && !isMobile) {
        setTimeout(() => inputRef.current?.focus(), 50);
      }
      // Lock body scroll on mobile sheet
      if (isMobile) {
        document.body.style.overflow = "hidden";
      }
    } else {
      setQuery("");
      document.body.style.overflow = "";
    }
    return () => { document.body.style.overflow = ""; };
  }, [open, isMobile]);

  const baseCls = `form-input h-12 w-full rounded-xl border-2 bg-white px-3 text-base shadow-sm transition-all flex items-center justify-between gap-2 ${
    disabled
      ? "cursor-not-allowed bg-slate-100 border-slate-200 text-slate-400"
      : error
        ? "error border-red-500 bg-red-50 text-slate-800"
        : "border-slate-300 hover:border-slate-400 text-slate-800"
  } ${className}`;

  // Mobile bottom sheet vs desktop popover
  const dropdownContent = (
    <>
      {options.length > 5 && (
        <div className={`p-2 border-b border-slate-100 ${isMobile ? "sticky top-0 bg-white z-10" : ""}`}>
          <div className="relative">
            <svg width="16" height="16" viewBox="0 0 14 14" fill="none" className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none">
              <circle cx="6" cy="6" r="4" stroke="currentColor" strokeWidth="1.4"/><path d="M9.5 9.5l2 2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
            </svg>
            <input
              ref={inputRef}
              type="search"
              inputMode="search"
              enterKeyHint="search"
              autoComplete="off"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Search ${options.length} options...`}
              className="w-full h-11 rounded-lg border border-slate-200 bg-slate-50 pl-9 pr-3 text-base outline-none focus:bg-white focus:border-slate-300"
              onKeyDown={(e) => {
                if (e.key === "Escape") { setOpen(false); }
                else if (e.key === "Enter" && filtered.length === 1) {
                  e.preventDefault();
                  onChange(filtered[0].value);
                  setOpen(false);
                }
              }}
            />
            {query && (
              <button
                type="button"
                onClick={() => { setQuery(""); inputRef.current?.focus(); }}
                className="absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 flex items-center justify-center text-slate-400 hover:text-slate-600 active:bg-slate-100 rounded-full"
                aria-label="Clear search"
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M4 4l6 6M10 4l-6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
              </button>
            )}
          </div>
        </div>
      )}
      <div className={isMobile ? "overflow-y-auto" : "max-h-64 overflow-y-auto overscroll-contain"} style={isMobile ? { maxHeight: "calc(70vh - 120px)" } : undefined}>
        {filtered.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-slate-400">No matches</div>
        ) : (
          filtered.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => { onChange(opt.value); setOpen(false); }}
              className={`w-full text-left px-4 py-3 text-base hover:bg-slate-50 active:bg-slate-100 transition-colors flex items-center gap-2 min-h-[44px] ${
                opt.value === value ? "bg-blue-50 text-[#1b3c7b] font-semibold" : "text-slate-700"
              }`}
            >
              {opt.value === value ? (
                <svg width="14" height="14" viewBox="0 0 12 12" fill="none" className="flex-shrink-0"><path d="M2 6l3 3 5-6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>
              ) : (
                <span className="w-[14px] flex-shrink-0" />
              )}
              <span className="truncate">{opt.label}</span>
            </button>
          ))
        )}
      </div>
      {filtered.length > 0 && options.length > 10 && !isMobile && (
        <div className="border-t border-slate-100 px-3 py-1.5 text-[10px] text-slate-400 text-center bg-slate-50">
          {filtered.length} / {options.length} items
        </div>
      )}
    </>
  );

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className={baseCls}
      >
        <span className={`truncate text-left ${!selected ? "text-slate-400 font-normal" : "font-medium"}`}>
          {disabled ? (disabledMessage ?? placeholder) : selected ? selected.label : placeholder}
        </span>
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className={`flex-shrink-0 transition-transform ${open ? "rotate-180" : ""}`}>
          <path d="M3 5l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>

      {open && !disabled && (
        isMobile ? (
          // Mobile: bottom sheet
          <>
            <div
              className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[1px]"
              onClick={() => setOpen(false)}
              style={{ animation: "fadeIn .15s ease" }}
            />
            <div
              className="fixed inset-x-0 bottom-0 z-50 bg-white rounded-t-2xl shadow-2xl flex flex-col"
              style={{ maxHeight: "75vh", animation: "slideUp .25s ease" }}
            >
              <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 flex-shrink-0">
                <div className="w-10 h-1 bg-slate-200 rounded-full mx-auto absolute left-1/2 -translate-x-1/2 top-1.5" />
                <span className="text-sm font-bold text-slate-700">Select option</span>
                <button type="button" onClick={() => setOpen(false)} className="text-slate-400 active:text-slate-600 p-1 -mr-1">
                  <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>
                </button>
              </div>
              {dropdownContent}
            </div>
          </>
        ) : (
          // Desktop: popover below trigger
          <div className="absolute left-0 right-0 top-full mt-1 z-30 bg-white rounded-xl border-2 border-slate-200 shadow-xl overflow-hidden">
            {dropdownContent}
          </div>
        )
      )}
    </div>
  );
}

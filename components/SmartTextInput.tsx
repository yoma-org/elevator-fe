"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001/api";

interface SmartTextInputProps {
  value: string;
  onChange: (value: string) => void;
  field: "findings" | "remarks" | "parts" | "notes";
  equipment_type?: string;
  placeholder?: string;
  multiline?: boolean;
  className?: string;
  minHeight?: string;
}

export default function SmartTextInput({
  value,
  onChange,
  field,
  equipment_type,
  placeholder,
  multiline = true,
  className = "",
  minHeight = "90px",
}: SmartTextInputProps) {
  const [ghostText, setGhostText] = useState("");
  const [isFocused, setIsFocused] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    function onClick(e: MouseEvent | TouchEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setIsFocused(false);
      }
    }
    document.addEventListener("mousedown", onClick);
    document.addEventListener("touchstart", onClick);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("touchstart", onClick);
    };
  }, []);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const ghostRef = useRef<HTMLDivElement>(null);

  // Sync scroll between textarea and ghost overlay
  const syncScroll = () => {
    const el = multiline ? textareaRef.current : inputRef.current;
    if (el && ghostRef.current) {
      ghostRef.current.scrollTop = el.scrollTop;
      ghostRef.current.scrollLeft = el.scrollLeft;
    }
  };

  const fetchSuggestions = useCallback(
    async (query: string) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      const params = new URLSearchParams({ field, q: query, limit: "5" });
      if (equipment_type) params.set("equipment_type", equipment_type);

      try {
        const res = await fetch(`${API_BASE_URL}/suggestions?${params}`, {
          signal: controller.signal,
        });
        const json = await res.json();
        const list: string[] = json?.data ?? [];
        setSuggestions(list);

        // Find the best match: a suggestion that starts with user's input
        const lowerQuery = query.toLowerCase();
        const match = list.find((s) =>
          s.toLowerCase().startsWith(lowerQuery),
        );

        if (match) {
          setGhostText(match.slice(query.length));
        } else {
          setGhostText("");
        }
      } catch {
        // aborted or network error
      }
    },
    [field, equipment_type],
  );

  const handleChange = (
    e: React.ChangeEvent<HTMLTextAreaElement | HTMLInputElement>,
  ) => {
    const newValue = e.target.value;
    onChange(newValue);
    setGhostText("");

    if (debounceRef.current) clearTimeout(debounceRef.current);

    const trimmed = newValue.trim();
    if (trimmed.length < 2) {
      setGhostText("");
      setSuggestions([]);
      return;
    }

    debounceRef.current = setTimeout(() => {
      fetchSuggestions(trimmed);
    }, 300);
  };

  const acceptGhost = () => {
    if (!ghostText) return false;

    onChange(value + ghostText);
    setGhostText("");
    return true;
  };

  const handleKeyDown = (
    e: React.KeyboardEvent<HTMLTextAreaElement | HTMLInputElement>,
  ) => {
    if (e.key === "Tab" && ghostText) {
      e.preventDefault();
      acceptGhost();
    } else if (e.key === "Escape") {
      setGhostText("");
    }
  };

  // Cleanup
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      abortRef.current?.abort();
    };
  }, []);

  // Clear ghost + suggestions when value is cleared externally
  useEffect(() => {
    if (!value) { setGhostText(""); setSuggestions([]); }
  }, [value]);

  const pickSuggestion = (text: string) => {
    onChange(text);
    setGhostText("");
    setSuggestions([]);
    // Keep isFocused so next typing can trigger suggestions again
  };

  const showGhost = isFocused && ghostText.length > 0;

  const showDropdown = isFocused && suggestions.length > 0;

  return (
    <div ref={wrapRef} className="relative">
      {/* Ghost text overlay — sits behind the textarea */}
      <div
        ref={ghostRef}
        aria-hidden
        className="pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap break-words"
        style={{
          minHeight,
          // Match textarea styling exactly
          padding: "0.75rem",
          fontSize: "1rem",
          lineHeight: "1.5",
          fontFamily: "inherit",
          borderWidth: "2px",
          borderColor: "transparent",
          color: "transparent",
        }}
      >
        {/* Invisible user text to push ghost to correct position */}
        <span style={{ visibility: "hidden" }}>{value}</span>
        {/* Ghost suggestion in faded color */}
        {showGhost && (
          <span className="text-slate-400">{ghostText}</span>
        )}
      </div>

      {/* Actual textarea/input on top */}
      {multiline ? (
        <textarea
          ref={textareaRef}
          className={className}
          style={{ minHeight, background: "transparent", position: "relative", zIndex: 1 }}
          placeholder={placeholder}
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          onScroll={syncScroll}
        />
      ) : (
        <input
          ref={inputRef}
          type="text"
          className={className}
          style={{ background: "transparent", position: "relative", zIndex: 1 }}
          placeholder={placeholder}
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          onScroll={syncScroll}
        />
      )}

      {/* Accept hint — tap on mobile, Tab on desktop */}
      {showGhost && (
        <button
          type="button"
          className="absolute bottom-1.5 right-2 z-10 rounded-lg bg-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 active:bg-slate-300 sm:px-1.5 sm:py-0.5 sm:text-[11px] sm:font-normal sm:bg-slate-100 sm:text-slate-400"
          onMouseDown={(e) => {
            e.preventDefault();
            acceptGhost();
          }}
          onTouchEnd={(e) => {
            e.preventDefault();
            acceptGhost();
          }}
        >
          <span className="sm:hidden">Accept ✓</span>
          <span className="hidden sm:inline">Tab ↹</span>
        </button>
      )}

      {/* Suggestions dropdown */}
      {showDropdown && (
        <ul className="absolute left-0 right-0 top-full mt-1 z-20 bg-white rounded-xl border-2 border-slate-200 shadow-xl max-h-60 overflow-y-auto">
          <li className="sticky top-0 bg-slate-50 border-b border-slate-100 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">
            Previously used ({suggestions.length})
          </li>
          {suggestions.map((s, i) => {
            const lowerQ = value.trim().toLowerCase();
            const idx = s.toLowerCase().indexOf(lowerQ);
            return (
              <li key={i}>
                <button
                  type="button"
                  onMouseDown={(e) => { e.preventDefault(); pickSuggestion(s); }}
                  onTouchEnd={(e) => { e.preventDefault(); pickSuggestion(s); }}
                  className="w-full text-left px-3 py-2.5 text-sm text-slate-700 hover:bg-slate-50 active:bg-slate-100 flex items-center gap-2 min-h-[40px]"
                >
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="text-slate-300 flex-shrink-0"><path d="M6 1.5v4l2.5 1.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/><circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.3"/></svg>
                  <span className="truncate">
                    {idx >= 0 && lowerQ ? (
                      <>
                        {s.slice(0, idx)}
                        <span className="font-semibold text-slate-900 bg-yellow-100">{s.slice(idx, idx + lowerQ.length)}</span>
                        {s.slice(idx + lowerQ.length)}
                      </>
                    ) : s}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

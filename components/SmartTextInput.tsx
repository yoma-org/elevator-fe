"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001/api";

interface SmartTextInputProps {
  value: string;
  onChange: (value: string) => void;
  field: "findings" | "remarks" | "parts" | "notes";
  equipmentType?: string;
  placeholder?: string;
  multiline?: boolean;
  className?: string;
  minHeight?: string;
}

export default function SmartTextInput({
  value,
  onChange,
  field,
  equipmentType,
  placeholder,
  multiline = true,
  className = "",
  minHeight = "90px",
}: SmartTextInputProps) {
  const [ghostText, setGhostText] = useState("");
  const [isFocused, setIsFocused] = useState(false);

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
      if (equipmentType) params.set("equipmentType", equipmentType);

      try {
        const res = await fetch(`${API_BASE_URL}/suggestions?${params}`, {
          signal: controller.signal,
        });
        const json = await res.json();
        const suggestions: string[] = json?.data ?? [];

        // Find the best match: a suggestion that starts with user's input
        const lowerQuery = query.toLowerCase();
        const match = suggestions.find((s) =>
          s.toLowerCase().startsWith(lowerQuery),
        );

        if (match) {
          // Ghost = the part the user hasn't typed yet
          setGhostText(match.slice(query.length));
        } else if (suggestions.length > 0) {
          // No prefix match — show first suggestion fully as ghost
          setGhostText(suggestions[0]);
        } else {
          setGhostText("");
        }
      } catch {
        // aborted or network error
      }
    },
    [field, equipmentType],
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

  // Clear ghost when value is cleared externally
  useEffect(() => {
    if (!value) setGhostText("");
  }, [value]);

  const showGhost = isFocused && ghostText.length > 0;

  return (
    <div className="relative">
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
    </div>
  );
}

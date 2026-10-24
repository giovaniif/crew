import { useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { Menu } from "./Menu.tsx";

export type SelectOption<T extends string> = { value: T; label: string; hint?: ReactNode };

export type SelectProps<T extends string> = {
  label: string;
  value: T;
  options: SelectOption<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
  search?: string;
  placeholder?: string;
  className?: string;
};

const menuWidth = 220;
const menuMaxWidth = 480;
const menuHeight = 320;
const gap = 4;
const edge = 8;

export function menuPlace(rect: { left: number; top: number; bottom: number; width: number }, view: { width: number; height: number }): CSSProperties {
  const minWidth = Math.min(Math.max(menuWidth, rect.width), view.width - 2 * edge);
  const left = Math.max(edge, Math.min(rect.left, view.width - minWidth - edge));
  const maxWidth = Math.max(minWidth, Math.min(menuMaxWidth, view.width - left - edge));
  const size = { minWidth: minWidth + "px", maxWidth: maxWidth + "px" };
  const below = view.height - rect.bottom - gap - edge;
  const up = below < Math.min(menuHeight, 160) && rect.top > below;
  const room = Math.max(120, Math.min(menuHeight, up ? rect.top - gap - edge : below));
  return up
    ? { position: "fixed", left: left + "px", top: "auto", bottom: view.height - rect.top + gap + "px", ...size, maxHeight: room + "px" }
    : { position: "fixed", left: left + "px", top: rect.bottom + gap + "px", ...size, maxHeight: room + "px" };
}

export function Select<T extends string>({ label, value, options, onChange, disabled, search, placeholder, className }: SelectProps<T>) {
  const [place, setPlace] = useState<CSSProperties | null>(null);
  const open = place !== null;
  const setOpen = (next: boolean | ((o: boolean) => boolean)) => {
    const want = typeof next === "function" ? next(open) : next;
    const rect = button.current?.getBoundingClientRect();
    setPlace(want && rect ? menuPlace(rect, { width: window.innerWidth, height: window.innerHeight || 800 }) : null);
  };
  const anchor = useRef<HTMLSpanElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const id = useId();
  const current = options.find((o) => o.value === value);

  useEffect(() => {
    if (!open) {
      return;
    }
    const away = (e: MouseEvent) => {
      if (!anchor.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);

  function close() {
    setOpen(false);
    button.current?.focus();
  }

  function onKeyDown(e: KeyboardEvent) {
    if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      e.preventDefault();
      if (!disabled) {
        setOpen(true);
      }
    }
  }

  return (
    <span ref={anchor} className={"ui-anchor" + (className ? " " + className : "")}>
      <button
        ref={button}
        type="button"
        className="ui select"
        role="combobox"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={onKeyDown}
      >
        <span className="value">{current ? current.label : (placeholder ?? "")}</span>
        <span className="chev" aria-hidden="true">
          ▾
        </span>
      </button>
      {open ? (
        <Menu
          id={id}
          role="listbox"
          label={label}
          style={place ?? undefined}
          search={search}
          items={options.map((o) => ({ value: o.value, label: o.label, hint: o.hint, checked: o.value === value }))}
          onPick={(v) => {
            close();
            if (v !== value) {
              onChange(v as T);
            }
          }}
          onClose={close}
        />
      ) : null}
    </span>
  );
}

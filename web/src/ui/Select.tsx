import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
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

export function Select<T extends string>({ label, value, options, onChange, disabled, search, placeholder, className }: SelectProps<T>) {
  const [open, setOpen] = useState(false);
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

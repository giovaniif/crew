import { useEffect, useId, useRef, useState, type InputHTMLAttributes, type KeyboardEvent } from "react";

export type StepperProps = {
  label: string;
  value: string | number;
  onChange: (value: string) => void;
  onBlur?: () => void;
  min?: number;
  max?: number;
  step?: number;
};

export function Stepper({ label, value, onChange, onBlur, min, max, step = 1 }: StepperProps) {
  const text = String(value);
  const n = Number(text);
  const valid = text !== "" && !Number.isNaN(n);
  function nudge(dir: number) {
    const base = valid ? n : (min ?? 0);
    let next = Math.round((base + dir * step) * 1000) / 1000;
    if (min !== undefined) {
      next = Math.max(min, next);
    }
    if (max !== undefined) {
      next = Math.min(max, next);
    }
    if (String(next) !== text) {
      onChange(String(next));
    }
  }
  function onKeyDown(e: KeyboardEvent) {
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      nudge(e.key === "ArrowUp" ? 1 : -1);
    }
  }
  return (
    <span className="ui stepper">
      <button type="button" aria-label={"Decrease " + label} tabIndex={-1} onClick={() => nudge(-1)}>
        −
      </button>
      <input
        role="spinbutton"
        aria-label={label}
        aria-valuenow={valid ? n : undefined}
        aria-valuemin={min}
        aria-valuemax={max}
        inputMode="decimal"
        value={text}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={onBlur}
      />
      <button type="button" aria-label={"Increase " + label} tabIndex={-1} onClick={() => nudge(1)}>
        +
      </button>
    </span>
  );
}

export type SuggestProps = Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "list"> & {
  label: string;
  value: string;
  onChange: (value: string) => void;
  suggestions: string[];
};

export function Suggest({ label, value, onChange, suggestions, className, onKeyDown: outerKeyDown, ...rest }: SuggestProps) {
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(-1);
  const id = useId();
  const box = useRef<HTMLSpanElement>(null);
  const q = value.trim().toLowerCase();
  const shown = suggestions.filter((s) => s.toLowerCase().includes(q) && s !== value);
  const visible = open && shown.length > 0;

  useEffect(() => {
    setHi(-1);
  }, [value]);

  function choose(s: string) {
    onChange(s);
    setOpen(false);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setHi((h) => Math.min(h + 1, shown.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHi((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter" && visible && hi >= 0) {
      e.preventDefault();
      choose(shown[hi]);
    } else if (e.key === "Escape" && visible) {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
    }
    outerKeyDown?.(e);
  }

  return (
    <span ref={box} className="ui-anchor">
      <input
        {...rest}
        className={"ui input" + (className ? " " + className : "")}
        role="combobox"
        aria-label={label}
        aria-autocomplete="list"
        aria-expanded={visible}
        aria-controls={visible ? id : undefined}
        aria-activedescendant={visible && hi >= 0 ? id + "-" + hi : undefined}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
      />
      {visible ? (
        <div id={id} className="ui menu" role="listbox" aria-label={label}>
          {shown.map((s, i) => (
            <div key={s} id={id + "-" + i} role="option" aria-selected={i === hi} className={"item" + (i === hi ? " hi" : "")} onMouseDown={(e) => e.preventDefault()} onClick={() => choose(s)}>
              {s}
            </div>
          ))}
        </div>
      ) : null}
    </span>
  );
}

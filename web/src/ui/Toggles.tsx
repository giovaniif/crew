import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { CheckIcon } from "./Menu.tsx";

type ToggleProps = {
  label: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  ariaLabel?: string;
  className?: string;
};

export function Switch({ label, checked, onChange, disabled, ariaLabel, className }: ToggleProps) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={ariaLabel} disabled={disabled} className={"ui toggle" + (className ? " " + className : "")} onClick={() => onChange(!checked)}>
      <span className={"switch" + (checked ? " on" : "")} aria-hidden="true" />
      {label}
    </button>
  );
}

export function Checkbox({ label, checked, onChange, disabled, ariaLabel, className }: ToggleProps) {
  return (
    <button type="button" role="checkbox" aria-checked={checked} aria-label={ariaLabel} disabled={disabled} className={"ui toggle" + (className ? " " + className : "")} onClick={() => onChange(!checked)}>
      <span className={"check" + (checked ? " on" : "")} aria-hidden="true">
        {checked ? <CheckIcon /> : null}
      </span>
      {label}
    </button>
  );
}

export type ChoiceOption<T extends string> = { value: T; label: ReactNode; detail?: ReactNode; ariaLabel?: string };

type ChoiceProps<T extends string> = {
  label: string;
  value: T;
  options: ChoiceOption<T>[];
  onChange: (value: T) => void;
  className?: string;
  itemClassName?: string;
};

function useArrows<T extends string>(options: ChoiceOption<T>[], value: T, onChange: (v: T) => void) {
  const group = useRef<HTMLDivElement>(null);
  function onKeyDown(e: KeyboardEvent) {
    const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (step === 0 || options.length === 0) {
      return;
    }
    e.preventDefault();
    const at = options.findIndex((o) => o.value === value);
    const next = (at + step + options.length) % options.length;
    onChange(options[next].value);
    group.current?.querySelectorAll<HTMLElement>('[role="radio"]')[next]?.focus();
  }
  return { group, onKeyDown };
}

export function RadioGroup<T extends string>({ label, value, options, onChange, className, itemClassName }: ChoiceProps<T>) {
  const { group, onKeyDown } = useArrows(options, value, onChange);
  const any = options.some((o) => o.value === value);
  return (
    <div ref={group} role="radiogroup" aria-label={label} className={"ui radios" + (className ? " " + className : "")} onKeyDown={onKeyDown}>
      {options.map((o, i) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={o.ariaLabel}
            tabIndex={on || (!any && i === 0) ? 0 : -1}
            className={"ui toggle" + (itemClassName ? " " + itemClassName : "") + (on ? " on" : "")}
            onClick={() => onChange(o.value)}
          >
            <span className={"radio" + (on ? " on" : "")} aria-hidden="true" />
            {o.detail !== undefined ? (
              <span>
                {o.label}
                {o.detail}
              </span>
            ) : (
              o.label
            )}
          </button>
        );
      })}
    </div>
  );
}

export function Segmented<T extends string>({ label, value, options, onChange, className }: ChoiceProps<T>) {
  const { group, onKeyDown } = useArrows(options, value, onChange);
  const any = options.some((o) => o.value === value);
  return (
    <div ref={group} role="radiogroup" aria-label={label} className={"ui seg" + (className ? " " + className : "")} onKeyDown={onKeyDown}>
      {options.map((o, i) => {
        const on = o.value === value;
        return (
          <button key={o.value} type="button" role="radio" aria-checked={on} aria-label={o.ariaLabel} tabIndex={on || (!any && i === 0) ? 0 : -1} className={on ? "on" : undefined} onClick={() => onChange(o.value)}>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

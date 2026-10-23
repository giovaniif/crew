import { useRef, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";

export type SliderProps = {
  label: string;
  low?: ReactNode;
  high?: ReactNode;
  min: number;
  max: number;
  value: number;
  onChange: (value: number) => void;
  valueText?: (value: number) => string;
  pageStep?: number;
  className?: string;
};

export function Slider({ label, low, high, min, max, value, onChange, valueText, pageStep, className }: SliderProps) {
  const dragging = useRef(false);
  const big = pageStep ?? Math.max(1, Math.round((max - min) / 2));
  const set = (v: number) => {
    const next = Math.min(max, Math.max(min, v));
    if (next !== value) {
      onChange(next);
    }
  };
  function onKeyDown(e: KeyboardEvent) {
    const moves: Record<string, number> = {
      ArrowRight: value + 1,
      ArrowUp: value + 1,
      ArrowLeft: value - 1,
      ArrowDown: value - 1,
      PageUp: value + big,
      PageDown: value - big,
      Home: min,
      End: max,
    };
    if (!(e.key in moves)) {
      return;
    }
    e.preventDefault();
    set(moves[e.key]);
  }
  function at(e: PointerEvent<HTMLDivElement>) {
    const box = e.currentTarget.getBoundingClientRect();
    const part = box.width > 0 ? (e.clientX - box.left) / box.width : 0;
    set(Math.round(min + Math.min(1, Math.max(0, part)) * (max - min)));
  }
  const span = max - min;
  const where = span > 0 ? ((value - min) / span) * 100 : 0;
  return (
    <div className={"ui slider" + (className ? " " + className : "")}>
      {low !== undefined && <span className="lo">{low}</span>}
      <div
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={valueText?.(value)}
        aria-orientation="horizontal"
        className="track"
        onKeyDown={onKeyDown}
        onPointerDown={(e) => {
          dragging.current = true;
          e.currentTarget.setPointerCapture?.(e.pointerId);
          e.currentTarget.focus();
          at(e);
        }}
        onPointerMove={(e) => {
          if (dragging.current) {
            at(e);
          }
        }}
        onPointerUp={(e) => {
          dragging.current = false;
          e.currentTarget.releasePointerCapture?.(e.pointerId);
        }}
        onPointerCancel={() => {
          dragging.current = false;
        }}
      >
        <span className="thumb" style={{ left: where + "%" }} aria-hidden="true" />
      </div>
      {high !== undefined && <span className="hi">{high}</span>}
    </div>
  );
}

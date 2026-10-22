import { useEffect, useId, useRef, type ButtonHTMLAttributes, type KeyboardEvent, type ReactNode } from "react";

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "default" | "primary" | "quiet" | "danger" | "icon" };

export function Button({ variant = "default", className, type = "button", ...rest }: ButtonProps) {
  const kind = variant === "icon" ? "ui icon-btn" : "ui btn" + (variant === "default" ? "" : " " + variant);
  return <button type={type} className={kind + (className ? " " + className : "")} {...rest} />;
}

const focusable = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export type DialogProps = { title: ReactNode; onClose: () => void; children: ReactNode; className?: string };

export function Dialog({ title, onClose, children, className }: DialogProps) {
  const box = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    const first = box.current?.querySelector<HTMLElement>(focusable);
    (first ?? box.current)?.focus();
    return () => before?.focus?.();
  }, []);

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== "Tab" || !box.current) {
      return;
    }
    const all = [...box.current.querySelectorAll<HTMLElement>(focusable)];
    if (all.length === 0) {
      e.preventDefault();
      return;
    }
    const first = all[0];
    const last = all[all.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={box} className={"dialog" + (className ? " " + className : "")} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} onKeyDown={onKeyDown}>
        <h2 id={titleId}>{title}</h2>
        {children}
      </div>
    </div>
  );
}

export type ToastProps = { message: ReactNode; action?: string; onAction?: () => void };

export function Toast({ message, action, onAction }: ToastProps) {
  return (
    <div className="ui toast" role="status">
      <span>{message}</span>
      {action ? <Button onClick={onAction}>{action}</Button> : null}
    </div>
  );
}

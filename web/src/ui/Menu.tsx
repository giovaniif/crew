import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";

export type MenuItem = { kind?: "item"; value: string; label: string; hint?: ReactNode; checked?: boolean; disabled?: boolean };
export type MenuEntry = MenuItem | { kind: "label"; label: string } | { kind: "sep" };

export type MenuProps = {
  label: string;
  items: MenuEntry[];
  onPick: (value: string) => void;
  onClose: () => void;
  search?: string;
  role?: "menu" | "listbox";
  id?: string;
  className?: string;
  style?: CSSProperties;
};

export function CheckIcon() {
  return (
    <svg className="check-icon" width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path d="M2.5 6.2 5 8.6l4.5-5.2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function isItem(e: MenuEntry): e is MenuItem {
  return e.kind === undefined || e.kind === "item";
}

export function Menu({ label, items, onPick, onClose, search, role = "menu", id, className, style }: MenuProps) {
  const [query, setQuery] = useState("");
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q === "" ? items : items.filter((e) => isItem(e) && e.label.toLowerCase().includes(q));
  }, [items, query]);
  const picks = shown.filter(isItem).filter((e) => !e.disabled);
  const checkedAt = picks.findIndex((e) => e.checked);
  const [hi, setHi] = useState(checkedAt >= 0 ? checkedAt : 0);
  const typed = useRef({ text: "", at: 0 });
  const box = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLInputElement>(null);
  const base = useId();

  useEffect(() => {
    (field.current ?? box.current)?.focus();
  }, []);

  useEffect(() => {
    box.current?.querySelector(".item.hi")?.scrollIntoView?.({ block: "nearest" });
  }, [hi]);

  function changeQuery(q: string) {
    setQuery(q);
    setHi(0);
  }

  function typeAhead(key: string) {
    const now = Date.now();
    const text = (now - typed.current.at < 700 ? typed.current.text : "") + key.toLowerCase();
    typed.current = { text, at: now };
    const at = picks.findIndex((e) => e.label.toLowerCase().startsWith(text));
    if (at >= 0) {
      setHi(at);
    }
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHi((h) => Math.min(h + 1, picks.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHi((h) => Math.max(h - 1, 0));
    } else if (e.key === "Home") {
      e.preventDefault();
      setHi(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setHi(picks.length - 1);
    } else if (e.key === "Enter" || (e.key === " " && search === undefined)) {
      e.preventDefault();
      const item = picks[hi];
      if (item) {
        onPick(item.value);
      }
    } else if (e.key === "Escape" || e.key === "Tab") {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
      }
      onClose();
    } else if (search === undefined && e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
      typeAhead(e.key);
    }
  }

  const itemRole = role === "listbox" ? "option" : undefined;
  const active = picks[hi];
  return (
    <div
      ref={box}
      id={id}
      className={"ui menu" + (className ? " " + className : "")}
      style={style}
      role={role}
      aria-label={label}
      tabIndex={-1}
      aria-activedescendant={active ? base + "-" + active.value : undefined}
      onKeyDown={onKeyDown}
    >
      {search !== undefined ? (
        <input ref={field} className="search" placeholder={search} aria-label={search} value={query} onChange={(e) => changeQuery(e.target.value)} autoCapitalize="none" autoCorrect="off" spellCheck={false} />
      ) : null}
      {shown.map((e, i) => {
        if (e.kind === "sep") {
          return query === "" ? <div key={"sep" + i} className="menu-sep" role="separator" /> : null;
        }
        if (e.kind === "label") {
          return query === "" ? (
            <div key={"label" + i} className="menu-label" role="presentation">
              {e.label}
            </div>
          ) : null;
        }
        const on = e === active;
        const r = itemRole ?? (e.checked === undefined ? "menuitem" : "menuitemcheckbox");
        return (
          <div
            key={e.value}
            id={base + "-" + e.value}
            className={"item" + (on ? " hi" : "")}
            role={r}
            aria-selected={r === "option" ? Boolean(e.checked) : undefined}
            aria-checked={r === "menuitemcheckbox" ? Boolean(e.checked) : undefined}
            aria-disabled={e.disabled || undefined}
            onMouseDown={(ev) => ev.preventDefault()}
            onMouseEnter={() => {
              const at = picks.indexOf(e);
              if (at >= 0) {
                setHi(at);
              }
            }}
            onClick={() => {
              if (!e.disabled) {
                onPick(e.value);
              }
            }}
          >
            <span className="ck" aria-hidden="true">
              {e.checked ? <CheckIcon /> : null}
            </span>
            <span>{e.label}</span>
            {e.hint !== undefined ? <span className="k">{e.hint}</span> : null}
          </div>
        );
      })}
    </div>
  );
}

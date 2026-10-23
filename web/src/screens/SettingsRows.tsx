import type { ReactNode } from "react";

export function Group({ label, title, children }: { label: string; title?: string; children: ReactNode }) {
  return (
    <section className="set-section" aria-label={label}>
      {title ? <div className="gtitle">{title}</div> : null}
      <div className="group">{children}</div>
    </section>
  );
}

export function Opt({ title, sub, server, lead, children }: { title?: ReactNode; sub?: ReactNode; server?: boolean; lead?: ReactNode; children?: ReactNode }) {
  return (
    <div className="opt">
      {lead}
      <div className="l">
        {title !== undefined ? (
          <div className="t">
            {title}
            {server ? <ServerTag /> : null}
          </div>
        ) : null}
        {sub ? <div className="s">{sub}</div> : null}
      </div>
      {children}
    </div>
  );
}

export function ServerTag() {
  return <span className="pill">server</span>;
}

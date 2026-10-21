import { useState, type ReactNode } from "react";
import type { Session } from "../stream";
import type { PaneKind, TerminalStore } from "../terminal";
import { TerminalPane } from "./Terminal";

type PhoneTab = "chat" | "review" | PaneKind;

const phoneTabs: { id: PhoneTab; title: string }[] = [
  { id: "chat", title: "Chat" },
  { id: "agent", title: "Terminal" },
  { id: "review", title: "Review" },
  { id: "shell", title: "Shell" },
  { id: "nvim", title: "nvim" },
];

export function PhoneSession({ session, terminals, review, children }: { session: Session | null; terminals: TerminalStore | null; review: ReactNode; children: ReactNode }) {
  const [tab, setTab] = useState<PhoneTab>("chat");
  if (!session || !terminals) {
    return <>{children}</>;
  }
  const current = phoneTabs.find((t) => t.id === tab) ?? phoneTabs[0];
  return (
    <div className="phone-session">
      <div className="phone-views" role="tablist" aria-label="Views">
        {phoneTabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={"phone-tab-" + t.id}
            aria-controls={"phone-pane-" + t.id}
            aria-selected={t.id === tab}
            onClick={() => setTab(t.id)}
          >
            {t.title}
          </button>
        ))}
      </div>
      <section className={"phone-pane phone-pane-" + tab} role="tabpanel" id={"phone-pane-" + tab} aria-labelledby={"phone-tab-" + current.id}>
        {tab === "chat" ? children : tab === "review" ? review : <TerminalPane store={terminals} session={session} kind={tab} />}
      </section>
    </div>
  );
}

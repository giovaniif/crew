import { useCallback, useEffect, useRef, useState } from "react";
import type { ServerListing, ServerRow, Servers } from "../servers";

type RowState = { state: "idle" } | { state: "busy"; what: string } | { state: "fixed" } | { state: "failed"; message: string };

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function useServerListing(servers: Servers | undefined): [ServerListing | null, () => void] {
  const [listing, setListing] = useState<ServerListing | null>(null);
  const live = useRef(true);
  const load = useCallback(() => {
    servers?.list().then(
      (l) => live.current && setListing(l),
      () => undefined,
    );
  }, [servers]);
  useEffect(() => {
    live.current = true;
    load();
    return () => {
      live.current = false;
    };
  }, [load]);
  return [listing, load];
}

function Row({ server, current, servers, reload }: { server: ServerRow; current: boolean; servers: Servers; reload: () => void }) {
  const [row, setRow] = useState<RowState>({ state: "idle" });

  async function act(what: string, work: () => Promise<void>, after: RowState) {
    setRow({ state: "busy", what });
    try {
      await work();
      setRow(after);
      reload();
    } catch (err) {
      setRow({ state: "failed", message: errorText(err) });
    }
  }

  const busy = row.state === "busy";
  return (
    <li className="card server-row" aria-label={server.name}>
      <div className="server-row-text">
        <h3>{server.name}</h3>
        <p className="muted">{server.detail}</p>
      </div>
      {current ? <span className="chip">Current</span> : null}
      <div className="server-row-buttons">
        {current ? null : (
          <button type="button" className="flow-button" disabled={busy} onClick={() => act("Opening…", () => servers.open(server.id), { state: "idle" })}>
            Open
          </button>
        )}
        <button type="button" className="flow-button" disabled={busy} onClick={() => act("Fixing…", () => servers.fix(server.id), { state: "fixed" })}>
          Fix
        </button>
        {server.kind === "local" ? null : (
          <button type="button" className="flow-button danger" disabled={busy} onClick={() => act("Removing…", () => servers.remove(server.id), { state: "idle" })}>
            Remove
          </button>
        )}
      </div>
      {row.state === "busy" ? <p role="status">{row.what}</p> : null}
      {row.state === "fixed" ? <p role="status">Fixed</p> : null}
      {row.state === "failed" ? (
        <p className="error" role="alert">
          {row.message}
        </p>
      ) : null}
    </li>
  );
}

export function ServersScreen({ servers }: { servers: Servers }) {
  const [listing, reload] = useServerListing(servers);
  return (
    <main className="screen">
      <h1>Servers</h1>
      <p className="lead">Each server has its own connection. Fix runs crew setup daemon on it again, on this computer or over SSH.</p>
      {listing ? (
        <ul className="server-list">
          {listing.servers.map((s) => (
            <Row key={s.id} server={s} current={s.id === listing.selected} servers={servers} reload={reload} />
          ))}
        </ul>
      ) : (
        <p className="muted">Loading the servers…</p>
      )}
      <a className="new-session" href="#/servers/add">
        Add a server
      </a>
    </main>
  );
}

export function ServerChip({ servers, listing, go }: { servers: Servers; listing: ServerListing | null; go: (hash: string) => void }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  if (!listing) {
    return null;
  }
  const current = listing.servers.find((s) => s.id === listing.selected) ?? listing.servers[0];
  const pick = async (id: string) => {
    setOpen(false);
    setError("");
    try {
      await servers.open(id);
    } catch (err) {
      setError(errorText(err));
    }
  };
  const to = (hash: string) => {
    setOpen(false);
    go(hash);
  };
  return (
    <div className="server-chip">
      <button type="button" className="chip-button" aria-haspopup="menu" aria-expanded={open} aria-label={"Server: " + (current?.name ?? "")} onClick={() => setOpen(!open)}>
        {current?.name}
      </button>
      {open ? (
        <div className="chip-menu" role="menu" aria-label="Servers">
          {listing.servers.map((s) => (
            <button key={s.id} type="button" role="menuitemradio" aria-checked={s.id === listing.selected} onClick={() => pick(s.id)}>
              {s.name}
            </button>
          ))}
          <button type="button" role="menuitem" onClick={() => to("#/servers/add")}>
            Add a server…
          </button>
          <button type="button" role="menuitem" onClick={() => to("#/servers")}>
            Manage servers…
          </button>
        </div>
      ) : null}
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

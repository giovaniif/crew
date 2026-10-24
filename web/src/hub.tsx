import { createContext, useContext, useEffect, useState } from "react";
import type { Authed } from "./api";
import { loadHub, type Hub, type MachineLink, type Machines } from "./machines";
import { useMachine } from "./screens/Machine";

export const HubContext = createContext<Machines | null>(null);

export type HubState = { hub: Hub | null; links: MachineLink[] };

export function useHub(api: Authed): HubState {
  const machines = useContext(HubContext);
  const name = useMachine();
  const [state, setState] = useState<HubState>({ hub: null, links: [] });
  useEffect(() => {
    let live = true;
    const fallback: MachineLink[] = [{ key: "this", name, local: false, fetch: api.fetch, token: api.token }];
    const pick = machines ? machines.links().catch(() => fallback) : Promise.resolve(fallback);
    void pick
      .then(async (links) => {
        const use = links.length > 0 ? links : fallback;
        const hub = await loadHub(use);
        if (live) {
          setState({ hub, links: use });
        }
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [machines, api, name]);
  return state;
}

export function authedOf(link: MachineLink): Authed {
  return { fetch: link.fetch, token: link.token };
}

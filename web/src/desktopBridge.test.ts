import { describe, expect, it } from "vitest";
import { tauriBridge } from "./desktopBridge";

describe("tauriBridge listen", () => {
  it("registers a Tauri event listener and removes it again", async () => {
    const calls: { cmd: string; args?: Record<string, unknown> }[] = [];
    const callbacks: Record<number, (event: { payload: unknown }) => void> = {};
    let next = 7;
    const win = Object.assign(Object.create(window), {
      __TAURI_INTERNALS__: {
        invoke: async (cmd: string, args?: Record<string, unknown>) => {
          calls.push({ cmd, args });
          return cmd === "plugin:event|listen" ? 41 : null;
        },
        transformCallback: (cb: (event: { payload: unknown }) => void) => {
          callbacks[next] = cb;
          return next++;
        },
      },
    }) as Window;
    const bridge = tauriBridge(win)!;
    const seen: unknown[] = [];
    const off = await bridge.listen!("crew-machine-stream", (payload) => seen.push(payload));
    expect(calls[0]).toEqual({ cmd: "plugin:event|listen", args: { event: "crew-machine-stream", target: { kind: "Any" }, handler: 7 } });
    callbacks[7]({ payload: { stream: 1 } });
    expect(seen).toEqual([{ stream: 1 }]);
    off();
    expect(calls[1]).toEqual({ cmd: "plugin:event|unlisten", args: { event: "crew-machine-stream", eventId: 41 } });
  });
});

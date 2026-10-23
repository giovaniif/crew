import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { desktop, goldenState } from "../test/desktop";
import type { FakeServer } from "../test/fake-server";

afterEach(() => {
  window.location.hash = "";
});

const routes = (server: FakeServer) =>
  server
    .on("GET", "/api/v1/mates", { status: 200, body: { mates: [], limits: { hop_limit: 0, turns_per_hour: 0, daily_turns: 0, daily_tokens: 0, stop: false } } })
    .on("GET", "/api/v1/envs", { status: 200, body: { envs: [] } })
    .on("GET", "/api/v1/approvals", { status: 200, body: [] })
    .on("POST", "/api/v1/mates", (call) => ({ status: 200, body: (call.body as { mate: unknown }).mate }))
    .on("POST", "/api/v1/envs", (call) => ({ status: 200, body: { ...(call.body as object), secrets: [], used_by: [] } }))
    .on("POST", "/api/v1/envs/test-ada/ssh-key", { status: 200, body: { name: "test-ada", kind: "custom", parts: [], secrets: [], used_by: [] } });

function stepOne(name = "test-ada") {
  fireEvent.change(screen.getByRole("textbox", { name: "Name" }), { target: { value: name } });
  fireEvent.click(screen.getByRole("button", { name: "Careful reviewer" }));
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
}

describe("the first run of mates", () => {
  it("asks for the first mate when the server has no mates", () => {
    const { live } = desktop("#/mates", true, undefined, {}, routes);
    live();
    expect(screen.getByRole("heading", { name: "Make your first mate" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
  });

  it("does not show the first run while mates exist", () => {
    const { live } = desktop("#/mates", true, undefined, {}, routes);
    live({ ...goldenState(), mates: { stopped: false, mates: [{ name: "rex", state: "ready", work: [], threads: [] }] } });
    expect(screen.queryByRole("heading", { name: "Make your first mate" })).not.toBeInTheDocument();
  });

  it("makes a Local mate in two steps and opens it", async () => {
    const { live, server } = desktop("#/mates", true, undefined, {}, routes);
    live();
    stepOne();
    expect(screen.getByRole("heading", { name: "Where does test-ada work?" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Local \(this Mac\)/ })).toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getByRole("button", { name: "Create test-ada" }));
    await waitFor(() => expect(window.location.hash).toBe("#/mates/test-ada"));
    const saved = server.calls.find((c) => c.method === "POST" && c.path === "/api/v1/mates")?.body as { mate: Record<string, unknown> };
    expect(saved.mate).toMatchObject({ name: "test-ada", agent: "claude", enabled: true });
    expect(String(saved.mate.prompt)).not.toBe("");
    expect(saved.mate.env).toBeUndefined();
  });

  it("makes a Custom environment for the mate and opens its editor", async () => {
    const { live, server } = desktop("#/mates", true, undefined, {}, routes);
    live();
    stepOne();
    fireEvent.click(screen.getByRole("radio", { name: /New Custom environment/ }));
    fireEvent.click(screen.getByRole("button", { name: "Create test-ada" }));
    await waitFor(() => expect(window.location.hash).toBe("#/envs/test-ada"));
    expect(server.calls.find((c) => c.method === "POST" && c.path === "/api/v1/envs")?.body).toMatchObject({ name: "test-ada", kind: "custom" });
    expect(server.calls.some((c) => c.path === "/api/v1/envs/test-ada/ssh-key")).toBe(true);
    const saved = server.calls.find((c) => c.method === "POST" && c.path === "/api/v1/mates")?.body as { mate: Record<string, unknown> };
    expect(saved.mate.env).toBe("test-ada");
  });

  it("goes back to step 1 with Back", () => {
    const { live } = desktop("#/mates", true, undefined, {}, routes);
    live();
    stepOne();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("textbox", { name: "Name" })).toHaveValue("test-ada");
  });

  it("offers a plain session instead and then shows the Mates home", () => {
    const { live } = desktop("#/mates", true, undefined, {}, routes);
    live();
    const link = screen.getByRole("link", { name: "Start a session" });
    expect(link).toHaveAttribute("href", "#/new");
    fireEvent.click(link);
    window.location.hash = "#/mates";
    fireEvent(window, new HashChangeEvent("hashchange"));
    expect(screen.queryByRole("heading", { name: "Make your first mate" })).not.toBeInTheDocument();
  });

  it("asks for the name, the harness and the environment on one phone step", async () => {
    const { live, server } = desktop("#/mates", false, undefined, {}, routes);
    live();
    expect(screen.getByRole("heading", { name: "Make your first mate" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Harness" })).toHaveTextContent("Claude");
    expect(screen.getByRole("combobox", { name: "Environment" })).toHaveTextContent("Environment: Local (this Mac)");
    fireEvent.change(screen.getByRole("textbox", { name: "Name" }), { target: { value: "test-ada" } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(window.location.hash).toBe("#/mates/test-ada"));
    expect(server.calls.some((c) => c.method === "POST" && c.path === "/api/v1/mates")).toBe(true);
  });
});

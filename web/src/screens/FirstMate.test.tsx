import { fireEvent, screen, waitFor, within } from "@testing-library/react";
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
    expect(screen.getByRole("heading", { name: "Whose accounts does test-ada use?" })).toBeInTheDocument();
    expect(screen.getByText("test-ada runs on crew. Pick the git identity, SSH key and logins it uses there. You can change it later.")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Your accounts on crew/ })).toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getByRole("button", { name: "Create test-ada" }));
    await waitFor(() => expect(window.location.hash).toBe("#/mates/test-ada"));
    const saved = server.calls.find((c) => c.method === "POST" && c.path === "/api/v1/mates")?.body as { mate: Record<string, unknown> };
    expect(saved.mate).toMatchObject({ name: "test-ada", agent: "claude", enabled: true });
    expect(String(saved.mate.prompt)).not.toBe("");
    expect(saved.mate.env).toBeUndefined();
  });

  it("offers the environments that exist and saves the mate with the one picked", async () => {
    const { live, server } = desktop("#/mates", true, undefined, {}, (srv) =>
      routes(srv).on("GET", "/api/v1/envs", {
        status: 200,
        body: { envs: [{ name: "test-bot", kind: "custom", parts: ["git", "ssh", "github"], git_email: "bot@example.com", secrets: [], used_by: [] }] },
      }),
    );
    live();
    stepOne();
    const bot = await screen.findByRole("radio", { name: /test-bot/ });
    expect(bot).toHaveTextContent("git as bot@example.com, own SSH key, GitHub token");
    fireEvent.click(bot);
    fireEvent.click(screen.getByRole("button", { name: "Create test-ada" }));
    await waitFor(() => expect(window.location.hash).toBe("#/mates/test-ada"));
    expect(server.calls.some((c) => c.method === "POST" && c.path === "/api/v1/envs")).toBe(false);
    const saved = server.calls.find((c) => c.method === "POST" && c.path === "/api/v1/mates")?.body as { mate: Record<string, unknown> };
    expect(saved.mate).toMatchObject({ name: "test-ada", env: "test-bot" });
  });

  it("shows a face and the saved slug for a name with spaces and capitals", async () => {
    const { live, server } = desktop("#/mates", true, undefined, {}, routes);
    live();
    fireEvent.change(screen.getByRole("textbox", { name: "Name" }), { target: { value: "UX Patrol" } });
    expect(screen.queryByText("?")).toBeNull();
    expect(screen.getByRole("button", { name: "Change face" })).toBeInTheDocument();
    expect(screen.getByText("Saved as ux-patrol")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByRole("heading", { name: "Whose accounts does ux-patrol use?" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Create ux-patrol" }));
    await waitFor(() => expect(window.location.hash).toBe("#/mates/ux-patrol"));
    const saved = server.calls.find((c) => c.method === "POST" && c.path === "/api/v1/mates")?.body as { mate: Record<string, unknown> };
    expect(saved.mate).toMatchObject({ name: "ux-patrol" });
  });

  it("tells why a name is refused next to the field", () => {
    const { live } = desktop("#/mates", true, undefined, {}, routes);
    live();
    fireEvent.change(screen.getByRole("textbox", { name: "Name" }), { target: { value: "!!!" } });
    expect(screen.getByText("Use up to 32 letters, digits, - and _.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
  });

  it("picks the face and the color from a click on the face", async () => {
    const { live, server } = desktop("#/mates", true, undefined, {}, routes);
    live();
    fireEvent.change(screen.getByRole("textbox", { name: "Name" }), { target: { value: "test-ada" } });
    fireEvent.click(screen.getByRole("button", { name: "Change face" }));
    const picker = screen.getByRole("dialog", { name: "Face and color" });
    fireEvent.click(within(picker).getByRole("button", { name: "Owl" }));
    fireEvent.click(within(picker).getByRole("button", { name: "Color #40a02b" }));
    fireEvent.click(within(picker).getByRole("button", { name: "Done" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Create test-ada" }));
    await waitFor(() => expect(window.location.hash).toBe("#/mates/test-ada"));
    const saved = server.calls.find((c) => c.method === "POST" && c.path === "/api/v1/mates")?.body as { mate: Record<string, unknown> };
    expect(saved.mate).toMatchObject({ avatar: "owl", color: "#40a02b" });
  });

  it("makes a Custom environment for the mate and opens its editor", async () => {
    const { live, server } = desktop("#/mates", true, undefined, {}, routes);
    live();
    stepOne();
    fireEvent.click(screen.getByRole("radio", { name: /New environment/ }));
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

  it("offers a plain session instead and then shows the Mates home", async () => {
    const { live } = desktop("#/mates", true, undefined, {}, routes);
    live();
    const link = screen.getByRole("link", { name: "Start a session" });
    expect(link).toHaveAttribute("href", "#/new");
    fireEvent.click(link);
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Make your first mate" })).not.toBeInTheDocument());
    window.location.hash = "#/mates";
    await waitFor(() => expect(screen.getByRole("heading", { name: "Mates" })).toBeInTheDocument());
  });

  it("asks for the name, the harness and the environment on one phone step", async () => {
    const { live, server } = desktop("#/mates", false, undefined, {}, routes);
    live();
    expect(screen.getByRole("heading", { name: "Make your first mate" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Harness" })).toHaveTextContent("Claude");
    expect(screen.getByRole("combobox", { name: "Environment" })).toHaveTextContent("Environment: Your accounts on crew");
    fireEvent.change(screen.getByRole("textbox", { name: "Name" }), { target: { value: "test-ada" } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(window.location.hash).toBe("#/mates/test-ada"));
    expect(server.calls.some((c) => c.method === "POST" && c.path === "/api/v1/mates")).toBe(true);
  });
});

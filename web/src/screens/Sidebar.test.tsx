import { screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { desktop } from "../test/desktop";

afterEach(() => {
  window.location.hash = "";
});


describe("the desktop sidebar", () => {
  it("has a New session button in the head and the footer links", () => {
    const { live } = desktop();
    live();
    const sidebar = within(screen.getByRole("navigation", { name: "Sidebar" }));
    expect(sidebar.getByRole("link", { name: "New session" })).toHaveAttribute("href", "#/new");
    for (const [name, href] of [["Mates", "#/mates"], ["Approvals", "#/approvals"], ["Automations", "#/automations"], ["Disk", "#/disk"], ["Settings", "#/settings"]]) {
      expect(sidebar.getByRole("link", { name })).toHaveAttribute("href", href);
    }
  });

  it("has a Mates entry and the limits meters", () => {
    const { live } = desktop();
    live();
    const sidebar = within(screen.getByRole("navigation", { name: "Sidebar" }));
    expect(sidebar.getByRole("link", { name: "Mates" })).toHaveAttribute("href", "#/mates");
    expect(sidebar.getByLabelText("Claude limits")).toHaveTextContent(/5h\s*42%/);
    expect(sidebar.getByLabelText("Codex limits")).toHaveTextContent(/5h\s*10%/);
  });

  it("marks Sessions in the nav while a session is open", () => {
    const { live } = desktop("#/sessions/s2");
    live();
    const nav = within(screen.getByRole("navigation", { name: "Sidebar" }));
    expect(nav.getByRole("link", { name: /^Sessions/ })).toHaveAttribute("aria-current", "page");
  });
});

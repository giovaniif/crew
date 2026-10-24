import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const styles = readFileSync(join(here, "styles", "index.css"), "utf8")
  .split("\n")
  .map((line) => line.match(/@import "\.\/(.+)";/)?.[1])
  .filter((name): name is string => name !== undefined);
const css = [readFileSync(join(here, "theme.css"), "utf8"), ...styles.map((name) => readFileSync(join(here, "styles", name), "utf8"))].join("\n");

function tokens(): Record<string, string> {
  const root = css.match(/:root\s*{([^}]*)}/)?.[1] ?? "";
  const out: Record<string, string> = {};
  for (const m of root.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) {
    out[m[1]] = m[2];
  }
  return out;
}

function rule(selector: string): Record<string, string> {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const body = css.match(new RegExp("(?:^|[\\s,}])" + escaped + "\\s*(?:,[^{]*)?{([^}]*)}", "m"))?.[1];
  if (body === undefined) {
    throw new Error("no rule for " + selector);
  }
  const out: Record<string, string> = {};
  for (const decl of body.split(";")) {
    const at = decl.indexOf(":");
    if (at > 0) {
      out[decl.slice(0, at).trim()] = decl.slice(at + 1).trim();
    }
  }
  return out;
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe("the Latte palette", () => {
  const palette = tokens();

  it("reads its tokens from theme.css", () => {
    expect(palette.text).toMatch(/^#/);
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21);
  });

  it("makes the main column white", () => {
    expect(palette.paper).toBe("#ffffff");
  });

  it.each([
    ["text", "base"],
    ["text", "mantle"],
    ["text", "selected"],
    ["subtext", "base"],
    ["subtext", "mantle"],
    ["red", "base"],
    ["on-accent", "red"],
    ["link", "base"],
    ["link", "mantle"],
    ["on-accent", "blue"],
    ["text", "paper"],
    ["subtext", "paper"],
    ["link", "paper"],
  ])("%s text on %s meets 4.5:1", (fg, bg) => {
    expect(palette[fg], fg).toBeDefined();
    expect(palette[bg], bg).toBeDefined();
    expect(contrast(palette[fg], palette[bg])).toBeGreaterThanOrEqual(4.5);
  });
});

describe("the Mocha palette", () => {
  const dark = css.match(/@media \(prefers-color-scheme: dark\)\s*{\s*:root\s*{([^}]*)}/)?.[1] ?? "";
  const palette: Record<string, string> = {};
  for (const m of dark.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) {
    palette[m[1]] = m[2];
  }

  it("is the dark scheme of the app", () => {
    expect(css).toMatch(/color-scheme:\s*light dark/);
    expect(palette.base).toBe("#1e1e2e");
    expect(palette.blue).toBe("#89b4fa");
  });

  it.each([
    ["text", "base"],
    ["text", "mantle"],
    ["text", "selected"],
    ["subtext", "base"],
    ["subtext", "mantle"],
    ["red", "base"],
    ["on-accent", "red"],
    ["link", "base"],
    ["link", "mantle"],
    ["on-accent", "blue"],
    ["text", "paper"],
    ["subtext", "paper"],
    ["link", "paper"],
  ])("%s text on %s meets 4.5:1", (fg, bg) => {
    expect(palette[fg], fg).toBeDefined();
    expect(palette[bg], bg).toBeDefined();
    expect(contrast(palette[fg], palette[bg])).toBeGreaterThanOrEqual(4.5);
  });
});

describe("the automations table", () => {
  it("keeps the enable switch inside the right edge of the table", () => {
    expect(rule(".automations .switch-col")["padding-right"]).toBe("12px");
    expect(rule(".automations .switch-col").width).toBe("52px");
  });

  it("gives the side panel 380px next to the table", () => {
    expect(rule(".automations.with-detail")["grid-template-columns"]).toBe("minmax(0, 1fr) 380px");
  });
});

describe("the settings styles", () => {
  it.each([".settings-layout", ".settings-nav", ".settings-pane", ".settings-list", ".server-list", ".server-row-text", ".server-row-buttons", ".alert-row", ".agent-settings", ".shortcut-actions", ".shortcuts", ".theme-colors", ".detail-tabs", ".interrupt"])("keeps no rule for the removed %s", (selector) => {
    expect(() => rule(selector)).toThrow("no rule for " + selector);
  });
});

describe("touch targets", () => {
  it.each([".session-card", ".back", ".retry", ".new-session", ".choice", ".queued-action", ".permission-choice", ".load-older", ".tool summary", ".automations .chip", ".automations .subtabs button", ".automations .run-list .link", ".run-actions button", ".approval-actions button", ".open-session", ".term-retry", ".phone-views button", ".opt", ".folders li", ".disk-actions button", ".disk-tabs button", ".disk-kill", ".where-choice", ".first-run-buttons button", ".first-run-body .fields button", ".change-server", ".swatches .swatch", ".tabs a", ".mrow", ".more-row"])("%s is at least 44px tall", (selector) => {
    expect(parseInt(rule(selector)["min-height"] ?? "0", 10)).toBeGreaterThanOrEqual(44);
  });
});

describe("the open session link", () => {
  it("uses the theme link color", () => {
    expect(rule(".open-session").color).toBe("var(--link)");
  });
});

describe("the chat layout", () => {
  it("scrolls a long queue of sends instead of pushing the composer off the screen", () => {
    const queued = rule(".queued");
    expect(queued["max-height"]).toMatch(/vh|dvh/);
    expect(queued["overflow-y"]).toBe("auto");
  });
});

describe("the session state chip", () => {
  it("colors waiting peach and permission red like the list glyphs and the Mac app", () => {
    expect(rule(".chip-waiting::before").background).toBe("var(--peach)");
    expect(rule(".chip-permission::before").background).toBe("var(--red)");
  });
});

describe("the stylesheet", () => {
  it("closes every rule so the browser does not drop the rule after it", () => {
    const unclosed: string[] = [];
    const open: string[] = [];
    for (const line of css.split("\n")) {
      const t = line.trim();
      if (t.endsWith("{")) {
        const parent = open[open.length - 1];
        if (parent !== undefined && !parent.startsWith("@")) {
          unclosed.push(parent);
        }
        open.push(t);
      } else if (t.startsWith("}")) {
        open.pop();
      }
    }
    unclosed.push(...open);
    expect(unclosed).toEqual([]);
  });

  it("underlines the selected automation sub-tab in ink and gives the kit checkbox a 14px box", () => {
    expect(rule(".automations .subtabs button.on")["border-bottom-color"]).toBe("var(--ink)");
    expect(rule(".ui .check").width).toBe("14px");
  });
});

describe("the review pane on a phone", () => {
  it("stacks the file list, the diff and the draft so the diff gets the full width", () => {
    const blocks = [...css.matchAll(/@media \(max-width: 600px\) {([\s\S]*?)\n}/g)].map((m) => m[1]);
    const body = blocks.map((b) => b.match(/\.review-body\s*{([^}]*)}/)?.[1]).find((b) => b !== undefined) ?? "";
    expect(body).toMatch(/grid-template-columns:\s*(1fr|minmax\(0, 1fr\))\s*;/);
  });
});

describe("the sidebar shortcut hint", () => {
  it("hides an on-demand hint until the row is hovered, focused or selected", () => {
    expect(rule(".side-row kbd.on-demand").display).toBe("none");
    expect(rule('.side-row[aria-current="page"] kbd.on-demand').display).toBe("inline");
    expect(rule(".side-row:hover kbd.on-demand").display).toBe("inline");
    expect(rule(".side-row:focus-visible kbd.on-demand").display).toBe("inline");
  });
});

describe("the face and color picker", () => {
  it("centers the face in the face button and in each face tile", () => {
    expect(rule(".face-pick")["align-items"]).toBe("center");
    expect(rule(".face-pick")["justify-content"]).toBe("center");
    expect(rule(".face-pick .face").display).toBe("block");
    expect(rule(".mt-faces button .face").display).toBe("block");
  });

  it("shows small swatches in the same six columns as the faces", () => {
    expect(rule(".face-picker .swatches").display).toBe("grid");
    expect(rule(".face-picker .swatches")["grid-template-columns"]).toBe("repeat(6, minmax(0, 1fr))");
    const swatch = rule(".face-picker .swatches .swatch");
    expect(swatch.padding).toBe("10px");
    expect(swatch["background-clip"]).toBe("content-box");
  });
});

describe("a mate color swatch", () => {
  it("is a circle of the same width and height", () => {
    const swatch = rule(".swatches .swatch");
    expect(swatch.width).toBe("44px");
    expect(swatch.height).toBe("44px");
    expect(swatch["min-width"]).toBe("44px");
    expect(swatch.flex).toBe("none");
    expect(swatch["border-radius"]).toBe("50%");
  });

  it("wraps a long word in the automation prompt", () => {
    expect(rule(".automation-prompt")["overflow-wrap"]).toBe("anywhere");
  });

  it("lets the label of a settings row shrink so a long device name wraps", () => {
    expect(rule(".opt .l")["min-width"]).toBe("0");
  });

  it("keeps the theme color swatch a fixed circle in its settings row", () => {
    expect(rule(".opt > .swatch").flex).toBe("none");
  });

  it("hides the visually-hidden text from the screen", () => {
    const hidden = rule(".visually-hidden");
    expect(hidden.position).toBe("absolute");
    expect(hidden.width).toBe("1px");
    expect(hidden.overflow).toBe("hidden");
  });

  it("scrolls only the content pane of Settings, so the menu column fills the window", () => {
    expect(rule(".set").height).toBe("100%");
    expect(rule(".set")["min-height"]).toBe("0");
    expect(rule(".sbody")["overflow-y"]).toBe("auto");
    expect(rule(".main-other:has(.settings-screen)").overflow).toBe("hidden");
  });

  it("draws the server chip as a 28px kit control", () => {
    expect(rule(".server-chip .ui.select").width).toBe("100%");
    expect(rule(".server-chip .ui.menu").right).toBe("0");
  });

  it("removes the scrim while the native folder dialog is open", () => {
    expect(rule("html[data-picking] .sheet-backdrop").background).toBe("transparent");
  });
});

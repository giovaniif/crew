import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { Button, Checkbox, Dialog, Menu, RadioGroup, Segmented, Select, Slider, Stepper, Suggest, Switch, Toast } from "./index.ts";

const fruits = [
  { value: "apple", label: "Apple" },
  { value: "banana", label: "Banana" },
  { value: "cherry", label: "Cherry" },
];

function Picker({ onChange }: { onChange?: (v: string) => void }) {
  const [value, setValue] = useState("apple");
  return (
    <Select
      label="Fruit"
      value={value}
      options={fruits}
      onChange={(v) => {
        setValue(v);
        onChange?.(v);
      }}
    />
  );
}

describe("Button", () => {
  it("draws the variant class of the kit", () => {
    render(<Button variant="primary">Start</Button>);
    expect(screen.getByRole("button", { name: "Start" })).toHaveClass("btn", "primary");
  });
});

describe("Select", () => {
  it("is a closed button that shows the chosen label", () => {
    render(<Picker />);
    const button = screen.getByRole("combobox", { name: "Fruit" });
    expect(button).toHaveTextContent("Apple");
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("opens a listbox with the current option selected and picks by click", async () => {
    const onChange = vi.fn();
    render(<Picker onChange={onChange} />);
    await userEvent.click(screen.getByRole("combobox", { name: "Fruit" }));
    const list = screen.getByRole("listbox", { name: "Fruit" });
    expect(within(list).getByRole("option", { name: "Apple" })).toHaveAttribute("aria-selected", "true");
    await userEvent.click(within(list).getByRole("option", { name: "Cherry" }));
    expect(onChange).toHaveBeenCalledWith("cherry");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Fruit" })).toHaveTextContent("Cherry");
  });

  it("moves with the arrow keys and picks with Enter", async () => {
    const onChange = vi.fn();
    render(<Picker onChange={onChange} />);
    screen.getByRole("combobox", { name: "Fruit" }).focus();
    await userEvent.keyboard("{ArrowDown}");
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    await userEvent.keyboard("{ArrowDown}{ArrowDown}{Enter}");
    expect(onChange).toHaveBeenCalledWith("cherry");
  });

  it("closes on Escape without a change", async () => {
    const onChange = vi.fn();
    render(<Picker onChange={onChange} />);
    await userEvent.click(screen.getByRole("combobox", { name: "Fruit" }));
    await userEvent.keyboard("{ArrowDown}{Escape}");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("jumps to the option that starts with the typed text", async () => {
    const onChange = vi.fn();
    render(<Picker onChange={onChange} />);
    await userEvent.click(screen.getByRole("combobox", { name: "Fruit" }));
    await userEvent.keyboard("ba{Enter}");
    expect(onChange).toHaveBeenCalledWith("banana");
  });

  it("does not open when disabled", async () => {
    render(<Select label="Fruit" value="apple" options={fruits} onChange={() => {}} disabled />);
    await userEvent.click(screen.getByRole("combobox", { name: "Fruit" }));
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });
});

describe("Menu", () => {
  it("filters the items by the search text and shows sections, checks and hints", async () => {
    const onPick = vi.fn();
    render(
      <Menu
        label="Projects"
        search="Find a project…"
        onPick={onPick}
        onClose={() => {}}
        items={[
          { kind: "label", label: "Recent" },
          { value: "web", label: "web", hint: "~/code/web", checked: true },
          { value: "api", label: "api", hint: "~/code/api" },
          { kind: "sep" },
          { value: "add", label: "Add a project…" },
        ]}
      />,
    );
    const menu = screen.getByRole("menu", { name: "Projects" });
    expect(within(menu).getByRole("menuitemcheckbox", { name: /web/ })).toHaveAttribute("aria-checked", "true");
    expect(within(menu).getByText("~/code/api")).toBeInTheDocument();
    expect(within(menu).getByRole("separator")).toBeInTheDocument();
    await userEvent.type(screen.getByPlaceholderText("Find a project…"), "ap");
    expect(within(menu).queryByRole("menuitemcheckbox", { name: /web/ })).not.toBeInTheDocument();
    await userEvent.keyboard("{Enter}");
    expect(onPick).toHaveBeenCalledWith("api");
  });

  it("closes on Escape", async () => {
    const onClose = vi.fn();
    render(<Menu label="M" onPick={() => {}} onClose={onClose} items={[{ value: "a", label: "A" }]} />);
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });
});

describe("Switch, Checkbox", () => {
  it("toggles a switch", async () => {
    const onChange = vi.fn();
    render(<Switch label="Notify" checked={false} onChange={onChange} />);
    const sw = screen.getByRole("switch", { name: "Notify" });
    expect(sw).not.toBeChecked();
    await userEvent.click(sw);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("toggles a checkbox with Space", async () => {
    const onChange = vi.fn();
    render(<Checkbox label="Viewed" checked onChange={onChange} />);
    const box = screen.getByRole("checkbox", { name: "Viewed" });
    expect(box).toBeChecked();
    box.focus();
    await userEvent.keyboard(" ");
    expect(onChange).toHaveBeenCalledWith(false);
  });
});

describe("RadioGroup and Segmented", () => {
  it("picks a radio and moves with arrows", async () => {
    const onChange = vi.fn();
    render(
      <RadioGroup
        label="Agent"
        value="claude"
        onChange={onChange}
        options={[
          { value: "claude", label: "Claude" },
          { value: "codex", label: "Codex" },
        ]}
      />,
    );
    expect(screen.getByRole("radiogroup", { name: "Agent" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Claude" })).toBeChecked();
    await userEvent.click(screen.getByRole("radio", { name: "Codex" }));
    expect(onChange).toHaveBeenLastCalledWith("codex");
    screen.getByRole("radio", { name: "Claude" }).focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(onChange).toHaveBeenLastCalledWith("codex");
  });

  it("draws a segmented control as radios", async () => {
    const onChange = vi.fn();
    render(
      <Segmented
        label="Effort"
        value="high"
        onChange={onChange}
        options={[
          { value: "low", label: "low" },
          { value: "high", label: "high" },
        ]}
      />,
    );
    expect(screen.getByRole("radio", { name: "high" })).toBeChecked();
    await userEvent.click(screen.getByRole("radio", { name: "low" }));
    expect(onChange).toHaveBeenCalledWith("low");
  });
});

describe("Stepper", () => {
  it("steps within its bounds and takes typed text", async () => {
    const onChange = vi.fn();
    render(<Stepper label="Size" value="5" min={0} max={5} onChange={onChange} />);
    const field = screen.getByRole("spinbutton", { name: "Size" });
    await userEvent.click(screen.getByRole("button", { name: "Increase Size" }));
    expect(onChange).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Decrease Size" }));
    expect(onChange).toHaveBeenLastCalledWith("4");
    await userEvent.type(field, "{ArrowDown}");
    expect(onChange).toHaveBeenLastCalledWith("4");
  });
});

describe("Suggest", () => {
  it("offers matching suggestions and fills the input", async () => {
    function Host() {
      const [v, setV] = useState("");
      return <Suggest label="Model" value={v} onChange={setV} suggestions={["opus", "sonnet"]} />;
    }
    render(<Host />);
    const input = screen.getByRole("combobox", { name: "Model" });
    await userEvent.type(input, "so");
    const list = screen.getByRole("listbox", { name: "Model" });
    expect(within(list).getAllByRole("option").map((o) => o.textContent)).toEqual(["sonnet"]);
    await userEvent.keyboard("{ArrowDown}{Enter}");
    expect(input).toHaveValue("sonnet");
  });

  it("accepts the first suggestion with Tab and stays open after a folder", async () => {
    function Host() {
      const [v, setV] = useState("~/w");
      const s = v === "~/www/" ? ["~/www/api/", "~/www/web/"] : ["~/www/"];
      return <Suggest label="Path" value={v} onChange={setV} suggestions={s} />;
    }
    render(<Host />);
    const input = screen.getByRole("combobox", { name: "Path" });
    await userEvent.click(input);
    await userEvent.keyboard("{Tab}");
    expect(input).toHaveValue("~/www/");
    expect(input).toHaveFocus();
    const list = screen.getByRole("listbox", { name: "Path" });
    expect(within(list).getAllByRole("option").map((o) => o.textContent)).toEqual(["~/www/api/", "~/www/web/"]);
    await userEvent.keyboard("{ArrowDown}{ArrowDown}{Enter}");
    expect(input).toHaveValue("~/www/web/");
  });
});

describe("Dialog and Toast", () => {
  it("is a modal dialog that closes on Escape and keeps focus inside", async () => {
    const onClose = vi.fn();
    render(
      <Dialog title="End session?" onClose={onClose}>
        <button>First</button>
        <button>Last</button>
      </Dialog>,
    );
    const dialog = screen.getByRole("dialog", { name: "End session?" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(screen.getByRole("button", { name: "First" })).toHaveFocus();
    await userEvent.tab();
    await userEvent.tab();
    expect(screen.getByRole("button", { name: "First" })).toHaveFocus();
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });

  it("shows a toast with its action", async () => {
    const onAction = vi.fn();
    render(<Toast message="The pane closed." action="Restart" onAction={onAction} />);
    expect(screen.getByRole("status")).toHaveTextContent("The pane closed.");
    await userEvent.click(screen.getByRole("button", { name: "Restart" }));
    expect(onAction).toHaveBeenCalled();
  });
});

describe("Slider", () => {
  function Tone({ onChange }: { onChange?: (v: number) => void }) {
    const [value, setValue] = useState(2);
    return (
      <Slider
        label="Terse to Chatty"
        low="Terse"
        high="Chatty"
        min={0}
        max={4}
        value={value}
        valueText={(v) => v + 1 + " of 5"}
        onChange={(v) => {
          setValue(v);
          onChange?.(v);
        }}
      />
    );
  }

  it("is a slider with its end labels and value, not a native range", () => {
    render(<Tone />);
    const s = screen.getByRole("slider", { name: "Terse to Chatty" });
    expect(s.tagName).not.toBe("INPUT");
    expect(s).toHaveAttribute("aria-valuemin", "0");
    expect(s).toHaveAttribute("aria-valuemax", "4");
    expect(s).toHaveAttribute("aria-valuenow", "2");
    expect(s).toHaveAttribute("aria-valuetext", "3 of 5");
    expect(screen.getByText("Terse")).toBeInTheDocument();
    expect(screen.getByText("Chatty")).toBeInTheDocument();
  });

  it("moves with the arrows, Home, End, PageUp and PageDown within its bounds", async () => {
    const onChange = vi.fn();
    render(<Tone onChange={onChange} />);
    const s = screen.getByRole("slider");
    s.focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(s).toHaveAttribute("aria-valuenow", "3");
    await userEvent.keyboard("{ArrowUp}{ArrowUp}");
    expect(s).toHaveAttribute("aria-valuenow", "4");
    await userEvent.keyboard("{Home}");
    expect(s).toHaveAttribute("aria-valuenow", "0");
    await userEvent.keyboard("{ArrowLeft}{ArrowDown}");
    expect(s).toHaveAttribute("aria-valuenow", "0");
    await userEvent.keyboard("{End}");
    expect(s).toHaveAttribute("aria-valuenow", "4");
    await userEvent.keyboard("{PageDown}");
    expect(s).toHaveAttribute("aria-valuenow", "2");
    await userEvent.keyboard("{PageUp}");
    expect(s).toHaveAttribute("aria-valuenow", "4");
    expect(onChange).toHaveBeenLastCalledWith(4);
  });

  it("takes the value at the pointer on the track and follows a drag", () => {
    render(<Tone />);
    const s = screen.getByRole("slider");
    s.getBoundingClientRect = () => ({ left: 100, width: 200, top: 0, right: 300, bottom: 4, height: 4, x: 100, y: 0, toJSON: () => ({}) });
    fireEvent.pointerDown(s, { clientX: 110, pointerId: 1 });
    expect(s).toHaveAttribute("aria-valuenow", "0");
    fireEvent.pointerMove(s, { clientX: 260, pointerId: 1 });
    expect(s).toHaveAttribute("aria-valuenow", "3");
    fireEvent.pointerUp(s, { pointerId: 1 });
    fireEvent.pointerMove(s, { clientX: 100, pointerId: 1 });
    expect(s).toHaveAttribute("aria-valuenow", "3");
  });
});

describe("Menu check", () => {
  it("draws the check of a chosen item as an icon, not a text mark", () => {
    render(<Menu label="Pick" items={[{ value: "a", label: "A", checked: true }, { value: "b", label: "B", checked: false }]} onPick={() => undefined} onClose={() => undefined} />);
    const item = screen.getByRole("menuitemcheckbox", { name: "A" });
    expect(item.querySelector(".ck svg")).not.toBeNull();
    expect(item).not.toHaveTextContent("✓");
    expect(screen.getByRole("menuitemcheckbox", { name: "B" }).querySelector(".ck svg")).toBeNull();
  });
});

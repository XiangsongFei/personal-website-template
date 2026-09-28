import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { AdminDropdown, type AdminDropdownOption } from "../src/AdminDropdown";

type Status = "study" | "graduation" | "open";
const englishOptions: AdminDropdownOption<Status>[] = [
  { value: "study", label: "Study" },
  { value: "graduation", label: "Graduation" },
  { value: "open", label: "Open" },
];

function Harness({ initial = "study" as Status | null, options = englishOptions, disabled = false, name = "Status type" }: {
  initial?: Status | null;
  options?: AdminDropdownOption<Status>[];
  disabled?: boolean;
  name?: string;
}) {
  const [value, setValue] = useState<Status | null>(initial);
  return <div>
    <label htmlFor="status-control">{name}</label>
    <AdminDropdown id="status-control" ariaLabel={name} value={value} options={options} onChange={setValue}
      placeholder="Choose a status" disabled={disabled} />
    <button type="button">Outside</button>
  </div>;
}

afterEach(() => cleanup());

describe("AdminDropdown", () => {
  it("opens, exposes localized options and selection, and accepts a click selection", () => {
    render(<Harness name="状态类型" options={[
      { value: "study", label: "学习" }, { value: "graduation", label: "毕业" }, { value: "open", label: "开放" },
    ]} />);
    const trigger = screen.getByRole("combobox", { name: "状态类型" });
    expect(trigger.textContent).toBe("学习");
    expect(trigger.hasAttribute("aria-valuetext")).toBe(false);
    expect(document.getElementById(trigger.getAttribute("aria-describedby")!)?.textContent).toBe("学习");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(trigger);
    const listbox = screen.getByRole("listbox", { name: "状态类型" });
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(within(listbox).getByRole("option", { name: "学习" }).getAttribute("aria-selected")).toBe("true");
    fireEvent.click(within(listbox).getByRole("option", { name: "毕业" }));
    expect(trigger.textContent).toBe("毕业");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });

  it("supports Arrow Up/Down, Home/End, and Enter selection", () => {
    render(<Harness />);
    const trigger = screen.getByRole("combobox", { name: "Status type" });
    fireEvent.keyDown(trigger, { key: "Enter" });
    const study = screen.getByRole("option", { name: "Study" });
    expect(study.getAttribute("data-active")).toBe("true");
    expect(trigger.getAttribute("aria-activedescendant")).toBe(study.id);
    expect(study.getAttribute("tabindex")).toBe("-1");
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    expect(screen.getByRole("option", { name: "Graduation" }).getAttribute("data-active")).toBe("true");
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    expect(screen.getByRole("option", { name: "Open" }).getAttribute("data-active")).toBe("true");
    fireEvent.keyDown(trigger, { key: "ArrowUp" });
    expect(screen.getByRole("option", { name: "Graduation" }).getAttribute("data-active")).toBe("true");
    fireEvent.keyDown(trigger, { key: "End" });
    expect(screen.getByRole("option", { name: "Open" }).getAttribute("data-active")).toBe("true");
    fireEvent.keyDown(trigger, { key: "Home" });
    expect(screen.getByRole("option", { name: "Study" }).getAttribute("data-active")).toBe("true");
    fireEvent.keyDown(trigger, { key: "End" });
    fireEvent.keyDown(trigger, { key: "Enter" });
    expect(trigger.textContent).toBe("Open");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    fireEvent.keyDown(trigger, { key: " " });
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    fireEvent.keyDown(trigger, { key: " " });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });

  it("closes on Escape or outside click and returns focus to the trigger on Escape", () => {
    render(<Harness />);
    const trigger = screen.getByRole("combobox", { name: "Status type" });
    fireEvent.click(trigger);
    fireEvent.keyDown(trigger, { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(document.activeElement).toBe(trigger);
    fireEvent.click(trigger);
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("keeps disabled controls and disabled placeholder options non-interactive", () => {
    const options: AdminDropdownOption<Status>[] = [
      { value: null, label: "Uncategorized", disabled: true },
      ...englishOptions,
    ];
    const { rerender } = render(<Harness initial={null} options={options} />);
    const trigger = screen.getByRole("combobox", { name: "Status type" });
    expect(trigger.textContent).toBe("Uncategorized");
    fireEvent.click(trigger);
    const placeholder = screen.getByRole("option", { name: "Uncategorized" });
    expect(placeholder.getAttribute("aria-selected")).toBe("true");
    expect(placeholder.getAttribute("aria-disabled")).toBe("true");
    expect(placeholder.getAttribute("tabindex")).toBe("-1");
    fireEvent.click(placeholder);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    fireEvent.keyDown(trigger, { key: "Escape" });

    rerender(<Harness initial="study" options={englishOptions} disabled />);
    const disabledTrigger = screen.getByRole("combobox", { name: "Status type" }) as HTMLButtonElement;
    expect(disabledTrigger.disabled).toBe(true);
    fireEvent.click(disabledTrigger);
    fireEvent.keyDown(disabledTrigger, { key: "ArrowDown" });
    expect(disabledTrigger.getAttribute("aria-expanded")).toBe("false");
  });

  it("keeps listbox options out of the Tab order and supports programmatic keyboard activation", () => {
    render(<Harness />);
    const trigger = screen.getByRole("combobox", { name: "Status type" });
    fireEvent.click(trigger);
    const graduation = screen.getByRole("option", { name: "Graduation" }) as HTMLElement;
    expect(graduation.getAttribute("tabindex")).toBe("-1");
    graduation.focus();
    fireEvent.keyDown(graduation, { key: "Enter" });
    expect(trigger.textContent).toBe("Graduation");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(trigger);
  });

  it("shows an optional placeholder as a disabled option when no value is selected", () => {
    render(<Harness initial={null} options={englishOptions} />);
    const trigger = screen.getByRole("combobox", { name: "Status type" });
    expect(trigger.textContent).toBe("Choose a status");
    fireEvent.click(trigger);
    const placeholder = screen.getByRole("option", { name: "Choose a status" });
    expect(placeholder.getAttribute("aria-selected")).toBe("true");
    expect(placeholder.getAttribute("aria-disabled")).toBe("true");
  });

  it("uses updated option labels and scrolls an offscreen active option into view", () => {
    const options = [...englishOptions];
    const { rerender } = render(<Harness options={options} />);
    rerender(<Harness options={[
      { value: "study", label: "Study" }, { value: "graduation", label: "Graduation" }, { value: "open", label: "Currently Open" },
    ]} />);
    const listbox = document.querySelector<HTMLElement>(".admin-dropdown-listbox")!;
    const study = Array.from(listbox.querySelectorAll<HTMLElement>("[role=option]"))
      .find(option => option.textContent === "Study")!;
    const open = Array.from(listbox.querySelectorAll<HTMLElement>("[role=option]"))
      .find(option => option.textContent === "Currently Open")!;
    const scrollIntoView = vi.fn();
    Object.defineProperty(listbox, "clientHeight", { configurable: true, value: 50 });
    listbox.getBoundingClientRect = () => ({ top: 100, bottom: 150 } as DOMRect);
    (study as HTMLElement).getBoundingClientRect = () => ({ top: 110, bottom: 130 } as DOMRect);
    (open as HTMLElement).getBoundingClientRect = () => ({ top: 150, bottom: 170 } as DOMRect);
    Object.defineProperty(open, "scrollIntoView", { configurable: true, value: scrollIntoView });

    const trigger = screen.getByRole("combobox", { name: "Status type" });
    fireEvent.click(trigger);
    expect(scrollIntoView).not.toHaveBeenCalled();
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    expect(open.getAttribute("data-active")).toBe("true");
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });
  });
});

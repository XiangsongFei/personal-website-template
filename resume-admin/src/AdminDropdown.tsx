import { useEffect, useId, useRef, useState } from "react";

export type AdminDropdownOption<T extends string> = {
  value: T | null;
  label: string;
  disabled?: boolean;
};

export function AdminDropdown<T extends string>({
  id,
  ariaLabel,
  value,
  options,
  onChange,
  placeholder,
  disabled = false,
}: {
  id?: string;
  ariaLabel?: string;
  value: T | null;
  options: readonly AdminDropdownOption<T>[];
  onChange: (value: T) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  const generatedId = useId();
  const controlId = id ?? `admin-dropdown-${generatedId}`;
  const listboxId = `${controlId}-listbox`;
  const enabledValues = options.filter(option => !option.disabled && option.value !== null).map(option => option.value as T);
  const initialActive = value !== null && enabledValues.includes(value) ? value : enabledValues[0] ?? null;
  const [open, setOpen] = useState(false);
  const [activeOption, setActiveOption] = useState<T | null>(initialActive);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const activeOptionRef = useRef<HTMLDivElement>(null);
  const currentLabel = options.find(option => option.value === value)?.label ?? placeholder ?? "";

  useEffect(() => {
    if (!open) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointer);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const option = activeOptionRef.current;
    const listbox = option?.closest<HTMLElement>("[role=\"listbox\"]");
    if (!option || !listbox) return;
    const viewportTop = listbox.getBoundingClientRect().top + listbox.clientTop;
    const viewportBottom = viewportTop + listbox.clientHeight;
    const optionRect = option.getBoundingClientRect();
    if (optionRect.top < viewportTop || optionRect.bottom > viewportBottom) {
      option.scrollIntoView?.({ block: "nearest" });
    }
  }, [activeOption, open]);

  const show = (initial: T | null = value) => {
    setActiveOption(initial !== null && enabledValues.includes(initial) ? initial : enabledValues[0] ?? null);
    setOpen(true);
  };
  const choose = (next: T) => {
    if (next !== value) onChange(next);
    setOpen(false);
    triggerRef.current?.focus();
  };
  const handleOptionKeyDown = (event: React.KeyboardEvent<HTMLDivElement>, option: AdminDropdownOption<T>) => {
    if (option.disabled || option.value === null) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      choose(option.value);
    }
  };
  const moveActive = (direction: -1 | 1) => {
    if (enabledValues.length === 0) return;
    const indexOfActive = activeOption === null ? -1 : enabledValues.indexOf(activeOption);
    const currentIndex = indexOfActive >= 0 ? indexOfActive : 0;
    setActiveOption(enabledValues[(currentIndex + direction + enabledValues.length) % enabledValues.length]);
  };
  const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;
    if (event.key === "Tab") { setOpen(false); return; }
    if (event.key === "Escape" && open) {
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) show();
      else moveActive(event.key === "ArrowDown" ? 1 : -1);
    } else if (event.key === "Home" || event.key === "End") {
      if (enabledValues.length === 0) return;
      event.preventDefault();
      if (!open) setOpen(true);
      setActiveOption(event.key === "Home" ? enabledValues[0] : enabledValues[enabledValues.length - 1]);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (!open) show();
      else if (activeOption !== null) choose(activeOption);
    }
  };

  return <div className={`admin-dropdown-control${open ? " is-open" : ""}`} ref={rootRef}>
    <button ref={triggerRef} id={controlId} type="button" role="combobox" aria-label={ariaLabel}
      aria-describedby={`${controlId}-value`} aria-haspopup="listbox" aria-expanded={open} aria-controls={listboxId}
      aria-activedescendant={open && activeOption !== null ? `${listboxId}-option-${activeOption}` : undefined}
      disabled={disabled} onKeyDown={handleKeyDown} onClick={() => open ? setOpen(false) : show()}>
      <span id={`${controlId}-value`} className="admin-dropdown-value">{currentLabel}</span>
    </button>
    <div id={listboxId} role="listbox" aria-label={ariaLabel} className="admin-dropdown-listbox" hidden={!open}>
      {value === null && placeholder && !options.some(option => option.value === null) &&
        <div id={`${listboxId}-option-placeholder`} role="option" tabIndex={-1} aria-selected="true" aria-disabled="true">{placeholder}</div>}
      {options.map(option => {
        const selected = option.value === value;
        const active = option.value !== null && option.value === activeOption;
        const optionId = `${listboxId}-option-${option.value ?? "placeholder"}`;
        return <div key={option.value ?? "placeholder"} id={optionId} role="option" tabIndex={-1} aria-selected={selected}
          aria-disabled={option.disabled || undefined} data-active={active || undefined}
          ref={active ? activeOptionRef : undefined}
          onMouseDown={event => event.preventDefault()}
          onKeyDown={event => handleOptionKeyDown(event, option)}
          onClick={() => { if (!option.disabled && option.value !== null) choose(option.value); }}>
          {option.label}
        </div>;
      })}
    </div>
  </div>;
}

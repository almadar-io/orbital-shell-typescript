import React, { useState, useRef, useId } from "react";
import type { A11yProps, EventEmit } from "@almadar/core";
import { cn } from "../lib/cn";
import { Icon } from "./Icon";
import { Button } from "./Button";
import { Label } from "./Label";
import { Typography } from "./Typography";
import { useEventBus } from "../hooks/useEventBus";
import { useTranslate } from "../hooks/useTranslate";
import { useDialogBehavior } from "../hooks/useDialogBehavior";
import { domPassthrough } from "../lib/domPassthrough";

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
  /** Leading content rendered in rich mode only (native mode ignores this). */
  icon?: React.ReactNode;
  /** Secondary line of text rendered below label in rich mode only. */
  secondaryLabel?: string;
  /** dir attribute applied to the option row in rich mode only. */
  dir?: string;
}

export interface SelectOptionGroup {
  label: string;
  options: SelectOption[];
}

/** @accessibleName label */
export interface SelectProps extends Omit<
  React.SelectHTMLAttributes<HTMLSelectElement>,
  "children" | "onChange" | "multiple" | keyof A11yProps
>, A11yProps {
  /** Additional CSS classes applied to the root element. */
  className?: string;
  /** Visible label naming the control. */
  label?: string;
  /** Select options (flat list) */
  options?: SelectOption[];
  /** Grouped options — rendered as <optgroup> in native mode, sections in rich mode. */
  groups?: SelectOptionGroup[];
  /** Placeholder text */
  placeholder?: string;
  /** Current value (string for single, string[] for multiple) */
  value?: string | string[];
  /** Declarative event name for trait dispatch — emits `{ value }` on selection commit (same gestures as `onChange`). */
  action?: EventEmit<{ value: string | string[] }>;
  /** Error message */
  error?: string;
  /** Allow selecting multiple values — activates the rich dropdown. */
  multiple?: boolean;
  /** Show a search input inside the dropdown — activates the rich dropdown. */
  searchable?: boolean;
  /** Show a clear button when a value is selected. */
  clearable?: boolean;
  /** onChange handler (native ChangeEvent) or declarative event key for trait dispatch */
  onChange?: React.ChangeEventHandler<HTMLSelectElement> | EventEmit<{ value: string | string[] }>;
  /** Value-based change: a React callback (internal use) OR a declarative event
   *  key that emits `{ value }` on the bus (render-ui / lolo authoring). Mirrors
   *  the `onChange` handler|event convention so it's an event-emitting prop, not a
   *  bare callback. */
  onValueChange?: ((value: string | string[]) => void) | EventEmit<{ value: string | string[] }>;
}

/** Dispatch an `onValueChange` value: emit on the bus when it's a declarative
 *  event key (string), otherwise invoke the React callback. Mirrors the inline
 *  `onChange` handling so both prop forms work. */
function dispatchValueChange(
  onValueChange: SelectProps["onValueChange"],
  eventBus: ReturnType<typeof useEventBus>,
  value: string | string[],
): void {
  if (typeof onValueChange === "string") {
    eventBus.emit(`UI:${onValueChange}`, { value });
  } else {
    onValueChange?.(value);
  }
}

// Flat list of all options across flat + grouped sources
function flatOptions(opts?: SelectOption[], groups?: SelectOptionGroup[]): SelectOption[] {
  const flat = opts ?? [];
  const grp = (groups ?? []).flatMap((g) => g.options);
  return [...flat, ...grp];
}

// Native <select> path: used when multiple/searchable/clearable are all false
function NativeSelect({
  className,
  options,
  groups,
  placeholder,
  error,
  label,
  onChange,
  onValueChange,
  action,
  value,
  ...props
}: Omit<SelectProps, "multiple" | "searchable" | "clearable">) {
  const eventBus = useEventBus();
  const generatedId = useId();
  const fieldId = props.id ?? generatedId;
  const errorId = error ? `${fieldId}-error` : undefined;
  const describedBy = [props["aria-describedby"], errorId].filter(Boolean).join(" ") || undefined;

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    if (typeof onChange === "string") {
      eventBus.emit(`UI:${onChange}`, { value: e.target.value });
    } else {
      onChange?.(e);
    }
    dispatchValueChange(onValueChange, eventBus, e.target.value);
    if (action) {
      eventBus.emit(`UI:${action}`, { value: e.target.value });
    }
  };

  return (
    <div className="relative">
      {label && <Label htmlFor={fieldId} className="mb-1">{label}</Label>}
      <div className="relative">
      <select
        onChange={handleChange}
        value={value as string | undefined}
        className={cn(
          "block w-full rounded-interactive border-[length:var(--border-width)] shadow-elevation-interactive interactive-border appearance-none",
          "px-3 py-2 pr-10 text-sm text-foreground font-medium",
          "bg-card",
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-0 focus-visible:ring-ring",
          "disabled:bg-muted disabled:text-muted-foreground disabled:cursor-not-allowed",
          error
            ? "border-error focus:border-error"
            : "border-border focus:border-primary",
          className,
        )}
        {...(props as React.SelectHTMLAttributes<HTMLSelectElement>)}
        id={fieldId}
        aria-invalid={error ? true : undefined}
        aria-required={props.required ? true : undefined}
        aria-describedby={describedBy}
      >
        {placeholder && (
          <option value="" disabled>
            {placeholder}
          </option>
        )}
        {options?.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
        {groups?.map((group) => (
          <optgroup key={group.label} label={group.label}>
            {group.options.map((option) => (
              <option key={option.value} value={option.value} disabled={option.disabled}>
                {option.label}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
        <Icon name="chevron-down" className="h-icon-default w-icon-default text-foreground" />
      </div>
      </div>
      {error && <Typography id={errorId} variant="caption" color="error" className="mt-1">{error}</Typography>}
    </div>
  );
}

// Rich dropdown path: used when multiple/searchable/clearable is set
function RichSelect({
  className,
  options,
  groups,
  placeholder,
  error,
  label,
  onChange,
  onValueChange,
  action,
  value,
  multiple,
  searchable,
  clearable,
  disabled,
  required,
  ...rest
}: SelectProps) {
  const eventBus = useEventBus();
  const { t } = useTranslate();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [activeIndex, setActiveIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const baseId = useId();
  const passthrough = domPassthrough(rest);
  const triggerId = typeof passthrough.id === "string" ? passthrough.id : `${baseId}-trigger`;
  const listId = `${baseId}-list`;
  const errorId = error ? `${baseId}-error` : undefined;
  const describedBy = [passthrough["aria-describedby"], errorId].filter(Boolean).join(" ") || undefined;
  const optionId = (index: number) => `${baseId}-opt-${index}`;

  const selected: string[] = multiple
    ? Array.isArray(value) ? value : value ? [value] : []
    : value ? [value as string] : [];

  const all = flatOptions(options, groups);
  const matches = (o: SelectOption) =>
    !(searchable && search) || o.label.toLowerCase().includes(search.toLowerCase());
  const useGroups = Boolean(groups && groups.length > 0);
  const visible: SelectOption[] = useGroups
    ? (groups ?? []).flatMap((g) => g.options.filter(matches))
    : all.filter(matches);
  const indexOf = new Map(visible.map((o, i) => [o, i]));

  const closeList = () => {
    setOpen(false);
    setSearch("");
    setActiveIndex(-1);
  };

  useDialogBehavior({
    open,
    containerRef,
    onEscape: closeList,
    modal: false,
    returnFocusRef: triggerRef,
  });

  const emitValue = (next: string | string[]) => {
    if (typeof onChange === "string") {
      eventBus.emit(`UI:${onChange}`, { value: next });
    }
    dispatchValueChange(onValueChange, eventBus, next);
    if (action) {
      eventBus.emit(`UI:${action}`, { value: next });
    }
  };

  const toggle = (optValue: string) => {
    if (multiple) {
      emitValue(
        selected.includes(optValue)
          ? selected.filter((v) => v !== optValue)
          : [...selected, optValue],
      );
    } else {
      closeList();
      triggerRef.current?.focus();
      emitValue(optValue);
    }
  };

  const clear = (e: React.MouseEvent) => {
    e.stopPropagation();
    emitValue(multiple ? [] : "");
  };

  React.useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        closeList();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const step = (from: number, dir: 1 | -1): number => {
    for (let i = from + dir; i >= 0 && i < visible.length; i += dir) {
      if (!visible[i].disabled) return i;
    }
    return from;
  };
  const firstEnabled = (): number => step(-1, 1);
  const lastEnabled = (): number => {
    const last = step(visible.length, -1);
    return last === visible.length ? -1 : last;
  };

  const openList = (at: "selected" | "first" | "last") => {
    if (disabled) return;
    setOpen(true);
    const selectedIdx = visible.findIndex((o) => selected.includes(o.value) && !o.disabled);
    if (at === "last") setActiveIndex(lastEnabled());
    else setActiveIndex(at === "selected" && selectedIdx >= 0 ? selectedIdx : firstEnabled());
  };

  const scrollTo = (index: number) => {
    requestAnimationFrame(() => document.getElementById(optionId(index))?.scrollIntoView?.({ block: "nearest" }));
  };
  const moveTo = (index: number) => {
    setActiveIndex(index);
    if (index >= 0) scrollTo(index);
  };

  const typeAhead = (e: React.KeyboardEvent<HTMLElement>) => {
    const typed = e.key.toLowerCase();
    const hit = visible.findIndex((o) => !o.disabled && o.label.toLowerCase().startsWith(typed));
    if (hit < 0) return;
    e.preventDefault();
    if (!open) setOpen(true);
    moveTo(hit);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLElement>) => {
    const fromSearch = e.currentTarget !== triggerRef.current;
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        if (!open) openList("selected");
        else moveTo(activeIndex < 0 ? firstEnabled() : step(activeIndex, 1));
        return;
      case "ArrowUp":
        e.preventDefault();
        if (!open) openList("last");
        else moveTo(activeIndex < 0 ? lastEnabled() : step(activeIndex, -1));
        return;
      case "Home":
        if (!open || fromSearch) return;
        e.preventDefault();
        moveTo(firstEnabled());
        return;
      case "End":
        if (!open || fromSearch) return;
        e.preventDefault();
        moveTo(lastEnabled());
        return;
      case "Enter":
        e.preventDefault();
        if (!open) openList("selected");
        else if (activeIndex >= 0) toggle(visible[activeIndex].value);
        return;
      case " ":
        if (fromSearch) return;
        e.preventDefault();
        if (!open) openList("selected");
        else if (activeIndex >= 0) toggle(visible[activeIndex].value);
        return;
      case "Tab":
        if (open) closeList();
        return;
      default:
        if (fromSearch || e.key.length !== 1) return;
        typeAhead(e);
    }
  };

  const displayLabel = selected.length === 0
    ? (placeholder ?? "")
    : multiple
      ? t("select.nSelected", { count: selected.length })
      : (all.find((o) => o.value === selected[0])?.label ?? selected[0]);

  const hasValue = selected.length > 0;
  const activeId = open && activeIndex >= 0 ? optionId(activeIndex) : undefined;

  const renderOptions = (opts: SelectOption[]) =>
    opts.map((opt) => {
      const index = indexOf.get(opt) ?? -1;
      const isSelected = selected.includes(opt.value);
      return (
        <div
          key={opt.value}
          id={optionId(index)}
          role="option"
          aria-selected={isSelected}
          aria-disabled={opt.disabled ? true : undefined}
          dir={opt.dir}
          onClick={() => !opt.disabled && toggle(opt.value)}
          onMouseMove={() => !opt.disabled && index !== activeIndex && setActiveIndex(index)}
          className={cn(
            "w-full flex items-center justify-between px-3 py-1.5 text-sm text-start cursor-pointer",
            "hover:bg-muted transition-colors",
            opt.disabled && "opacity-50 cursor-not-allowed",
            isSelected && "text-primary font-medium",
            index === activeIndex && "bg-muted",
          )}
        >
          <span className="flex items-center gap-2 min-w-0">
            {opt.icon != null && (
              <span className="shrink-0 flex items-center">{opt.icon}</span>
            )}
            <span className="flex flex-col min-w-0">
              <span>{opt.label}</span>
              {opt.secondaryLabel != null && (
                <span className="text-xs text-muted-foreground font-normal">{opt.secondaryLabel}</span>
              )}
            </span>
          </span>
          {isSelected && (
            <Icon name="check" className="h-icon-default w-icon-default shrink-0" />
          )}
        </div>
      );
    });

  const labelledBy = typeof passthrough["aria-labelledby"] === "string" ? passthrough["aria-labelledby"] : undefined;
  const ariaLabel = typeof passthrough["aria-label"] === "string" ? passthrough["aria-label"] : undefined;
  const listName = label ?? ariaLabel;

  return (
    <div ref={containerRef} className={cn("relative w-full", className)}>
      {label && <Label htmlFor={triggerId} className="mb-1">{label}</Label>}
      <div className="relative w-full">
        <button
          {...passthrough}
          ref={triggerRef}
          id={triggerId}
          type="button"
          role="combobox"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={listId}
          aria-activedescendant={activeId}
          aria-labelledby={labelledBy}
          aria-invalid={error ? true : undefined}
          aria-required={required ? true : undefined}
          aria-describedby={describedBy}
          disabled={disabled}
          onClick={() => !disabled && (open ? closeList() : openList("selected"))}
          onKeyDown={handleKeyDown}
          className={cn(
            "block w-full rounded-interactive border-[length:var(--border-width)] shadow-elevation-interactive interactive-border",
            "px-3 py-2 pr-10 text-sm text-start font-medium",
            "bg-card rounded-interactive",
            "focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-0 focus-visible:ring-ring",
            "disabled:bg-muted disabled:text-muted-foreground disabled:cursor-not-allowed",
            error ? "border-error focus:border-error" : "border-border focus:border-primary",
            !hasValue && "text-muted-foreground",
          )}
        >
          {displayLabel}
        </button>
        <div className="absolute inset-y-0 right-0 pr-3 flex items-center gap-1 pointer-events-none">
          {clearable && hasValue && (
            <Button
              variant="ghost"
              size="sm"
              icon="x"
              aria-label={t("aria.clearSelection")}
              onClick={clear}
              className="pointer-events-auto text-muted-foreground hover:text-foreground"
            />
          )}
          <Icon name="chevron-down" className="h-icon-default w-icon-default text-foreground" />
        </div>
        {open && (
          <div className={cn(
            "absolute z-50 mt-1 w-full",
            "bg-card border-[length:var(--border-width)] border-border",
            "surface-material rounded-container shadow-elevation-popover py-1 max-h-60 overflow-y-auto",
          )}>
            {searchable && (
              <div className="px-2 pb-1 border-b border-border">
                <input
                  autoFocus
                  type="search"
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setActiveIndex(0);
                  }}
                  onKeyDown={handleKeyDown}
                  aria-label={t("aria.searchOptions")}
                  aria-controls={listId}
                  aria-activedescendant={activeId}
                  placeholder={t("select.searchPlaceholder")}
                  className={cn(
                    "w-full px-2 py-1 text-sm bg-transparent rounded-interactive",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    "text-foreground placeholder:text-muted-foreground",
                  )}
                />
              </div>
            )}
            <div id={listId} role="listbox" aria-multiselectable={multiple ? true : undefined} aria-labelledby={listName ? undefined : labelledBy} aria-label={listName}>
              {useGroups
                ? (groups ?? []).map((g, gi) => {
                    const groupFiltered = g.options.filter(matches);
                    if (groupFiltered.length === 0) return null;
                    const groupLabelId = `${baseId}-group-${gi}`;
                    return (
                      <div key={g.label} role="group" aria-labelledby={groupLabelId}>
                        <div id={groupLabelId} className="px-3 py-1 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                          {g.label}
                        </div>
                        {renderOptions(groupFiltered)}
                      </div>
                    );
                  })
                : renderOptions(visible)}
            </div>
          </div>
        )}
      </div>
      {error && <Typography id={errorId} variant="caption" color="error" className="mt-1">{error}</Typography>}
    </div>
  );
}

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  (props, _ref) => {
    const { multiple, searchable, clearable } = props;
    if (multiple || searchable || clearable) {
      return <RichSelect {...props} />;
    }
    return <NativeSelect {...props} />;
  },
);

Select.displayName = "Select";

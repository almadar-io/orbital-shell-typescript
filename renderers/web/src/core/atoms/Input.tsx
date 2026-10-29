import React from "react";
import type { A11yProps, EventKey, EventEmit, EventPayload } from "@almadar/core";
import { cn } from "../lib/cn";
import { Icon, resolveIcon, type IconInput } from "./Icon";
import { Button } from "./Button";
import { useTranslate } from "../hooks/useTranslate";
import { useEventBus } from "../hooks/useEventBus";

export interface SelectOption {
  value: string;
  label: string;
}

/**
 * @accessibleName label
 * @role textbox
 * @tokens --color-card --color-border --color-foreground --color-muted-foreground
 * @contrast foreground card
 * @motion css
 */
export interface InputProps extends Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "onChange" | Exclude<keyof A11yProps, "role" | "dir">
>, Omit<A11yProps, "role" | "dir"> {
  /** Additional CSS classes applied to the root element. */
  className?: string;
  /** Placeholder text */
  placeholder?: string;
  /** Current value */
  value?: string | number;
  /** Whether input is disabled */
  disabled?: boolean;
  /** Declarative event name for trait dispatch.
   *  @payloadTypeWhen value inputType=number->number
   */
  action?: EventEmit<{ value: string | number }>;
  /**
   * Input type — selects the field's data mode. Use 'password' for masked
   * credentials / secret / passphrase entry (there is no separate password
   * pattern); 'email', 'tel', 'url', 'number', 'search', 'date', and 'time'
   * for their respective values; and 'select' / 'textarea' for choice and
   * multi-line entry in addition to the standard single-line types.
   */
  inputType?:
  | "text"
  | "email"
  | "password"
  | "number"
  | "tel"
  | "url"
  | "search"
  | "date"
  | "datetime-local"
  | "time"
  | "checkbox"
  | "select"
  | "textarea";
  label?: string;
  helperText?: string;
  error?: string;
  leftIcon?: IconInput;
  rightIcon?: IconInput;
  /** Lucide icon component or canonical kebab-case icon name string for left side */
  icon?: IconInput;
  /** Show clear button when input has value */
  clearable?: boolean;
  /** Callback or declarative event key when clear button is clicked */
  onClear?: (() => void) | EventKey;
  /** Options for select type */
  options?: SelectOption[];
  /** Rows for textarea type */
  rows?: number;
  /** onChange handler or declarative event key for trait dispatch */
  onChange?: React.ChangeEventHandler<
    HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
  > | EventEmit<{ value: string } | { checked: boolean }>;
}

export const Input = React.forwardRef<
  HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
  InputProps
>(
  (
    {
      className,
      inputType,
      type: htmlType,
      label,
      helperText,
      error,
      leftIcon,
      rightIcon,
      icon: iconProp,
      clearable,
      onClear,
      action,
      value,
      options,
      rows = 3,
      onChange,
      ...props
    },
    ref,
  ) => {
    const { t } = useTranslate();
    const eventBus = useEventBus();
    // inputType takes precedence over type, default to "text"
    const type = inputType || htmlType || "text";

    // The label names the field and the helper/error text describes it, so a
    // label click focuses it and assistive tech (and getByLabelText) find it.
    const generatedId = React.useId();
    const fieldId = props.id ?? generatedId;
    const descriptionId = helperText || error ? `${fieldId}-description` : undefined;
    const describedBy = [props["aria-describedby"], descriptionId].filter(Boolean).join(" ") || undefined;
    const a11yProps = {
      id: fieldId,
      "aria-invalid": error ? true : props["aria-invalid"],
      "aria-required": props.required ? true : undefined,
      "aria-describedby": describedBy,
    };

    // Declarative mode (onChange is an event-key string): the value round-trips
    // through the circuit — emit → set → frame → re-render — with arbitrary
    // lag, and a plain controlled input clobbers the DOM back to the lagging
    // frame value on every commit, eating keystrokes typed in between. Echo
    // cancellation, same contract as the bus layer's bridgeEchoPendingRef:
    // a value this input EMITTED is its own echo and never overwrites the DOM;
    // a value it never emitted (a SEND clearing the draft, another tab's
    // write) is genuinely external and applies.
    const isDeclarative = typeof onChange === "string";
    const [localValue, setLocalValue] = React.useState<string | number | undefined>(value);
    const pendingEchoRef = React.useRef<Set<string>>(new Set());
    React.useEffect(() => {
      if (!isDeclarative) return;
      const incoming = value == null ? "" : String(value);
      if (pendingEchoRef.current.has(incoming)) {
        pendingEchoRef.current.delete(incoming);
        return;
      }
      pendingEchoRef.current.clear();
      setLocalValue(value);
    }, [value, isDeclarative]);
    const displayValue = isDeclarative ? localValue : value;
    const resolveIconNode = (i: IconInput | undefined, cls: string) => {
      if (!i) return null;
      if (typeof i === "string") return <Icon name={i} className={cls} />;
      const C = i;
      return <C className={cls} />;
    };
    const iconCls = "h-icon-default w-icon-default";
    const IconComponent =
      typeof iconProp === "string" ? resolveIcon(iconProp) : iconProp;
    const resolvedLeftIcon =
      (leftIcon ? resolveIconNode(leftIcon, iconCls) : null) ||
      (IconComponent && <IconComponent className={iconCls} />);
    const showClearButton = clearable && displayValue && String(displayValue).length > 0;

    const isMultiline = type === "textarea";
    const baseClassName = cn(
      "block w-full rounded-interactive transition-all duration-fast",
      "border-[length:var(--border-width-thin)] border-border interactive-border",
      isMultiline ? "px-3 py-2 text-sm" : "h-input-md px-3 text-sm",
      "bg-card hover:bg-muted focus:bg-card",
      "text-foreground placeholder:text-muted-foreground",
      "focus:outline-none focus:ring-1 focus:ring-ring focus:border-ring",
      "disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-muted",
      error
        ? "border-error focus:border-error focus:ring-error"
        : "",
      resolvedLeftIcon && "pl-10",
      (rightIcon || showClearButton) && "pr-10",
      className,
    );

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
      if (typeof onChange === 'string') {
        const target = e.target as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
        const payload: EventPayload = type === 'checkbox'
          ? { checked: (target as HTMLInputElement).checked }
          : { value: target.value };
        if (type !== 'checkbox') {
          pendingEchoRef.current.add(target.value);
          setLocalValue(target.value);
        }
        eventBus.emit(`UI:${onChange}`, payload);
      } else {
        onChange?.(e);
      }
    };

    const handleClear = () => {
      if (typeof onClear === 'string') {
        eventBus.emit(`UI:${onClear}`, {});
      } else {
        onClear?.();
      }
    };

    // `action` is the declarative event dispatched on the input's primary
    // gesture — Enter/submit (the text-input analog of Button's on-click).
    // Consuming it here also keeps `action` off `...props`, so it never
    // reaches the native <input> (React warns: "You can only pass the action
    // prop to <form>").
    //
    // `inputType: "number"` narrows the compiled trait's declared `value`
    // payload to `number` (§61 OPEN 1) — coerce here so the emitted payload
    // actually is one. Keystroke state stays the raw string (partial input
    // like "3." is a valid string mid-type); only the EMITTED value is
    // coerced. Neither an empty field nor a non-numeric raw value (`Number`
    // would yield `NaN`, e.g. `Number('')` is 0 — not a valid signal either
    // way) has a real number to emit, so the gesture is suppressed entirely
    // rather than emit a required `value` field that is missing or NaN.
    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (!action || e.key !== 'Enter') return;
      const raw = e.currentTarget.value;
      if (type === 'number') {
        if (raw.trim() === '') return;
        const numeric = Number(raw);
        if (Number.isNaN(numeric)) return;
        eventBus.emit(`UI:${action}`, { value: numeric });
        return;
      }
      eventBus.emit(`UI:${action}`, { value: raw });
    };

    const wrapField = (field: React.ReactNode, fullWidth = true) => (
      <div className={fullWidth ? "w-full" : "w-fit"}>
        {label && (
          <label htmlFor={fieldId} className="block text-sm font-medium text-foreground mb-1">
            {label}
          </label>
        )}
        {field}
        {(helperText || error) && (
          <p id={descriptionId} className={cn("mt-1 text-xs", error ? "text-error" : "text-muted-foreground")}>
            {error ?? helperText}
          </p>
        )}
      </div>
    );

    // Handle select type
    if (type === "select") {
      return wrapField(
        <div className="relative w-full">
          {resolvedLeftIcon && (
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-muted-foreground">
              {resolvedLeftIcon}
            </div>
          )}
          <select
            ref={ref as React.Ref<HTMLSelectElement>}
            value={displayValue as string}
            onChange={handleChange as React.ChangeEventHandler<HTMLSelectElement>}
            className={cn(baseClassName, "appearance-none pr-10", className)}
            {...(props as React.SelectHTMLAttributes<HTMLSelectElement>)}
            {...a11yProps}
          >
            <option value="">{t('form.selectPlaceholder', { label: '' })}</option>
            {options?.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none text-muted-foreground">
            <Icon name="chevron-down" className="h-icon-default w-icon-default" />
          </div>
        </div>
      );
    }

    // Handle textarea type
    if (type === "textarea") {
      return wrapField(
        <div className="relative w-full">
          <textarea
            ref={ref as React.Ref<HTMLTextAreaElement>}
            value={displayValue as string}
            onChange={handleChange as React.ChangeEventHandler<HTMLTextAreaElement>}
            rows={rows}
            className={baseClassName}
            {...(props as React.TextareaHTMLAttributes<HTMLTextAreaElement>)}
            {...a11yProps}
          />
        </div>
      );
    }

    // Handle checkbox type
    if (type === "checkbox") {
      return wrapField(
        <input
          ref={ref as React.Ref<HTMLInputElement>}
          type="checkbox"
          checked={props.checked}
          onChange={handleChange as React.ChangeEventHandler<HTMLInputElement>}
          className={cn(
            "h-icon-default w-icon-default rounded-interactive",
            "border-border",
            "text-primary focus:ring-ring",
            "disabled:opacity-50 disabled:cursor-not-allowed",
            className,
          )}
          {...props}
          {...a11yProps}
        />,
        false,
      );
    }

    // Standard input types
    return wrapField(
      <div className="relative w-full">
        {resolvedLeftIcon && (
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-muted-foreground">
            {resolvedLeftIcon}
          </div>
        )}
        <input
          ref={ref as React.Ref<HTMLInputElement>}
          type={type}
          value={displayValue}
          onChange={handleChange as React.ChangeEventHandler<HTMLInputElement>}
          onKeyDown={handleKeyDown}
          className={baseClassName}
          {...props}
          {...a11yProps}
        />
        {showClearButton && (
          <Button
            variant="ghost"
            size="sm"
            icon="x"
            aria-label={t("aria.clearInput")}
            onClick={handleClear}
            className="absolute inset-y-0 right-0 text-muted-foreground hover:text-foreground"
          />
        )}
        {rightIcon && !showClearButton && (
          <div className="absolute inset-y-0 right-0 pr-3 flex items-center text-muted-foreground">
            {resolveIconNode(rightIcon, iconCls)}
          </div>
        )}
      </div>
    );
  },
);

Input.displayName = "Input";
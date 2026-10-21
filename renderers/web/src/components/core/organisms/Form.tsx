'use client';
/**
 * Form Organism Component
 *
 * A form container component with submit/reset handling.
 * Supports both children-based and schema-based form generation.
 * Renders correct input types based on field definitions including relations.
 *
 * Extended for inspection forms with:
 * - Conditional field visibility via S-expressions
 * - Hidden calculations that emit GLOBAL_VARIABLE_SET events
 * - Violation triggers that emit VIOLATION_DETECTED events
 * - Nested sections with collapsible support
 */

import { actionTestId, FORM_PATTERN } from '@almadar/core';
import React from "react";
import type { A11yProps, ControlValue, EntityRow, EventEmit, EventKey, EventPayload, FieldValue, FormSubmitPayload, SkeletonSpec } from "@almadar/core";
import { cn } from '../../../core';
import { toDateInputValue, toDateTimeInputValue } from '../../../core';
import { Input } from '../../../core';
import { Button } from '../../../core';
import { Select, type SelectOption } from '../../../core';
import { Textarea } from '../../../core';
import { Checkbox } from '../../../core';
import { Box } from '../../../core';
import { VStack, HStack } from '../../../core';
import { Typography } from '../../../core';
import { Icon } from '../../../core';
import {
  RelationSelect,
  MANY_CARDINALITIES,
  type RelationOption,
  type RelationFieldCardinality,
} from "../molecules/RelationSelect";
import { TagInput } from "../molecules/TagInput";
import { UploadDropZone } from "../molecules/UploadDropZone";
import { DollarSign } from "lucide-react";
import { Alert } from "../molecules/Alert";
import { usePendingAction } from '../../../core';
import { useEventBus } from '../../../core';
import { useTranslate } from '../../../core';
import { useContentSurface } from '../../../core';
import type { SurfaceMode } from '@almadar/core';
import type { OrbitalEntity } from "@almadar/core";
import type { IconInput } from '../../../core';
import {
  debug,
  debugGroup,
  debugGroupEnd,
  isDebugEnabled,
} from "../../../lib/debug";
import { toWireValue, type SExpr } from "@almadar/core";
import type { EvalContextWire } from "@almadar/core/kernel-wire";
import { evaluateBindings, guardsHold } from '../../../core';
import type { UiError } from '../../../core';
import { FormField } from "../molecules/FormField";
import { Label } from '../../../core';
import { pressableProps } from '../../../core';

/**
 * S-Expression type for conditional logic
 */
export type SExpression = SExpr;

/**
 * Form-specific evaluation context
 */
export interface FormEvaluationContext {
  // Record shape, not EntityRow: form values are keyed field states, and the
  // compiled path's declared config type for this knob is the generic record
  // (`id` carries no special contract here). EntityRow stays assignable.
  formValues: Record<string, FieldValue | undefined>;
  globalVariables: Record<string, FieldValue>;
  localVariables?: Record<string, FieldValue>;
  entity?: Record<string, FieldValue | undefined>;
}

/**
 * The kernel binding context of a form: `@entity` is the form's own bag of values.
 */
function toEvalContext(formCtx: FormEvaluationContext): EvalContextWire {
  return {
    entity: toWireValue({
      formValues: formCtx.formValues,
      globalVariables: formCtx.globalVariables,
      localVariables: formCtx.localVariables ?? {},
      ...formCtx.entity,
    }),
    state: "active",
  };
}

/**
 * Hidden calculation definition
 */
export interface HiddenCalculation {
  variableName: string;
  expression: SExpression;
  triggerFields: string[];
}

/**
 * Violation definition
 */
export interface ViolationDefinition {
  law: string;
  article: string;
  actionType: "measure" | "admin" | "penalty";
  message: string;
}

/**
 * Violation trigger definition
 */
export interface ViolationTrigger {
  condition: SExpression;
  violation: ViolationDefinition;
  fieldId?: string;
}

/**
 * Form section definition for nested sections
 */
export interface FormSection {
  id: string;
  title: string;
  condition?: SExpression;
  fields: SchemaField[];
  collapsible?: boolean;
}

/**
 * Form tab definition for tabbed inspection forms
 */
export interface FormTabDefinition {
  /** Unique tab identifier */
  id: string;
  /** Tab display label */
  label: string;
  /** Icon for the tab */
  icon?: IconInput;
  /** Sections within this tab */
  sections: FormSection[];
  /** Condition for showing/hiding the entire tab */
  condition?: SExpression;
  /** Badge count or text to display on tab */
  badge?: string | number;
  /** Whether this tab has validation errors */
  hasErrors?: boolean;
}

/**
 * Relation configuration for foreign key fields
 */
export interface RelationConfig {
  /** Target entity name (e.g., 'User', 'Project') */
   
  entity: string;
  /** Field on target entity to display (defaults to 'name') */
  displayField?: string;
  /** Cardinality of the relation — many-valued spellings drive the
   *  multi-select picker below; anything else (including absent) stays
   *  single-select. */
  cardinality?: RelationFieldCardinality;
}

/**
 * Validation-rule bundle for a schema field. Only `enum` is actually read
 * (`getEnumOptions` below); the rest of `JsonObject`'s key space was never
 * consumed, so the concrete shape is exactly the field this component uses.
 */
export interface FormFieldValidation {
  /** Allowed values, mirrors `SchemaField.values` when sourced from validation metadata instead. */
  enum?: readonly string[];
}

/**
 * Schema field definition
 * Supports both 'name' and 'field' for compatibility with different schema formats
 */
export interface SchemaField {
  /** Field name (primary) */
  name?: string;
  /** Field name (alias for compatibility) */
  field?: string;
  /** Display label */
  label?: string;
  /** Field type (string, number, email, date, boolean, enum, relation, etc.) */
  type?: string;
  /** Input type for rendering (text, select, textarea, checkbox, etc.) */
  inputType?: string;
  /** Placeholder text */
  placeholder?: string;
  /** Whether field is required */
  required?: boolean;
  /** Default value */
  defaultValue?: FieldValue;
  /** Options for select/enum fields - accepts readonly for generated const arrays */
  options?: readonly SelectOption[];
  /** Enum values (alternative to options, just strings) - accepts readonly for generated const arrays */
  values?: readonly string[];
  /** Display text per exact value of `values`; unmapped values show as stored */
  labels?: Readonly<Record<string, string>>;
  /** Relation configuration for foreign key references */
  relation?: RelationConfig;
  /** Minimum value (for number) or length (for string) */
  min?: number;
  /** Maximum value or length */
  max?: number;
  /** Pattern for validation */
  pattern?: string;
  /** Validation rules */
  validation?: FormFieldValidation;
  /** Whether field is readonly (displays value but cannot edit) */
  readonly?: boolean;
  /** Whether field is disabled (alternative to readonly for compatibility) */
  disabled?: boolean;
  /** Help text rendered under the input — sourced from the entity field's
   *  `@description` (auto, via schema enrichment) or a call-site override. */
  hint?: string;
}

/**
 * Per-field display-copy override, keyed by field name — the shape of
 * ModalRecordModal's `fieldOverrides` config knob. Only display copy:
 * types, options, relations and required-ness stay entity-schema-driven
 * (declare once on the entity).
 */
export interface SchemaFieldOverride {
  name: string;
  label?: string;
  placeholder?: string;
  hint?: string;
}

/**
 * Form is the ONE EXCEPTION to the "no internal state" rule for organisms.
 * It manages local `formData` state for field input tracking.
 * See EntityDisplayProps in ./types.ts for documentation.
 *
 * @fieldsContract form
 */
export interface FormProps extends Omit<
  React.FormHTMLAttributes<HTMLFormElement>,
  "onSubmit" | keyof A11yProps
>, A11yProps {
  /** Content surface: `auto` paints the theme's surface (with card padding) behind this block unless it already sits on one (a card, dialog or another block); `none` opts out. */
  surface?: SurfaceMode;
  /** The shape an empty slot shows while this form's server render is in flight (`none` opts out). @default 'form' */
  skeleton?: SkeletonSpec;
  /** Form fields (traditional React children) */
  children?: React.ReactNode;
  /** Submit event name for trait dispatch (emitted via eventBus as UI:{onSubmit}) */
  onSubmit?: string;
  /** Cancel event name for trait dispatch (emitted via eventBus as UI:{onCancel}) */
  onCancel?: string;
  /** Form layout */
  layout?: "vertical" | "horizontal" | "inline";
  /** Gap between fields */
  gap?: "sm" | "md" | "lg";
  /** Additional CSS classes */
  className?: string;

  // Schema-based props
  /** Entity type name or schema object. When OrbitalEntity, fields are auto-derived if not provided. */
   
  entity?: string | OrbitalEntity | EntityRow | readonly EntityRow[];
  /**
   * Form mode — 'create' for new records, 'edit' for updating existing.
   * Accepts `string` so schema-driven callers (whose `config.mode` is typed
   * as `string` per the trait's declared config block) compile cleanly. The
   * runtime treats anything other than 'edit' as 'create'.
   */
  mode?: "create" | "edit" | string;
  /** Fields definition (schema format) - accepts readonly for generated const arrays */
  fields: readonly Readonly<SchemaField>[];
  /** Initial form data */
  initialData?: EntityRow;
  /** Loading state */
  isLoading?: boolean;
  /** Error state */
  error?: UiError | null;
  /** Submit button label */
  submitLabel?: string;
  /** Cancel button label (if provided, shows cancel button) */
  cancelLabel?: string;
  /** Show cancel button (defaults to true for schema forms) */
  showCancel?: boolean;
  /** Show submit button (defaults to true for schema forms). Set false when a parent atom owns the submit action externally (e.g. wizard footers). */
  showSubmit?: boolean;
  /** Form title (used by ModalSlot to extract title) */
  title?: string;

  // Event dispatch props (for trait state machine integration)
  /** Event to dispatch on successful submit (defaults to 'SAVE').
   *  `data` carries the collected field values for the bound entity, so it is
   *  the bound entity's ROW — a compile-time-known type via `linkedEntity`,
   *  unlike the per-field `value` whose type depends on a runtime `fieldId`. */
  /** @entityRow data */
  submitEvent?: EventEmit<FormSubmitPayload>;
  /** Event to dispatch on cancel (defaults to 'CANCEL') */
  cancelEvent?: EventKey;

  // Relation data props
  /** Data for relation fields: { fieldName: RelationOption[] } */
  relationsData?: Record<string, readonly RelationOption[]>;
  /** Loading state for relation data: { fieldName: boolean } */
  relationsLoading?: Record<string, boolean>;
  /** Per-field display-copy overrides (label/placeholder/hint), merged by
   *  field name over the schema-enriched fields. */
  fieldOverrides?: readonly SchemaFieldOverride[];

  // Inspection form extensions
  /** Map of fieldId → S-expression condition for conditional field display (boolean true means enabled but config loaded separately) */
  conditionalFields?: Record<string, SExpression> | boolean;
  /** Hidden calculations that emit GLOBAL_VARIABLE_SET on field change (boolean true means enabled but config loaded separately) */
  hiddenCalculations?: HiddenCalculation[] | boolean;
  /** Violation conditions that emit VIOLATION_DETECTED when met (boolean true means enabled but config loaded separately) */
  violationTriggers?: ViolationTrigger[] | boolean;
  /** Context for S-expression evaluation */
  evaluationContext?: FormEvaluationContext;
  /** Nested form sections with optional conditions */
  sections?: FormSection[];
  /** Callback when any field value changes */
  onFieldChange?: (change: {
    fieldId: string;
    // What a CONTROL emits — a scalar, a multi-select's string list, or a file
    // record. `FieldValue` here is what degraded every generated
    // `change.value` payload to a shapeless `object`.
    value: ControlValue | undefined;
    formValues: Record<string, FieldValue | undefined>;
  }) => void;
  /** Config path for form configuration (schema-driven) */
  configPath?: string;
  /** Whether the form supports repeatable entries */
  repeatable?: boolean;
}

/**
 * Type guards for the `entity` prop's discriminated union. The prop can
 * be a string entity-name, an OrbitalEntity schema descriptor (with a
 * `fields` array), or a resolved EntityRow row object (V2 path:
 * `entity: @payload.row`). The schema and row shapes are both objects
 * but only the schema carries `fields[]`.
 */
function isOrbitalEntitySchema(value: string | OrbitalEntity | EntityRow | readonly EntityRow[] | undefined): value is OrbitalEntity {
  if (value === null || value === undefined || typeof value !== 'object' || Array.isArray(value)) return false;
  const fields = (value as { fields?: FieldValue }).fields;
  return Array.isArray(fields);
}

function isPlainEntityRow(value: string | OrbitalEntity | EntityRow | readonly EntityRow[] | undefined): value is EntityRow {
  if (value === null || value === undefined || typeof value !== 'object' || Array.isArray(value)) return false;
  const fields = (value as { fields?: FieldValue }).fields;
  return !Array.isArray(fields);
}

const layoutStyles = {
  vertical: "flex flex-col",
  horizontal: "flex flex-row flex-wrap items-end",
  inline: "flex flex-row flex-wrap items-center",
};

const gapStyles = {
  sm: "gap-2",
  md: "gap-4",
  lg: "gap-6",
};

/**
 * Get enum options from field definition
 */
function getEnumOptions(field: SchemaField): SelectOption[] {
  // First check if options are already SelectOption format
  // Spread to convert readonly to mutable array
  if (field.options && field.options.length > 0) {
    return [...field.options];
  }

  // Check for values array (just strings)
  if (field.values && field.values.length > 0) {
    return field.values.map((v) => ({
      value: v,
      label: field.labels?.[v] ?? v,
    }));
  }

  // Check for validation.enum
  const validation = field.validation;
  if (validation?.enum && validation.enum.length > 0) {
    return validation.enum.map((v) => ({
      value: v,
      label: field.labels?.[v] ?? v,
    }));
  }

  return [];
}

/**
 * Determine the appropriate input type based on field definition
 */
function determineInputType(field: SchemaField): string {
  // If inputType is explicitly set, use it
  if (field.inputType) {
    return field.inputType;
  }

  // Check for relation type
  if (field.type === "relation" || field.relation) {
    return "relation";
  }

  // Check for array type ([string] fields) — a plain text input would
  // overwrite the whole array with a string on the first edit.
  if (field.type === "array") {
    return "array";
  }

  // Check for enum type
  if (
    field.type === "enum" ||
    field.values ||
    getEnumOptions(field).length > 0
  ) {
    return "select";
  }

  // Map type to inputType
  switch (field.type?.toLowerCase()) {
    case "email":
      return "email";
    case "password":
      return "password";
    case "url":
      return "url";
    case "file":
      return "file";
    case "image":
      return "image";
    case "money":
      return "currency";
    case "number":
    case "integer":
    case "float":
      return "number";
    case "date":
      return "date";
    case "datetime":
    case "timestamp":
      return "datetime-local";
    case "boolean":
      return "checkbox";
    case "textarea":
    case "text":
      return field.max && field.max > 200 ? "textarea" : "text";
    default:
      return "text";
  }
}

export const Form: React.FC<FormProps> = ({
  children,
  onSubmit,
  onCancel,
  layout = "vertical",
  gap = "md",
  surface = 'auto',
  className,
  // Schema-based props
  entity,
  fields,
  // No `= {}` default: a fresh `{}` evaluated inline on every render
  // would change the prop reference every tick and bust the useMemo
  // cache below (`[entity, initialData]` deps), reigniting the
  // setFormData useEffect on every keystroke and producing an
  // infinite re-render loop with stuck form inputs. The memo and
  // submit handler both handle `undefined` already via the
  // `typeof initialData === 'object'` guard.
  initialData,
  isLoading: isLoadingProp = false,
  error,
  submitLabel,
  cancelLabel,
  showCancel,
  showSubmit = true,
  title,
  submitEvent = "SAVE",
  cancelEvent = "CANCEL",
  relationsData = {},
  relationsLoading = {},
  fieldOverrides,
  // Inspection form extensions - may come as boolean true from generated code (meaning enabled but config loaded separately)
  conditionalFields: conditionalFieldsRaw = {},
  hiddenCalculations: hiddenCalculationsRaw = [],
  violationTriggers: violationTriggersRaw = [],
  evaluationContext: externalContext,
  sections = [],
  onFieldChange,
  // Feeds the awaiting-skeleton prediction only; never forwarded to the <form>.
  skeleton: _skeleton,
  ...props
}) => {
  const contentSurface = useContentSurface(surface);
  const eventBus = useEventBus();
  const submitBusy = usePendingAction();
  const isLoading = isLoadingProp || submitBusy.pending;
  const { t } = useTranslate();
  const resolvedSubmitLabel = submitLabel ?? t('common.save');
  const resolvedCancelLabel = cancelLabel ?? t('common.cancel');

  // Resolve entity: string name, OrbitalEntity schema object, or array (ignore arrays).
  // V2 path: `entity` may be a resolved EntityRow (e.g. @payload.row) — a plain
  // record with field values but no `fields` array. Discriminator:
  //   - has `fields` array → OrbitalEntity schema descriptor.
  //   - otherwise → row data (initial values for an edit form).
  const isSchemaEntity = isOrbitalEntitySchema(entity);
  const resolvedEntity = isSchemaEntity ? entity : undefined;
  const entityName = typeof entity === "string" ? entity : resolvedEntity?.name;
  // Row data (V2 edit path): use `entity` as initial form values. Caller's
  // explicit `initialData` still wins for backward compat.
  // The predicate's `Record<string, unknown>` widening doesn't survive the
  // entity prop's `string | OrbitalEntity | readonly Record[]` union intact,
  // so re-narrow with an explicit annotation.
  // `normalizedInitialData` MUST be memoized on the upstream prop refs
  // (`entity`, `initialData`) — not recomputed inline. The useEffect at
  // line ~518 watches it as a dep and calls setFormData on every change;
  // without a stable ref it fires on every render, replacing the user's
  // typed value before the next keystroke and producing both an
  // infinite re-render loop and visibly-stuck inputs. The intermediate
  // `entityRowAsInitial` / `callerInitial` are also wrapped so the
  // memo's deps are the actual prop refs, not the inline narrowing
  // wrappers.
  //
  // Typed as `EntityRow` from @almadar/core (the canonical row shape:
  // optional `id` plus `Record<string, FieldValue | undefined>`). This
  // matches what `entity` carries on the V2 edit path (a row from
  // `@payload.row`) and what the form's submit handler eventually
  // re-emits on the bus. Replaces the prior `Record<string, unknown>`
  // typing per the no-unknown-when-core-type-fits rule.
  const normalizedInitialData = React.useMemo<EntityRow>(() => {
    const entityRowAsInitial: EntityRow | undefined = isPlainEntityRow(entity)
      ? (entity as EntityRow)
      : undefined;
    const callerInitial: EntityRow =
      initialData !== null && typeof initialData === 'object' && !Array.isArray(initialData)
        ? (initialData as EntityRow)
        : {};
    const merged = entityRowAsInitial !== undefined
      ? { ...entityRowAsInitial, ...callerInitial }
      : callerInitial;
    // A row fetched with `include` carries hydrated relation rows in place of
    // their foreign-key ids ({id, name, …} or arrays of them). Forms edit ids —
    // collapse hydrated values back so pickers/selects seed correctly and the
    // submit payload stays a valid FK write.
    const toId = (value: FieldValue | undefined): FieldValue | undefined => {
      if (value === null || value === undefined || typeof value !== 'object' || value instanceof Date) return value;
      if (Array.isArray(value)) {
        return value.map((item) =>
          item !== null && typeof item === 'object' && !Array.isArray(item) && !(item instanceof Date)
          && item.id !== undefined && item.id !== null
            ? String(item.id)
            : item,
        );
      }
      return value.id !== undefined && value.id !== null ? String(value.id) : value;
    };
    const normalized: EntityRow = {};
    for (const [key, value] of Object.entries(merged)) {
      normalized[key] = key === 'id' ? value : toId(value);
    }
    return normalized;
  }, [entity, initialData]);
  const entityDerivedFields: readonly Readonly<SchemaField>[] | undefined =
    React.useMemo(() => {
      if (fields && fields.length > 0) return undefined;
      if (!resolvedEntity) return undefined;
      return resolvedEntity.fields.map(
        (f): SchemaField => ({
          name: f.name,
          type: f.type,
          required: f.required,
          // EntityField.default is typed `unknown` upstream — safe cast: schema defaults are always FieldValues.
          defaultValue: f.default as FieldValue | undefined,
          // EntityField is a discriminated union — `values` lives on Scalar/Enum, `relation` lives on Relation.
          values: 'values' in f ? f.values : undefined,
          min: f.min,
          max: f.max,
          relation: 'relation' in f
            ? { entity: f.relation.entity, cardinality: f.relation.cardinality }
            : undefined,
        }),
      );
    }, [entity, fields]);

  // Normalize props that might come as boolean true from generated code
  const conditionalFields =
    typeof conditionalFieldsRaw === "boolean" ? {} : conditionalFieldsRaw;
  const hiddenCalculations =
    typeof hiddenCalculationsRaw === "boolean" ? [] : hiddenCalculationsRaw;
  const violationTriggers =
    typeof violationTriggersRaw === "boolean" ? [] : violationTriggersRaw;
  const [formData, setFormData] = React.useState<EntityRow>(
    normalizedInitialData,
  );
  const [collapsedSections, setCollapsedSections] = React.useState<Set<string>>(
    new Set(),
  );
  const [submitError, setSubmitError] = React.useState<string | null>(null);
  const formRef = React.useRef<HTMLFormElement | null>(null);
  const formUid = React.useId();
  const fieldDomId = (name: string) => `${formUid}-${name}`;
  const [fieldErrors, setFieldErrors] = React.useState<Readonly<Record<string, string>>>({});
  const [invalidFields, setInvalidFields] = React.useState<readonly string[]>([]);

  const fieldElement = (name: string) =>
    formRef.current?.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
      `[data-field-name=${JSON.stringify(name)}]`,
    ) ?? null;

  // The browser's constraint validation is the one source of field rules;
  // this only mirrors a field's verdict into its inline error.
  const validateField = (name: string) => {
    const el = fieldElement(name);
    if (!el) return;
    const message = el.validity.valid ? null : el.validationMessage || t('form.invalidValue');
    setFieldErrors((prev) => {
      if (message === null) {
        if (!(name in prev)) return prev;
        const next = { ...prev };
        delete next[name];
        return next;
      }
      return prev[name] === message ? prev : { ...prev, [name]: message };
    });
    if (message === null) setInvalidFields((prev) => (prev.includes(name) ? prev.filter((n) => n !== name) : prev));
  };

  const formMode = (props as { mode?: string }).mode;
  const mountedRef = React.useRef(false);
  if (!mountedRef.current) {
    mountedRef.current = true;
    debug('forms', 'mount', {
      mode: formMode,
      submitEvent,
      cancelEvent,
      fieldNames: (fields ?? []).map((f) => f.name ?? f.field).filter(Boolean),
      initialDataKeys: Object.keys(normalizedInitialData),
      initialData: normalizedInitialData,
    });
  }

  // Default to showing cancel button for schema-based forms
  const shouldShowCancel = showCancel ?? (fields && fields.length > 0);

  // Build evaluation context from form data and external context
  const evalContext: FormEvaluationContext = React.useMemo(
    () => ({
      formValues: formData,
      globalVariables: externalContext?.globalVariables ?? {},
      localVariables: externalContext?.localVariables ?? {},
      entity: externalContext?.entity ?? {},
    }),
    [formData, externalContext],
  );

  // Sync form data when initialData changes (e.g., when data loads from
  // API) OR when entity-as-row changes (V2 edit path: @payload.row).
  React.useEffect(() => {
    debug('forms', 'initialData-sync', {
      mode: formMode,
      normalizedInitialData,
      prevFormData: formData,
      willSet: Object.keys(normalizedInitialData).length > 0,
    });
    if (Object.keys(normalizedInitialData).length > 0) {
      setFormData(normalizedInitialData);
    }
  }, [normalizedInitialData]);

  /**
   * Process hidden calculations when triggered fields change
   */
  const processCalculations = React.useCallback(
    (changedFieldId: string, newFormData: EntityRow) => {
      if (!hiddenCalculations.length) return;

      const context: FormEvaluationContext = {
        formValues: newFormData,
        globalVariables: externalContext?.globalVariables ?? {},
        localVariables: externalContext?.localVariables ?? {},
        entity: externalContext?.entity ?? {},
      };

      const triggered = hiddenCalculations.filter((calc) =>
        calc.triggerFields.includes(changedFieldId),
      );
      const values = evaluateBindings(
        toEvalContext(context),
        triggered.map((calc) => calc.expression),
      );
      triggered.forEach((calc, i) => {
        const value = values[i];
        eventBus.emit("UI:GLOBAL_VARIABLE_SET", {
          variable: calc.variableName,
          value: value as EventPayload['value'],
        });
        debug(
          "forms",
          `Calculation triggered: ${calc.variableName} = ${String(value)}`,
        );
      });
    },
    [hiddenCalculations, externalContext, eventBus],
  );

  /**
   * Check violation triggers when form data changes
   */
  const checkViolations = React.useCallback(
    (changedFieldId: string, newFormData: EntityRow) => {
      if (!violationTriggers.length) return;

      const context: FormEvaluationContext = {
        formValues: newFormData,
        globalVariables: externalContext?.globalVariables ?? {},
        localVariables: externalContext?.localVariables ?? {},
        entity: externalContext?.entity ?? {},
      };

      const met = guardsHold(
        toEvalContext(context),
        violationTriggers.map((trigger) => trigger.condition),
      );
      violationTriggers.forEach((trigger: ViolationTrigger, i) => {
        if (met[i]) {
          eventBus.emit("UI:VIOLATION_DETECTED", {
            fieldId: trigger.fieldId ?? changedFieldId,
            ...trigger.violation,
          });
          debug(
            "forms",
            `Violation detected: ${trigger.violation.law} ${trigger.violation.article}`,
          );
        }
      });
    },
    [violationTriggers, externalContext, eventBus],
  );

  const handleChange = (name: string, value: ControlValue | undefined) => {
    const newFormData = { ...formData, [name]: value };
    debug('forms', 'field-change', { mode: formMode, name, value, prevFormData: formData, newFormData });
    setFormData(newFormData);
    if (fieldErrors[name] !== undefined) queueMicrotask(() => validateField(name));

    // Emit field change event
    eventBus.emit("UI:FIELD_CHANGED", {
      fieldId: name,
      value: value as EventPayload['value'],
      formValues: newFormData as EventPayload,
    });

    // Call external handler if provided
    onFieldChange?.({ fieldId: name, value, formValues: newFormData });

    // Process calculations and check violations
    processCalculations(name, newFormData);
    checkViolations(name, newFormData);
  };

  /**
   * Every conditional field and section of this render, decided against one context in one kernel crossing.
   */
  const conditionVerdicts = React.useMemo(() => {
    const keyed: { key: string; condition: SExpression }[] = [];
    for (const [name, condition] of Object.entries(conditionalFields)) {
      keyed.push({ key: `field:${name}`, condition });
    }
    for (const section of sections ?? []) {
      if (section.condition) keyed.push({ key: `section:${section.id}`, condition: section.condition });
    }
    const holds = guardsHold(toEvalContext(evalContext), keyed.map((k) => k.condition));
    return new Map(keyed.map((k, i) => [k.key, holds[i]]));
  }, [conditionalFields, sections, evalContext]);

  /**
   * Check if a field should be visible based on its condition
   */
  const isFieldVisible = React.useCallback(
    (fieldName: string): boolean => {
      if (!conditionalFields[fieldName]) return true;
      return conditionVerdicts.get(`field:${fieldName}`) ?? true;
    },
    [conditionalFields, conditionVerdicts],
  );

  /**
   * Check if a section should be visible based on its condition
   */
  const isSectionVisible = React.useCallback(
    (section: FormSection): boolean => {
      if (!section.condition) return true;
      return conditionVerdicts.get(`section:${section.id}`) ?? true;
    },
    [conditionVerdicts],
  );

  /**
   * Toggle section collapsed state
   */
  const toggleSection = (sectionId: string) => {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(sectionId)) {
        next.delete(sectionId);
      } else {
        next.add(sectionId);
      }
      return next;
    });
  };

  // HTML5 validation drives all field-level rules (required / min / max /
  // minLength / maxLength / pattern / type). The browser blocks `submit`
  // when any field is invalid and fires an `invalid` event per offender;
  // see `handleInvalid` below for our capture + surfacing. By the time
  // `handleSubmit` runs, the browser has already accepted the form as
  // valid, so this function only handles the happy path.
  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSubmitError(null);
    setInvalidFields([]);
    debug('forms', 'submit-enter', {
      mode: formMode,
      submitEvent,
      formData,
      normalizedInitialData,
    });
    // Merge initialData into the submitted payload. The form renders
    // only the user-editable fields, but downstream traits (persist
    // update / delete) need the row's primary keys (especially `id`)
    // to resolve the target row. Without this merge, an edit form
    // submits `{ name, description, status }` and the persistor's
    // `updateId = data?.id ?? entity?.id ?? ...` chain resolves to
    // undefined, the `if (updateId) { ... }` branch is skipped, and
    // `emit.success` never fires. Spreading `normalizedInitialData`
    // first lets `formData` (post-edit) win on overlap, so changed
    // fields are preserved while non-rendered keys (like `id`) carry
    // through. This is the hidden-id pattern, applied at the form's
    // call site per the "emit call site is the source of truth" rule.
    const mergedData: EntityRow = {
      ...normalizedInitialData,
      ...formData,
    };
    const payload: FormSubmitPayload = { data: mergedData };
    debug('forms', 'submit-emit', { mode: formMode, submitEvent: `UI:${submitEvent}`, payloadData: payload.data });
    // The submit stays busy (form kept, fields locked) until the dispatches it
    // started settle — then the result view takes over.
    submitBusy.activate((pendingKey) => {
      eventBus.emit(`UI:${submitEvent}`, payload, { pendingKey });
      // Handle onSubmit - event name string for additional trait dispatch
      if (onSubmit) {
        eventBus.emit(`UI:${onSubmit}`, payload, { pendingKey });
      }
    });
  };

  // Capture HTML5 invalid events as the browser detects them. Surfaces
  // to React state (Alert), debug logs, and the bus so verifiers see a
  // real `UI:VALIDATION_FAILED` event instead of ephemeral browser-native
  // tooltips. Also collects the full set of invalid fields after the
  // current event loop tick so a single Alert can list every offender,
  // not just the first one the browser reaches.
  const invalidScheduled = React.useRef(false);
  const handleInvalid = (e: Event) => {
    const target = e.target;
    if (!(target instanceof HTMLElement)) return;
    debug('forms', 'invalid', { mode: formMode, fieldName: target.getAttribute('data-field-name') ?? '' });
    // The browser fires one `invalid` per offender synchronously; collect
    // them all once, after the walk.
    if (invalidScheduled.current) return;
    invalidScheduled.current = true;
    queueMicrotask(() => {
      invalidScheduled.current = false;
      const form = formRef.current;
      if (!form) return;
      // Read each field's `validity` (event-free) rather than `:invalid`, which
      // some engines evaluate by re-running validation.
      const invalidEls = Array.from(
        form.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('[data-field-name]'),
      ).filter((el) => el.validity !== undefined && !el.validity.valid);
      if (invalidEls.length === 0) return;
      const messages = invalidEls.map((el) => ({
        field: el.getAttribute('data-field-name') ?? '',
        message: el.validationMessage || t('form.invalidValue'),
      }));
      const missing = messages.map((m) => m.field);
      setFieldErrors((prev) => {
        const next = { ...prev };
        for (const m of messages) next[m.field] = m.message;
        return next;
      });
      setInvalidFields(missing);
      eventBus.emit('UI:VALIDATION_FAILED', {
        submitEvent,
        missing,
        messages,
        summary: t('form.fixFields', { count: missing.length }),
      });
    });
  };
  const handleInvalidRef = React.useRef(handleInvalid);
  handleInvalidRef.current = handleInvalid;
  // `invalid` does not bubble; a capture listener on the form sees every field's.
  React.useEffect(() => {
    const form = formRef.current;
    if (!form) return;
    const listener = (e: Event) => handleInvalidRef.current(e);
    form.addEventListener('invalid', listener, true);
    return () => form.removeEventListener('invalid', listener, true);
  }, []);

  const focusField = (name: string) => fieldElement(name)?.focus();

  const handleCancel = () => {
    // Dispatch cancel event for trait state machine integration
    eventBus.emit(`UI:${cancelEvent}`);
    eventBus.emit("UI:CLOSE");
    // Handle onCancel - event name string for additional trait dispatch
    if (onCancel) {
      eventBus.emit(`UI:${onCancel}`);
    }
  };

  /**
   * Render a single field with conditional visibility
   */
  const renderField = React.useCallback(
    (field: SchemaField) => {
      const fieldName = field.name || field.field;
      if (!fieldName) return null;

      // Check conditional visibility
      if (!isFieldVisible(fieldName)) {
        return null;
      }

      const inputType = determineInputType(field);
      const label = field.label || fieldName;
      const currentValue = formData[fieldName] ?? field.defaultValue ?? "";

      const error = fieldErrors[fieldName];
      const domId = fieldDomId(fieldName);

      // A checkbox carries its own label; an image field is several controls.
      if (inputType === "checkbox" || inputType === "image") {
        return (
          <VStack key={fieldName} gap="xs" data-field={fieldName}>
            {inputType === "image" && (
              <Label htmlFor={domId} required={field.required}>{label}</Label>
            )}
            {renderFieldInput(field, fieldName, inputType, currentValue, label)}
            {error ? (
              <Typography id={`${domId}-error`} variant="caption" color="error" data-field-error>
                {error}
              </Typography>
            ) : field.hint ? (
              <Typography id={`${domId}-hint`} variant="caption" color="muted">
                {field.hint}
              </Typography>
            ) : null}
          </VStack>
        );
      }

      return (
        <Box key={fieldName} data-field={fieldName}>
          <FormField label={label} required={field.required} hint={field.hint} error={error}>
            {renderFieldInput(field, fieldName, inputType, currentValue, label)}
          </FormField>
        </Box>
      );
    },
    [formData, fieldErrors, isFieldVisible, relationsData, relationsLoading, isLoading],
  );

  // Normalize fields - handle both string[] and SchemaField[], with entity-derived fallback
  const effectiveFields = entityDerivedFields ?? fields;
  const normalizedFields = React.useMemo(() => {
    if (!effectiveFields || effectiveFields.length === 0) return [];

    return effectiveFields.map((field): SchemaField => {
      // If field is a string, convert to SchemaField object
      if (typeof field === 'string') {
        // Look up type info from the entity schema when available
        const entityField = resolvedEntity?.fields?.find((f) => f.name === field);
        if (entityField) {
          return {
            name: field,
            type: entityField.type,
            required: entityField.required,
            hint: entityField.description,
            // EntityField.default is typed `unknown` upstream — safe cast: schema defaults are always FieldValues.
            defaultValue: entityField.default as FieldValue | undefined,
            // EntityField is a discriminated union — `values` lives on Scalar/Enum, `relation` lives on Relation.
            values: 'values' in entityField ? entityField.values : undefined,
            min: entityField.min,
            max: entityField.max,
            relation:
              'relation' in entityField
                ? { entity: entityField.relation.entity, cardinality: entityField.relation.cardinality }
                : undefined,
          };
        }
        return { name: field, type: 'string' };
      }
      return field as SchemaField;
    }).map((field): SchemaField => {
      // Per-field display-copy overrides (ModalRecordModal's fieldOverrides
      // knob) win over the schema-derived label/placeholder/hint; everything
      // else stays entity-schema-driven.
      const fieldName = field.name || field.field;
      const override = fieldOverrides?.find((o) => o.name === fieldName);
      if (!override) return field;
      return {
        ...field,
        ...(override.label !== undefined ? { label: override.label } : {}),
        ...(override.placeholder !== undefined ? { placeholder: override.placeholder } : {}),
        ...(override.hint !== undefined ? { hint: override.hint } : {}),
      };
    });
  }, [effectiveFields, resolvedEntity, fieldOverrides]);

  // Generate form fields from schema
  const schemaFields = React.useMemo(() => {
    if (normalizedFields.length === 0) return null;

    if (isDebugEnabled()) {
      debugGroup(`Form: ${entityName || "unknown"}`);
      debug(`Fields count: ${normalizedFields.length}`);
      debug("Conditional fields:", Object.keys(conditionalFields));
      debugGroupEnd();
    }

    return normalizedFields.map(renderField).filter(Boolean);
  }, [normalizedFields, renderField, entityName, conditionalFields]);

  // Generate form sections with nested fields
  const sectionElements = React.useMemo(() => {
    if (!sections || sections.length === 0) return null;

    return sections
      .map((section) => {
        if (!isSectionVisible(section)) {
          return null;
        }

        const isCollapsed = collapsedSections.has(section.id);

        return (
          <Box key={section.id} as="fieldset" className="m-0 min-w-0 p-0 border border-border rounded-container overflow-hidden">
            <Box as="legend" className="sr-only">{section.title}</Box>
            <Box
              {...pressableProps(section.collapsible ? () => toggleSection(section.id) : undefined)}
              aria-expanded={section.collapsible ? !isCollapsed : undefined}
              className={cn(
                "px-4 py-3 bg-muted flex items-center justify-between",
                section.collapsible && "cursor-pointer hover:bg-muted/80",
              )}
            >
              <Typography variant="label" weight="semibold">
                {section.title}
              </Typography>
              {section.collapsible && (
                <Icon
                  name="chevron-down"
                  size="md"
                  className={cn(
                    "text-muted-foreground transition-transform",
                    isCollapsed && "rotate-180",
                  )}
                />
              )}
            </Box>
            {!isCollapsed && (
              <Box padding="md">
                <VStack gap={gap === "sm" ? "sm" : gap === "lg" ? "lg" : "md"}>
                  {section.fields.map(renderField).filter(Boolean)}
                </VStack>
              </Box>
            )}
          </Box>
        );
      })
      .filter(Boolean);
  }, [sections, isSectionVisible, collapsedSections, renderField, gap]);

  /**
   * Render the appropriate input component based on field type
   */
  function renderFieldInput(
    field: SchemaField,
    fieldName: string,
    inputType: string,
    currentValue: FieldValue,
    label: string,
  ): React.ReactNode {
    // Thread every HTML5 validation attribute the schema declares so the
    // browser can enforce them natively. `min` / `max` apply to numeric
    // and date inputs; for string-type inputs they're surfaced as
    // `minLength` / `maxLength` further down per input case.
    const domId = fieldDomId(fieldName);
    const selfDescribed = inputType === "checkbox" || inputType === "image";
    const commonProps = {
      id: domId,
      ...(selfDescribed
        ? {
            "aria-invalid": fieldErrors[fieldName] ? true : undefined,
            "aria-describedby": fieldErrors[fieldName] ? `${domId}-error` : field.hint ? `${domId}-hint` : undefined,
          }
        : undefined),
      name: fieldName,
      'data-field-name': fieldName,
      required: field.required,
      disabled: isLoading,
      placeholder: field.placeholder,
      pattern: field.pattern,
    };

    switch (inputType) {
      case "checkbox":
        return (
          <Checkbox
            {...commonProps}
            label={label}
            checked={Boolean(currentValue)}
            onChange={(e) => handleChange(fieldName, e.target.checked)}
          />
        );

      case "textarea":
        return (
          <Textarea
            {...commonProps}
            value={String(currentValue)}
            onChange={(e) => handleChange(fieldName, e.target.value)}
            minLength={field.min}
            maxLength={field.max}
          />
        );

      case "select": {
        const options = getEnumOptions(field);
        return (
          <Select
            {...commonProps}
            options={options}
            value={String(currentValue)}
            onValueChange={(v) => handleChange(fieldName, v as string)}
            placeholder={field.placeholder || t('form.selectPlaceholder', { label })}
          />
        );
      }

      case "relation": {
        // Get relation options from relationsData
        const relationOptions = relationsData[fieldName] || [];
        const relationLoading = relationsLoading[fieldName] || false;

        // Many-valued cardinality picks multiple related rows — a
        // single-value RelationSelect would only ever keep the last pick.
        if (
          field.relation?.cardinality !== undefined &&
          MANY_CARDINALITIES.includes(field.relation.cardinality)
        ) {
          const selectedValues: string[] = Array.isArray(currentValue)
            ? currentValue.map((v) => String(v))
            : [];
          return (
            <Select
              {...commonProps}
              multiple
              searchable
              clearable
              options={[...relationOptions]}
              value={selectedValues}
              onValueChange={(value) =>
                handleChange(fieldName, Array.isArray(value) ? value : [value])
              }
              placeholder={field.placeholder || t('form.selectPlaceholder', { label })}
            />
          );
        }

        return (
          <RelationSelect
            {...commonProps}
            value={currentValue ? String(currentValue) : undefined}
            onChange={(value) => handleChange(fieldName, value)}
            options={relationOptions}
            isLoading={relationLoading}
            placeholder={field.placeholder || t('form.selectPlaceholder', { label })}
            searchPlaceholder={t('form.searchPlaceholder', { entity: field.relation?.entity || label })}
            clearable={!field.required}
          />
        );
      }

      case "array": {
        // [string] fields: TagInput keeps the value an array of chips —
        // display-coerce a legacy non-array value without writing it back
        // until the user actually edits the field.
        const arrayValue: string[] = Array.isArray(currentValue)
          ? currentValue.map((v) => String(v))
          : currentValue != null && currentValue !== ""
            ? [String(currentValue)]
            : [];
        return (
          <TagInput
            placeholder={field.placeholder}
            disabled={isLoading}
            value={arrayValue}
            onChange={(next) => handleChange(fieldName, [...next])}
          />
        );
      }

      case "number":
        return (
          <Input
            {...commonProps}
            type="number"
            value={
              currentValue !== undefined && currentValue !== ""
                ? String(currentValue)
                : ""
            }
            onChange={(e) =>
              handleChange(
                fieldName,
                e.target.value ? Number(e.target.value) : undefined,
              )
            }
            min={field.min}
            max={field.max}
          />
        );

      case "currency":
        // Monetary entry: numeric input with a currency adornment. The value
        // stays a plain number (the `money` field type owns the semantics);
        // display formatting happens on read surfaces (DetailPanel/columns).
        return (
          <Input
            {...commonProps}
            type="number"
            step="0.01"
            icon={DollarSign}
            value={
              currentValue !== undefined && currentValue !== ""
                ? String(currentValue)
                : ""
            }
            onChange={(e) =>
              handleChange(
                fieldName,
                e.target.value ? Number(e.target.value) : undefined,
              )
            }
            min={field.min}
            max={field.max}
          />
        );

      case "file":
        // File entry: real dropzone instead of a text box. The stored value
        // is the structured file object {name, url, mimeType, sizeBytes};
        // in mock/playground mode `url` is a data: URI read client-side.
        return (
          <UploadDropZone
            accept={field.pattern}
            maxFiles={1}
            disabled={isLoading}
            onFiles={(files) => {
              const f = files[0];
              if (!f) return;
              const reader = new FileReader();
              reader.onload = () =>
                handleChange(fieldName, {
                  name: f.name,
                  mimeType: f.type,
                  sizeBytes: f.size,
                  url: typeof reader.result === "string" ? reader.result : "",
                });
              reader.readAsDataURL(f);
            }}
          />
        );

      case "image": {
        // Image entry: the stored value is a URL string (the `image` semantic
        // string domain), never a file struct. A live thumbnail confirms the
        // URL resolves; the dropzone offers upload-instead-of-paste, storing
        // a data: URI in mock mode (object storage rewrites it in production).
        const imageUrl = typeof currentValue === "string" ? currentValue : "";
        return (
          <VStack gap="sm">
            {imageUrl ? (
              <img
                src={imageUrl}
                alt=""
                aria-hidden="true"
                className="h-24 w-full max-w-xs rounded-container border border-border object-cover"
                data-testid={`image-preview-${fieldName}`}
              />
            ) : null}
            <UploadDropZone
              accept="image/*"
              maxFiles={1}
              maxSize={2 * 1024 * 1024}
              disabled={isLoading}
              onFiles={(files) => {
                const f = files[0];
                if (!f) return;
                const reader = new FileReader();
                reader.onload = () =>
                  handleChange(
                    fieldName,
                    typeof reader.result === "string" ? reader.result : "",
                  );
                reader.readAsDataURL(f);
              }}
            />
            <Input
              {...commonProps}
              type="url"
              placeholder={t('form.imageUrlFallback')}
              value={imageUrl}
              onChange={(e) => handleChange(fieldName, e.target.value)}
            />
          </VStack>
        );
      }

      case "date":
        return (
          <Input
            {...commonProps}
            type="date"
            value={toDateInputValue(currentValue)}
            onChange={(e) => handleChange(fieldName, e.target.value)}
          />
        );

      case "datetime-local":
        return (
          <Input
            {...commonProps}
            type="datetime-local"
            value={toDateTimeInputValue(currentValue)}
            onChange={(e) => handleChange(fieldName, e.target.value)}
          />
        );

      case "email":
        return (
          <Input
            {...commonProps}
            type="email"
            value={String(currentValue)}
            onChange={(e) => handleChange(fieldName, e.target.value)}
            minLength={field.min}
            maxLength={field.max}
          />
        );

      case "url":
        return (
          <Input
            {...commonProps}
            type="url"
            value={String(currentValue)}
            onChange={(e) => handleChange(fieldName, e.target.value)}
            minLength={field.min}
            maxLength={field.max}
          />
        );

      case "password":
        return (
          <Input
            {...commonProps}
            type="password"
            value={String(currentValue)}
            onChange={(e) => handleChange(fieldName, e.target.value)}
            minLength={field.min}
            maxLength={field.max}
          />
        );

      case "text":
      default:
        return (
          <Input
            {...commonProps}
            type="text"
            value={String(currentValue)}
            onChange={(e) => handleChange(fieldName, e.target.value)}
            minLength={field.min}
            maxLength={field.max}
          />
        );
    }
  }

  return contentSurface.provide(
    <form
      ref={formRef}
      data-pattern={FORM_PATTERN}
      className={cn(layoutStyles[layout], gapStyles[gap], layout === "vertical" && "w-full max-w-xl", contentSurface.className && cn(contentSurface.className, "p-card-md"), className)}
      onSubmit={handleSubmit}
      onBlur={(e: React.FocusEvent<HTMLFormElement>) => {
        const name = e.target instanceof HTMLElement ? e.target.getAttribute("data-field-name") : null;
        if (name) validateField(name);
      }}
      {...props}
    >
      {/* Required-field validation error from handleSubmit */}
      {submitError && (
        <Alert variant="error" className="mb-4">
          {submitError}
        </Alert>
      )}
      {invalidFields.length > 0 && (
        <Alert variant="error" title={t("form.fixFields", { count: invalidFields.length })}>
          <HStack gap="sm" wrap>
            {invalidFields.map((name) => {
              const def = normalizedFields.find((f) => (f.name || f.field) === name)
                ?? sections.flatMap((sec) => sec.fields).find((f) => (f.name || f.field) === name);
              return (
                <Button key={name} variant="link" className="h-auto p-0" onClick={() => focusField(name)}>
                  {def?.label ?? name}
                </Button>
              );
            })}
          </HStack>
        </Alert>
      )}
      {/* Error state */}
      {error && (
        <Alert variant="error" className="mb-4">
          {error.message || t('error.occurred')}
        </Alert>
      )}

      {/* Render sections (inspection forms with nested sections) */}
      {sectionElements && sectionElements.length > 0 && (
        <VStack gap={gap === "sm" ? "sm" : gap === "lg" ? "lg" : "md"}>
          {sectionElements}
        </VStack>
      )}

      {/* Render schema-generated fields (flat fields outside sections) */}
      {schemaFields}

      {/* Render children (traditional form content) */}
      {children}

      {/* Action buttons for schema-based forms */}
      {((schemaFields && schemaFields.length > 0) ||
        (sectionElements && sectionElements.length > 0)) && (showSubmit || shouldShowCancel) && (
        <HStack
          gap="sm"
          justify="end"
          wrap
          className="sticky bottom-0 z-10 -mx-1 px-1 pt-4 pb-1 bg-card/95 surface-material"
        >
          {shouldShowCancel && (
            <Button
              type="button"
              variant="secondary"
              onClick={handleCancel}
              disabled={isLoading}
              data-event={cancelEvent}
              data-testid={actionTestId(cancelEvent)}
            >
              {resolvedCancelLabel}
            </Button>
          )}
          {showSubmit && (
            <Button
              type="submit"
              variant="primary"
              isLoading={isLoading}
              data-event={submitEvent}
              data-testid={actionTestId(submitEvent)}
            >
              {resolvedSubmitLabel}
            </Button>
          )}
        </HStack>
      )}
    </form>,
  );
};

Form.displayName = "Form";

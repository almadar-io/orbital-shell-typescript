/**
 * KnobField — the editor for one factory knob (`DomainQuestion`, derived by
 * `@almadar/core` from the knob's declared type). One editor for every place a
 * behavior's config is set: the build questionnaire and the inspector's
 * Settings. Structured knobs (`listOfObjects`, `objectForm`, `tagList`,
 * `fieldList`) emit native array/object values.
 */
import React, { useCallback, useMemo } from 'react';
import type {
  DomainQuestion,
  DomainQuestionAnswer,
  EntityField,
  FactoryParamValue,
} from '@almadar/core';
import { Accordion, type AccordionItem } from '../../core/molecules/Accordion';
import { Button } from '../../../core';
import { Checkbox } from '../../../core';
import { FormField } from '../../core/molecules/FormField';
import { HStack, VStack } from '../../../core';
import { Input } from '../../../core';
import { Radio } from '../../../core';
import { Select } from '../../../core';
import { Switch } from '../../../core';
import { TagInput } from '../../core/molecules/TagInput';
import { Typography } from '../../../core';
import { useTranslate } from '../../../core';

// -- Narrowing helpers --------------------------------------------------------
//
// `DomainQuestionAnswer` is a wide union; each widget needs a narrow
// view of its slot. These helpers consolidate the narrowing in one
// place so the widget switch stays readable.

function asString(v: DomainQuestionAnswer | undefined): string {
  return typeof v === 'string' ? v : '';
}

function asNumberInput(v: DomainQuestionAnswer | undefined): number | '' {
  return typeof v === 'number' && Number.isFinite(v) ? v : '';
}

function asBoolean(v: DomainQuestionAnswer | undefined): boolean {
  return v === true;
}

function asStringArray(v: DomainQuestionAnswer | undefined): ReadonlyArray<string> {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === 'string');
}

function asObjectArray(
  v: DomainQuestionAnswer | undefined,
): ReadonlyArray<Record<string, FactoryParamValue>> {
  if (!Array.isArray(v)) return [];
  return v.filter(
    (x): x is Record<string, FactoryParamValue> =>
      typeof x === 'object' && x !== null && !Array.isArray(x),
  );
}

function asObject(
  v: DomainQuestionAnswer | undefined,
): Readonly<Record<string, FactoryParamValue>> {
  if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
    return v as Readonly<Record<string, FactoryParamValue>>;
  }
  return {};
}


// -- Per-EntityField widget dispatch (used by objectForm + listOfObjects) ----

interface EntityFieldRenderProps {
  field: EntityField;
  value: FactoryParamValue | undefined;
  onChange: (next: FactoryParamValue) => void;
}

function EntityFieldInput({
  field,
  value,
  onChange,
}: EntityFieldRenderProps): React.ReactElement {
  const fieldType = field.type;

  if (fieldType === 'enum') {
    const choices = field.values ?? [];
    return (
      <Select
        options={choices.map((v) => ({ value: v, label: v }))}
        value={typeof value === 'string' ? value : ''}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }

  if (fieldType === 'boolean') {
    return (
      <Switch checked={value === true} onChange={(checked) => onChange(checked)} />
    );
  }

  if (fieldType === 'number') {
    return (
      <Input
        inputType="number"
        value={typeof value === 'number' ? value : ''}
        onChange={(e) => {
          const raw = (e.target as HTMLInputElement).value;
          if (raw === '') {
            onChange('');
            return;
          }
          const n = parseFloat(raw);
          onChange(Number.isFinite(n) ? n : '');
        }}
      />
    );
  }

  if (fieldType === 'date' || fieldType === 'datetime' || fieldType === 'timestamp') {
    return (
      <Input
        inputType={fieldType === 'date' ? 'date' : 'datetime-local'}
        value={typeof value === 'string' ? value : ''}
        onChange={(e) => onChange((e.target as HTMLInputElement).value)}
      />
    );
  }

  if (fieldType === 'array' && field.items) {
    // Nested array — defer to the list-of-objects editor when the
    // element schema is structured, otherwise to a tag list.
    return (
      <NestedArrayEditor
        itemSchema={field.items}
        value={Array.isArray(value) ? value : []}
        onChange={(next) => onChange(next as FactoryParamValue)}
      />
    );
  }

  if (fieldType === 'object' && field.properties) {
    return (
      <ObjectFormEditor
        schema={field.properties}
        value={
          typeof value === 'object' && value !== null && !Array.isArray(value)
            ? (value as Readonly<Record<string, FactoryParamValue>>)
            : {}
        }
        onChange={(next) => onChange(next as FactoryParamValue)}
      />
    );
  }

  // Default fallback — string input. Covers `string`, `relation`,
  // `trait`, `slot`, `pattern`, and any unrecognised type tag.
  return (
    <Input
      value={typeof value === 'string' ? value : ''}
      onChange={(e) => onChange((e.target as HTMLInputElement).value)}
    />
  );
}

// -- Structured-object form (objectForm) -------------------------------------

interface ObjectFormEditorProps {
  schema: Readonly<Record<string, EntityField>>;
  value: Readonly<Record<string, FactoryParamValue>>;
  onChange: (next: Readonly<Record<string, FactoryParamValue>>) => void;
}

function ObjectFormEditor({
  schema,
  value,
  onChange,
}: ObjectFormEditorProps): React.ReactElement {
  const entries = useMemo(() => Object.entries(schema), [schema]);
  return (
    <VStack gap="sm">
      {entries.map(([key, field]) => (
        <FormField
          key={key}
          label={field.name ?? key}
          required={field.required}
          hint={field.description}
        >
          <EntityFieldInput
            field={field}
            value={value[key]}
            onChange={(fieldValue) =>
              onChange({ ...value, [key]: fieldValue })
            }
          />
        </FormField>
      ))}
    </VStack>
  );
}

// -- List of objects (listOfObjects) ------------------------------------------
//
// Each element renders as an inline object form inside an `Accordion` item
// (header = label + row number, content = the form + a ghost Remove button).
// A single "Add" button below appends a new (empty) row. Preserves the full
// add/remove/edit-arbitrary-count capability the old `RepeatableFormSection`
// gave — just without its Card-per-row + counter + trash-icon chrome.

interface ListOfObjectsEditorProps {
  itemSchema: EntityField;
  value: ReadonlyArray<Record<string, FactoryParamValue>>;
  onChange: (next: ReadonlyArray<Record<string, FactoryParamValue>>) => void;
  title?: string;
}

function ListOfObjectsEditor({
  itemSchema,
  value,
  onChange,
  title,
}: ListOfObjectsEditorProps): React.ReactElement {
  const { t } = useTranslate();
  const properties = itemSchema.properties;
  const label = title ?? itemSchema.name ?? t('knobField.items');

  const handleAdd = useCallback(() => {
    onChange([...value, {}]);
  }, [value, onChange]);

  const handleRemove = useCallback(
    (index: number) => {
      const next = value.slice();
      next.splice(index, 1);
      onChange(next);
    },
    [value, onChange],
  );

  const updateAt = useCallback(
    (index: number, entry: Record<string, FactoryParamValue>) => {
      const next = value.slice();
      next[index] = entry;
      onChange(next);
    },
    [value, onChange],
  );

  const items: AccordionItem[] = value.map((entry, index) => ({
    id: `item-${index}`,
    header: `${label} ${index + 1}`,
    content: (
      <VStack gap="sm">
        <ObjectFormEditor
          schema={properties ?? {}}
          value={entry}
          onChange={(next) => updateAt(index, next)}
        />
        <Button
          variant="ghost"
          onClick={() => handleRemove(index)}
          className="self-start text-[10px]"
        >
          {t('knobField.removeItem')}
        </Button>
      </VStack>
    ),
  }));

  return (
    <VStack gap="xs">
      {items.length > 0 ? <Accordion items={items} /> : null}
      <Button variant="secondary" onClick={handleAdd} className="self-start text-[10px]">
        {t('knobField.addItem', { label })}
      </Button>
    </VStack>
  );
}

// -- Nested-array editor for fields whose items.properties exist --------------

interface NestedArrayEditorProps {
  itemSchema: EntityField;
  value: ReadonlyArray<FactoryParamValue>;
  onChange: (next: ReadonlyArray<FactoryParamValue>) => void;
}

function NestedArrayEditor({
  itemSchema,
  value,
  onChange,
}: NestedArrayEditorProps): React.ReactElement {
  if (itemSchema.type === 'object' && itemSchema.properties) {
    const objectArray = value.filter(
      (x): x is Record<string, FactoryParamValue> =>
        typeof x === 'object' && x !== null && !Array.isArray(x),
    );
    return (
      <ListOfObjectsEditor
        itemSchema={itemSchema}
        value={objectArray}
        onChange={(next) => onChange(next as ReadonlyArray<FactoryParamValue>)}
      />
    );
  }
  // Primitive array → tag list
  const stringArray = value.filter((x): x is string => typeof x === 'string');
  return (
    <TagInput
      value={stringArray}
      onChange={(next) => onChange([...next] as ReadonlyArray<FactoryParamValue>)}
    />
  );
}

// -- Entity-field list editor (`fieldList` input type) -----------------------

const FIELD_TYPE_OPTIONS = [
  { value: 'string', label: 'string' },
  { value: 'number', label: 'number' },
  { value: 'int', label: 'int' },
  { value: 'boolean', label: 'boolean' },
  { value: 'date', label: 'date' },
  { value: 'datetime', label: 'datetime' },
  { value: 'enum', label: 'enum' },
];

interface FieldListEditorProps {
  value: ReadonlyArray<EntityField>;
  onChange: (next: ReadonlyArray<EntityField>) => void;
}

function FieldListEditor({
  value,
  onChange,
}: FieldListEditorProps): React.ReactElement {
  const { t } = useTranslate();

  const handleAdd = useCallback(() => {
    onChange([...value, { name: '', type: 'string' } as EntityField]);
  }, [value, onChange]);

  const handleRemove = useCallback(
    (index: number) => {
      const next = value.slice();
      next.splice(index, 1);
      onChange(next);
    },
    [value, onChange],
  );

  const updateAt = useCallback(
    (index: number, patch: Partial<EntityField>) => {
      const next = value.slice();
      const current = next[index] ?? { name: '', type: 'string' };
      next[index] = { ...current, ...patch } as EntityField;
      onChange(next);
    },
    [value, onChange],
  );

  const items: AccordionItem[] = value.map((field, index) => ({
    id: `field-${index}`,
    header: field.name || `#${index + 1}`,
    content: (
      <VStack gap="sm">
        <HStack gap="sm" className="w-full">
          <Input
            placeholder={t('knobField.fieldNamePlaceholder')}
            value={field.name ?? ''}
            onChange={(e) =>
              updateAt(index, { name: (e.target as HTMLInputElement).value })
            }
          />
          <Select
            value={field.type ?? 'string'}
            onChange={(e) =>
              updateAt(index, fieldOfType(e.target.value as EntityField['type']))
            }
            options={FIELD_TYPE_OPTIONS}
          />
        </HStack>
        <Button
          variant="ghost"
          onClick={() => handleRemove(index)}
          className="self-start text-[10px]"
        >
          {t('knobField.removeItem')}
        </Button>
      </VStack>
    ),
  }));

  return (
    <VStack gap="xs">
      <Typography variant="caption" className="font-medium">
        {t('knobField.entityFields')}
      </Typography>
      {items.length > 0 ? <Accordion items={items} /> : null}
      <Button variant="secondary" onClick={handleAdd} className="self-start text-[10px]">
        {t('knobField.addField')}
      </Button>
    </VStack>
  );
}

// -- Enum Radio (user-facing enum choices) ------------------------------------
//
// Uses Radio buttons for closed user-facing enums (domain/policy questions).
// Falls back to a free-form input when there are no suggested values.
// Includes an "Other..." escape hatch via a text input revealed on selection.

interface EnumRadioProps {
  suggested: ReadonlyArray<string>;
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
}

function EnumRadio({
  suggested,
  value,
  onChange,
  placeholder,
}: EnumRadioProps): React.ReactElement {
  const { t } = useTranslate();
  if (suggested.length === 0) {
    return (
      <Input
        value={value}
        placeholder={placeholder ?? t('knobField.yourAnswer')}
        onChange={(e) => onChange((e.target as HTMLInputElement).value)}
      />
    );
  }
  const isOther = !!value && !suggested.includes(value);
  const radioOptions = [...suggested, t('knobField.other')];
  return (
    <VStack gap="xs">
      <Radio
        options={radioOptions}
        value={isOther ? t('knobField.other') : value}
        onChange={(e) => {
          const v = e.target.value;
          onChange(v === t('knobField.other') ? '' : v);
        }}
      />
      {isOther ? (
        <Input
          placeholder={t('knobField.specifyPlaceholder')}
          value={value}
          onChange={(e) => onChange((e.target as HTMLInputElement).value)}
        />
      ) : null}
    </VStack>
  );
}

// -- Entity-field multiselect -------------------------------------------------
//
// Used when `mutationTemplate.kind === 'set-orbital-entity-fields'`.
// Renders a labelled checkbox per suggested field name with fieldDescriptions
// as sub-labels, plus a `TagInput` for free-form extra field names (custom
// fields default to `type: 'string'` — see the report on why a per-custom-
// field type selector was dropped here).

interface EntityFieldMultiselectProps {
  question: DomainQuestion;
  value: DomainQuestionAnswer | undefined;
  onChange: (next: DomainQuestionAnswer) => void;
}

function asEntityFieldArray(v: DomainQuestionAnswer | undefined): ReadonlyArray<EntityField> {
  if (!Array.isArray(v)) return [];
  return v.filter(
    (x): x is EntityField =>
      typeof x === 'object' && x !== null && !Array.isArray(x) &&
      typeof (x as EntityField).name === 'string' &&
      typeof (x as EntityField).type === 'string',
  );
}

function EntityFieldMultiselect({
  question,
  value,
  onChange,
}: EntityFieldMultiselectProps): React.ReactElement {
  const { t } = useTranslate();
  const candidates = question.fieldCandidates ?? {};
  const descriptions = question.fieldDescriptions ?? {};
  const suggested = question.suggestedAnswers ?? [];

  // Current selection as a set of field names for fast lookup.
  const currentFields = asEntityFieldArray(value ?? question.defaultValue);
  const selectedNames = useMemo(
    () => new Set(currentFields.map((f) => f.name)),
    [currentFields],
  );

  // Known-candidate fields the user kept selected (checkboxes own these).
  const knownFields = useMemo(
    () => currentFields.filter((f) => !!candidates[f.name ?? '']),
    [currentFields, candidates],
  );
  // Custom fields the user added beyond the candidate set — names only,
  // the TagInput owns these; type always defaults to `string`.
  const customFieldNames = useMemo(
    () => currentFields.filter((f) => !candidates[f.name ?? '']).map((f) => f.name ?? ''),
    [currentFields, candidates],
  );

  const handleToggle = useCallback(
    (name: string) => {
      const next = selectedNames.has(name)
        ? currentFields.filter((f) => f.name !== name)
        : [...currentFields, candidates[name] ?? { name, type: 'string' as const }];
      onChange(next);
    },
    [selectedNames, currentFields, candidates, onChange],
  );

  const handleCustomFieldNamesChange = useCallback(
    (names: ReadonlyArray<string>) => {
      const customEntityFields = names
        .filter((n) => n.trim().length > 0)
        .map((name) => ({ name, type: 'string' as const }));
      onChange([...knownFields, ...customEntityFields]);
    },
    [knownFields, onChange],
  );

  return (
    <VStack gap="sm">
      <VStack gap="xs">
        {suggested.map((name) => (
          <VStack key={name} gap="xs" className="pl-1">
            <Checkbox
              label={name}
              checked={selectedNames.has(name)}
              onChange={() => handleToggle(name)}
            />
            {descriptions[name] ? (
              <Typography variant="caption" color="muted" className="text-[10px] pl-6">
                {descriptions[name]}
              </Typography>
            ) : null}
          </VStack>
        ))}
      </VStack>
      <VStack gap="xs">
        <Typography variant="caption" className="font-medium">
          {t('knobField.addOwnField')}
        </Typography>
        <TagInput
          value={customFieldNames}
          onChange={handleCustomFieldNamesChange}
          placeholder={t('knobField.fieldNamePlaceholder')}
        />
      </VStack>
    </VStack>
  );
}

// -- Top-level question input dispatch ---------------------------------------


/** A field change carrying only its new type, narrowed per kind (one object over the whole tag
 *  union exceeds TypeScript's discriminated-assignability limit). */
function fieldOfType(type: EntityField['type']): Partial<EntityField> {
  switch (type) {
    case 'enum':
      return { type };
    case 'relation':
      return { type };
    case 'union':
      return { type };
    case 'array':
      return { type };
    case 'object':
      return { type };
    case 'tuple':
      return { type, properties: {} };
    default:
      return { type };
  }
}

export interface KnobFieldProps {
  question: DomainQuestion;
  value: DomainQuestionAnswer | undefined;
  onChange: (next: DomainQuestionAnswer) => void;
}

export function KnobField({
  question,
  value,
  onChange,
}: KnobFieldProps): React.ReactElement {
  const { t } = useTranslate();
  const suggested = question.suggestedAnswers ?? [];

  switch (question.inputType) {
    case 'boolean':
      return (
        <Switch
          checked={asBoolean(value)}
          onChange={(checked) => onChange(checked)}
        />
      );

    case 'number':
      return (
        <Input
          inputType="number"
          value={asNumberInput(value)}
          placeholder={question.helpText ?? t('knobField.number')}
          onChange={(e) => {
            const raw = (e.target as HTMLInputElement).value;
            if (raw === '') {
              onChange('');
              return;
            }
            const n = parseFloat(raw);
            onChange(Number.isFinite(n) ? n : '');
          }}
        />
      );

    case 'multiselect': {
      // Entity-field multiselect: answer must be EntityField[] resolved from fieldCandidates.
      if (question.mutationTemplate.kind === 'set-orbital-entity-fields' && question.fieldCandidates) {
        return (
          <EntityFieldMultiselect
            question={question}
            value={value}
            onChange={onChange}
          />
        );
      }
      // Generic multiselect: answer is string[].
      const selected = asStringArray(value);
      return (
        <VStack gap="xs">
          {suggested.map((option) => {
            const isChecked = selected.includes(option);
            return (
              <Checkbox
                key={option}
                label={option}
                checked={isChecked}
                onChange={() => {
                  const next = isChecked
                    ? selected.filter((s) => s !== option)
                    : [...selected, option];
                  onChange(next);
                }}
              />
            );
          })}
        </VStack>
      );
    }

    case 'tagList':
      return (
        <TagInput
          value={asStringArray(value)}
          onChange={(next) => onChange([...next])}
          placeholder={question.helpText ?? t('knobField.addAValue')}
        />
      );

    case 'enum':
    case 'persistence':
      return (
        <EnumRadio
          suggested={suggested}
          value={asString(value)}
          onChange={(v) => onChange(v)}
          placeholder={question.helpText}
        />
      );

    case 'listOfObjects':
      return question.itemSchema ? (
        <ListOfObjectsEditor
          itemSchema={question.itemSchema}
          value={asObjectArray(value)}
          onChange={(next) => onChange([...next])}
        />
      ) : (
        <Typography variant="caption" color="muted">
          {t('knobField.missingItemSchema')}
        </Typography>
      );

    case 'objectForm':
      return question.objectSchema ? (
        <ObjectFormEditor
          schema={question.objectSchema}
          value={asObject(value)}
          onChange={(next) => onChange({ ...next })}
        />
      ) : (
        <Typography variant="caption" color="muted">
          {t('knobField.missingObjectSchema')}
        </Typography>
      );

    case 'fieldList':
      return (
        <FieldListEditor
          value={Array.isArray(value) ? (value as ReadonlyArray<EntityField>) : []}
          onChange={(next) => onChange([...next])}
        />
      );

    case 'urlPath':
    case 'text':
    default:
      return (
        <Input
          placeholder={question.helpText ?? t('knobField.yourAnswer')}
          value={asString(value)}
          onChange={(e) => onChange((e.target as HTMLInputElement).value)}
        />
      );
  }
}


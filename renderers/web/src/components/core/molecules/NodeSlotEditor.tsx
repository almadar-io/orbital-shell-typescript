'use client';
import React from 'react';
import type { TraitConfigValue, TraitConfigObject, ConfigFieldDeclaration } from '@almadar/core';
import { VStack } from '../../../core';
import { Select } from '../../../core';
import { Typography } from '../../../core';
import { JsonTreeEditor } from './JsonTreeEditor';
import { FieldControl } from './PropertyInspector';
import { getKnownPatterns, getPatternDefinition } from '../../../lib/pattern-resolver';
import { cn } from '../../../core';
import { useTranslate } from '../../../core';

const isObj = (v: TraitConfigValue | undefined): v is TraitConfigObject =>
  v !== null && v !== undefined && typeof v === 'object' && !Array.isArray(v);

/** A node slot holds a render-ui pattern config — `[{ type, …props }]`, a bare
 *  `{ type, …props }`, or nothing. Pull out the pattern type + the rest of its props. */
function normalize(value: TraitConfigValue | undefined): { type: string; props: TraitConfigObject; wasArray: boolean } {
  const wasArray = Array.isArray(value);
  const pattern = wasArray ? (value as ReadonlyArray<TraitConfigValue>)[0] : value;
  const type = isObj(pattern) && typeof pattern['type'] === 'string' ? (pattern['type'] as string) : '';
  const props: Record<string, TraitConfigValue> = {};
  if (isObj(pattern)) for (const [k, v] of Object.entries(pattern)) if (k !== 'type') props[k] = v;
  return { type, props, wasArray };
}

export interface NodeSlotEditorProps {
  /** Current node-slot value (a render-ui pattern config, or nothing). */
  value: TraitConfigValue | undefined;
  /** Fired with the next value. */
  onChange: (next: TraitConfigValue) => void;
  /** Additional CSS classes. */
  className?: string;
}

/**
 * NodeSlotEditor — edits a `node` config slot (e.g. `children`/`hud`/`debugPanel`).
 * A node slot renders a nested render-ui pattern, so this picks the pattern TYPE
 * from the known-pattern registry and edits that pattern's props as a tree — instead
 * of the read-only "edit in source" fallback. Self-contained `@almadar/ui` atoms.
 */
export const NodeSlotEditor: React.FC<NodeSlotEditorProps> = ({ value, onChange, className }) => {
  const { t } = useTranslate();
  const { type, props, wasArray } = normalize(value);
  const patterns = React.useMemo<string[]>(() => {
    try { return [...getKnownPatterns()].sort(); } catch { return []; }
  }, []);
  const options = React.useMemo(
    () => [{ value: '', label: t('nodeSlot.none') }, ...patterns.map((p) => ({ value: p, label: p }))],
    [patterns, t],
  );

  const emit = (nextType: string, nextProps: TraitConfigObject): void => {
    if (!nextType) { onChange(wasArray ? [] : {}); return; }
    const pattern: TraitConfigObject = { type: nextType, ...nextProps };
    // Match the slot's existing shape: node slots seed as a single-element array.
    onChange(wasArray || value === undefined ? [pattern] : pattern);
  };

  // Adapt pattern propsSchema → ConfigFieldDeclaration entries for typed controls
  const schemaEntries = React.useMemo<Array<[string, ConfigFieldDeclaration]>>(() => {
    if (!type) return [];
    const def = getPatternDefinition(type);
    if (!def?.propsSchema) return [];
    return Object.entries(def.propsSchema).map(([propName, propDef]) => {
      const decl: ConfigFieldDeclaration = {
        type: propDef.types?.[0] ?? 'string',
        description: propDef.description,
        label: propName,
        ...(propDef.enumValues && propDef.enumValues.length > 0 ? { values: propDef.enumValues } : {}),
      };
      return [propName, decl];
    });
  }, [type]);

  const hasSchema = schemaEntries.length > 0;

  return (
    <VStack gap="xs" className={cn('w-full', className)}>
      <Select
        options={options}
        value={type}
        onValueChange={(v) => emit(v as string, props)}
      />
      {type !== '' && (
        <VStack gap="none" className="pl-1">
          <Typography variant="caption" color="muted">{t('nodeSlot.props')}</Typography>
          {hasSchema ? (
            <VStack gap="xs">
              {schemaEntries.map(([propName, decl]) => (
                <FieldControl
                  key={propName}
                  name={propName}
                  decl={decl}
                  value={props[propName]}
                  onChange={(field, val) => emit(type, { ...props, [field]: val })}
                />
              ))}
            </VStack>
          ) : (
            <JsonTreeEditor value={props} onChange={(next) => emit(type, isObj(next) ? next : {})} />
          )}
        </VStack>
      )}
    </VStack>
  );
};

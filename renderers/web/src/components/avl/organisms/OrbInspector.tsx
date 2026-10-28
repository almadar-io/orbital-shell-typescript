'use client';

/**
 * OrbInspector
 *
 * Universal contextual inspector for .orb programs. Built into FlowCanvas.
 * Two tabs: Inspector (contextual sections) and Code (.orb syntax view).
 *
 * Inspector shows different sections based on what was clicked:
 *   - Orbital header → entity fields, traits, pages
 *   - Pattern element → pattern props, entity (if entity-aware), transition (if fires event)
 *   - Transition node → state diagram, guard, effects, render-ui source
 *
 * Code tab shows the .orb representation of the selected context.
 *
 * When `editable` is true, inspector fields become inputs.
 */

import React, { useContext, useMemo, useCallback, useState } from 'react';
import type { Effect, Entity, EntityCall, EntityField, EventPayload, EventPayloadValue, Expression, FieldType, OrbitalDefinition, OrbitalSchema, PatternNode, ThemeDefinition, Trait, Transition } from '@almadar/core';
import { EFFECT_OPERATORS, FieldTagSchema } from '@almadar/core';
import type { PatternPropDef } from '@almadar/core/patterns';
import { Box } from '../../../core';
import { Button } from '../../../core';
import { Typography } from '../../../core';
import { Badge } from '../../../core';
import { Input } from '../../../core';
import { Select } from '../../../core';
import { Icon } from '../../../core';
import { HStack } from '../../../core';
import { CodeBlock } from '../../core/molecules/markdown/CodeBlock';
import { AvlState } from '../atoms/AvlState';
import { AvlEvent } from '../atoms/AvlEvent';
import { AvlGuard } from '../atoms/AvlGuard';
import { AvlEffect } from '../atoms/AvlEffect';
import { AvlFieldType } from '../atoms/AvlFieldType';
import { PatternSelectionContext, type SelectedPattern } from '../molecules/OrbPreviewNode';
import { axisPositionFrom, type OffsetInParent } from '../../../lib/selection-geometry';
import { ElementEditAccessContext, type ElementEditAccessResolver, type ElementKnob, type ElementPropAccess } from '../../../lib/element-edit-access';
import { KnobSettingRow } from '../molecules/KnobSettingRow';
import { getPatternDefinition, isEntityAwarePattern, renderUiEntriesOf } from '@almadar/core/patterns';

import { Switch } from '../../../core';
import { cn } from '../../../core';
import { pressableProps } from '../../../core';
import { findTransition, resolvePatternConfig } from '../../../lib/resolve-pattern-config';
import { createLogger } from '@almadar/logger';
import { useEventBus } from '../../../core';
import { useTranslate } from '../../../core';
import { DESIGN_COLOR_TOKENS, DESIGN_RADIUS_TOKENS, DESIGN_SPACING_SCALE, isArbitraryClass, positionOf, sizeLimitOf, sizingOf, spacingOf, withPosition, withSizeLimit, withSizing, withSpacing, tokenOfDesignClass, type DesignColorUtility, type DesignClassToken, type DesignConstraint, type DesignSizeLimit } from '../../../lib/design-classes';
import { getStateRole, type StateRole, EFFECT_CATEGORY_COLORS, effectCategoryOf } from '../../../lib/avl-theme';
import { type PreviewNodeData } from '../../../lib/avl-preview-converter';

const inspectorLog = createLogger('almadar:ui:inspector');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatExpression(expr: Expression | null | undefined): string {
  if (!expr) return '';
  if (typeof expr === 'string') return expr;
  if (Array.isArray(expr)) return `(${expr.map(formatExpression).join(' ')})`;
  return String(expr);
}

function effectSummary(type: string): string {
  return type;
}

function findEntity(schema: OrbitalSchema, orbitalName: string): { name: string; persistence: string; fields: Array<{ name: string; type: FieldType; required?: boolean }> } | null {
  const orbital = (schema.orbitals ?? []).find((o: OrbitalDefinition) => o.name === orbitalName);
  if (!orbital || typeof orbital.entity === 'string') return null;
  const e = orbital.entity as Entity | EntityCall;
  const fields = (e.fields ?? []).map((f: EntityField) => ({
    name: f.name ?? '',
    type: f.type,
    required: f.required,
  }));
  return { name: e.name ?? orbitalName, persistence: e.persistence ?? 'runtime', fields };
}

function findTraits(schema: OrbitalSchema, orbitalName: string): Array<{ name: string; stateCount: number }> {
  const orbital = (schema.orbitals ?? []).find((o: OrbitalDefinition) => o.name === orbitalName);
  if (!orbital) return [];
  return ((orbital.traits ?? []) as Trait[]).filter((t: Trait) => typeof t !== 'string').map((t: Trait) => ({
    name: t.name,
    stateCount: t.stateMachine?.states?.length ?? 0,
  }));
}

// Derived from @almadar/core FieldTagSchema (canonical source)
const FIELD_TYPE_OPTIONS: Array<{ value: string; label: string }> =
  FieldTagSchema.options.map((v: FieldType) => ({ value: v, label: v }));

// Derived from @almadar/core EFFECT_OPERATORS (canonical source)
const EFFECT_TYPE_OPTIONS: Array<{ value: string; label: string }> =
  EFFECT_OPERATORS.map((v) => ({ value: v, label: v }));

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface OrbInspectorProps {
  node: PreviewNodeData;
  schema: OrbitalSchema;
  editable?: boolean;
  /**
   * Studio persona viewing the inspector. Controls tab visibility (Code is
   * architect-only, Styles is universal) and section visibility (Entity,
   * raw guard, raw effects are architect-only). Default `'builder'` matches
   * pre-Phase-2 behavior except for the new Styles tab, which every persona
   * gets.
   */
  userType?: 'builder' | 'designer' | 'architect';
  /**
   * Project theme tokens. The Styles tab reads them for Global edits (and, on
   * the synthesized `__design_system__` schema, lists them all); those edits
   * emit `UI:PROP_CHANGE` with `scope: 'global'` + `tokenGroup`/`tokenKey`.
   */
  themeManifest?: ThemeDefinition;
  /**
   * Initial tab on mount. Local state still owns the active tab after
   * that — this does not make the component controlled. Enables
   * deep-linking into a specific tab (e.g. from a LayersPanel selection).
   */
  defaultTab?: InspectorTab;
  /** Fires whenever the tab-bar selection changes. */
  onTabChange?: (tab: InspectorTab) => void;
  onSchemaChange?: (schema: OrbitalSchema) => void;
  onClose: () => void;
  /**
   * In-node pattern selection, when this inspector is rendered OUTSIDE
   * `FlowCanvas` (see `FlowCanvas`'s `externalInspector` +
   * `onSelectedPatternChange`). `PatternSelectionContext` only reaches
   * descendants of `FlowCanvas`'s own render tree, so a standalone
   * consumer has no other way to feed pattern-level selection in — pass
   * `FlowCanvas`'s `onSelectedPatternChange` payload straight through here.
   * When omitted (the inline, built-in-inspector usage), falls back to
   * `PatternSelectionContext`, unchanged.
   */
  selectedPattern?: SelectedPattern | null;
  /** What the selected element lets the user change; `ElementEditAccessContext` (inside a canvas) when omitted. */
  elementAccess?: ElementEditAccessResolver;
}

/** Why a prop isn't editable here, for the row and the notice. */
function propAccessText(access: Exclude<ElementPropAccess, { editable: true }>, t: (key: string, params?: Record<string, string>) => string): string {
  if (access.reason === 'bound') return t('avl.propBound', { binding: access.detail });
  if (access.reason === 'fixed') return t('avl.propFixed', { behavior: access.detail });
  return t('avl.propChecking');
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

type InspectorTab = 'inspector' | 'design' | 'prototype' | 'code';

export function OrbInspector({ node, schema, editable = false, userType = 'builder', themeManifest, defaultTab, onTabChange, onSchemaChange, onClose, selectedPattern: selectedPatternProp, elementAccess: elementAccessProp }: OrbInspectorProps): React.ReactElement {
  const { selected: contextSelectedPattern } = useContext(PatternSelectionContext);
  // A caller-supplied `selectedPattern` (external-inspector usage) always
  // wins over context — `undefined` (the prop omitted entirely) falls back
  // to context, but an explicit `null` (external caller has no selection)
  // must NOT fall through to whatever the (irrelevant, default-valued)
  // context happens to hold.
  const selectedPattern = selectedPatternProp !== undefined ? selectedPatternProp : contextSelectedPattern;
  const [activeTab, setActiveTab] = useState<InspectorTab>(defaultTab ?? 'inspector');
  // Props the element doesn't set wait under "More" — per selection.
  const [showMoreProps, setShowMoreProps] = useState(false);
  const selectedPatternKey = `${selectedPattern?.focus?.trait ?? ''}:${selectedPattern?.patternId ?? ''}`;
  const [shownFor, setShownFor] = useState(selectedPatternKey);
  if (shownFor !== selectedPatternKey) {
    setShownFor(selectedPatternKey);
    setShowMoreProps(false);
  }
  const handleTabChange = useCallback((tab: InspectorTab) => {
    setActiveTab(tab);
    onTabChange?.(tab);
  }, [onTabChange]);
  const eventBus = useEventBus();
  const { t } = useTranslate();

  const orbitalName = (node.orbitalName as string) ?? '';
  const traitName = (node.traitName as string) ?? '';
  const transitionEvent = (node.transitionEvent as string) ?? '';
  const fromState = (node.fromState as string) ?? '';
  const toState = (node.toState as string) ?? '';
  const entityName = (node.entityName as string) ?? '';
  const patterns = node.patterns ?? [];
  const effectTypes = (node.effectTypes ?? []) as string[];
  const guard = node.guard as Expression | null | undefined;
  const isExpanded = Boolean(traitName);

  const hasRenderUi = effectTypes.includes('render-ui');

  const patternType = selectedPattern?.patternType;
  const patternDef = useMemo(() => patternType ? getPatternDefinition(patternType) : null, [patternType]);
  const isEntityPattern = patternType ? isEntityAwarePattern(patternType) : false;
  const entity = useMemo(() => findEntity(schema, orbitalName), [schema, orbitalName]);
  const transition = useMemo(() => {
    if (!traitName || !transitionEvent) return null;
    return findTransition(schema, orbitalName, traitName, transitionEvent);
  }, [schema, orbitalName, traitName, transitionEvent]);
  const traits = useMemo(() => findTraits(schema, orbitalName), [schema, orbitalName]);
  // The Inspector tab's sections. A tab with none of them to show is not offered.
  const showEntityFields = userType === 'architect' && ((Boolean(selectedPattern) && isEntityPattern) || (!selectedPattern && !isExpanded)) && Boolean(entity);
  const showServiceMode = editable && !selectedPattern && !isExpanded && node.layer === 'Services';
  const showTraits = !selectedPattern && !isExpanded && traits.length > 0;
  const inspectorHasContent = showEntityFields || showServiceMode || showTraits;
  const shownTab: InspectorTab = activeTab === 'inspector' && !inspectorHasContent ? 'design' : activeTab;

  // Resolve current pattern config values from the schema.
  //
  // Pattern configs arrive in two shapes (see UISlotRenderer.tsx:1003 —
  // the runtime normalizes both):
  //  1. Flat:   `{type: 'icon', name: 'home', size: 'md'}`
  //  2. Nested: `{type: 'icon', props: {name: 'home', size: 'md'}, _id}`
  // The std behaviors emit flat; agent runs sometimes emit nested. Without
  // unwrapping, a nested-shape pattern shows every prop as '—' because
  // `patternConfig.name` is undefined and the actual value lives at
  // `patternConfig.props.name`. Same VG31 cascade the renderer's comment
  // calls out, surfaced one layer down.
  //
  // Selection scoping: at L2 the click context carries (orbital, trait,
  // transition) so we resolve against that one transition's render-ui. At
  // L1 the click context only carries (orbital), so `transition` is null —
  // we widen to "any render-ui in the source trait, or any in the orbital
  // if the source trait is also unknown." The patternId path is unique to
  // one tree; the wrong tree returns null and we move on.
  // The selected element's own address (the trait that drew it — an embedded
  // trait's, not the card's); an element picked without a canvas has none.
  const elementFocus = selectedPattern?.focus;
  const elementOrbital = elementFocus?.orbital ?? orbitalName;
  const elementTrait = elementFocus?.trait ?? traitName;
  const elementTransition = elementFocus?.transition ?? transitionEvent;
  const elementSlot = elementFocus?.slot;
  const contextAccess = useContext(ElementEditAccessContext);
  const accessResolver = elementAccessProp ?? contextAccess;
  const elementAccess = accessResolver && elementFocus ? accessResolver(elementFocus) : null;
  const propAccess = useCallback(
    (propName: string): ElementPropAccess => elementAccess?.prop(propName) ?? { editable: true },
    [elementAccess],
  );
  const patternConfig = useMemo(
    () => (selectedPattern
      ? resolvePatternConfig(schema, {
          orbitalName: elementOrbital,
          traitName: elementTrait,
          transitionEvent: elementTransition,
          sourceTrait: selectedPattern.sourceTrait,
          patternId: selectedPattern.patternId,
          patternType: selectedPattern.patternType,
        })
      : null),
    [selectedPattern, schema, elementOrbital, elementTrait, elementTransition],
  );

  // Generate the relevant JSON slice for the code tab
  const orbCode = useMemo(() => {
    const orbital = (schema.orbitals ?? []).find((o: OrbitalDefinition) => o.name === orbitalName);
    if (!orbital) return '{}';

    if (isExpanded && traitName) {
      const traitList = (orbital.traits ?? []) as Trait[];
      const trait = traitList.find(tr => typeof tr !== 'string' && tr.name === traitName);
      if (trait && typeof trait !== 'string' && trait.stateMachine) {
        if (transitionEvent) {
          const tx = (trait.stateMachine.transitions as Transition[])?.find(txn => txn.event === transitionEvent);
          if (tx) return JSON.stringify(tx, null, 2);
        }
        return JSON.stringify({ name: trait.name, stateMachine: trait.stateMachine }, null, 2);
      }
    }

    return JSON.stringify(orbital, null, 2);
  }, [schema, orbitalName, traitName, transitionEvent, isExpanded]);

  // W1: Pattern prop editing via EventBus. Selection context goes with the
  // payload so the page-level dispatcher can fork between the project schema
  // (schemaEditor.updatePatternProp) and the synthesized Design System schema
  // (themeManifest.setToken) without consulting any global ref.
  const handlePropChange = useCallback((propName: string, value: EventPayloadValue) => {
    if (!editable) return;
    const access = propAccess(propName);
    if (!access.editable) {
      eventBus.emit('UI:NOTIFY', { severity: 'info', message: propAccessText(access, t) });
      return;
    }
    eventBus.emit('UI:PROP_CHANGE', {
      scope: 'local',
      propName,
      value,
      selection: {
        ...(selectedPattern?.nodeData.sourceSchemaName !== undefined ? { sourceSchemaName: selectedPattern.nodeData.sourceSchemaName } : {}),
        ...(selectedPattern?.patternId !== undefined ? { patternPath: selectedPattern.patternId } : {}),
        orbitalName: elementOrbital,
        traitName: elementTrait,
        transitionEvent: elementTransition,
        ...(elementSlot ? { slot: elementSlot } : {}),
      },
    });
  }, [editable, propAccess, eventBus, t, selectedPattern, elementOrbital, elementTrait, elementTransition, elementSlot]);

  // A theme-token edit: changes the token everywhere it's used, not this element.
  const handleTokenChange = useCallback((token: InspectorTokenRef, value: string) => {
    if (!editable) return;
    eventBus.emit('UI:PROP_CHANGE', {
      scope: 'global',
      tokenGroup: token.group,
      tokenKey: token.key,
      value,
      selection: {
        ...(selectedPattern?.nodeData.sourceSchemaName !== undefined ? { sourceSchemaName: selectedPattern.nodeData.sourceSchemaName } : {}),
        ...(selectedPattern?.patternId !== undefined ? { patternPath: selectedPattern.patternId } : {}),
        orbitalName: elementOrbital,
        traitName: elementTrait,
        transitionEvent: elementTransition,
        ...(elementSlot ? { slot: elementSlot } : {}),
      },
    });
  }, [editable, eventBus, selectedPattern, elementOrbital, elementTrait, elementTransition, elementSlot]);

  // W2: Entity field mutations via EventBus
  const handleAddField = useCallback(() => {
    eventBus.emit('UI:ADD_FIELD', {});
  }, [eventBus]);

  const handleUpdateField = useCallback((fieldName: string, updates: EventPayload) => {
    eventBus.emit('UI:UPDATE_FIELD', { fieldName, updates });
  }, [eventBus]);

  const handleRemoveField = useCallback((fieldName: string) => {
    eventBus.emit('UI:REMOVE_FIELD', { fieldName });
  }, [eventBus]);

  // W3: Guard editing via EventBus
  const handleGuardChange = useCallback((guardExpr: string) => {
    if (!editable) return;
    // Pass the raw string; BuilderPage can parse if needed
    eventBus.emit('UI:GUARD_CHANGE', { guard: guardExpr || null });
  }, [editable, eventBus]);

  // W3: Effect mutations via EventBus
  const handleAddEffect = useCallback((effectType: string) => {
    eventBus.emit('UI:ADD_EFFECT', { effectType });
  }, [eventBus]);

  const handleRemoveEffect = useCallback((effectIndex: number) => {
    eventBus.emit('UI:REMOVE_EFFECT', { effectIndex });
  }, [eventBus]);

  void onSchemaChange; // Editing goes through EventBus, not direct callback

  // Every prop is reachable: the ones the element sets first, the rest under "More".
  // A prop that is one of the call site's knobs is edited in Settings, not listed twice.
  const knobKeys = new Set(elementAccess?.settings?.knobs.map((k) => k.key) ?? []);
  const setInSettings = (propName: string): boolean => {
    const access = propAccess(propName);
    return access.editable && access.knob !== undefined && knobKeys.has(access.knob);
  };
  const propEntries: Array<[string, PatternPropDef]> = patternDef?.propsSchema
    ? Object.entries(patternDef.propsSchema).filter(([propName]) => !setInSettings(propName))
    : [];
  const setProps = propEntries.filter(([propName]) => patternConfig?.[propName] !== undefined);
  const moreProps = propEntries.filter(([propName]) => patternConfig?.[propName] === undefined);
  const renderPropRow = ([propName, propSchema]: [string, PatternPropDef]): React.ReactElement => {
    const ps: PatternPropDef = propSchema;
    const explicitValue = patternConfig ? patternConfig[propName] : undefined;
    const defaultValue = ps.default;
    const isImplicit = explicitValue === undefined && defaultValue !== undefined;
    const currentValue = explicitValue !== undefined ? explicitValue : defaultValue;
    const displayValue = currentValue !== undefined
      ? (typeof currentValue === 'object' ? JSON.stringify(currentValue) : String(currentValue))
      : '';
    inspectorLog.debug('prop-row', () => ({
      patternType: patternDef?.type ?? '',
      patternId: selectedPattern?.patternId ?? '',
      propName,
      explicitValue: explicitValue === undefined ? '<unset>' : JSON.stringify(explicitValue),
      defaultValue: defaultValue === undefined ? '<unset>' : JSON.stringify(defaultValue),
      isImplicit: String(isImplicit),
    }));
    const access = propAccess(propName);
    return (
      <Box key={propName} className="flex items-center gap-2">
        <Typography variant="small" className="text-muted-foreground text-xs w-20 shrink-0 font-mono">{propName}</Typography>
        {editable && !access.editable ? (
          <Typography variant="small" className="text-xs text-muted-foreground italic truncate">
            {propAccessText(access, t)}
          </Typography>
        ) : editable ? (
          <Input
            defaultValue={displayValue}
            placeholder={(ps.types as string[])?.join(' | ') ?? 'string'}
            className="flex-1 text-xs h-6"
            onBlur={(e: React.FocusEvent<HTMLInputElement>) => handlePropChange(propName, e.target.value)}
          />
        ) : (
          <Typography variant="small" className="text-xs text-muted-foreground">
            {displayValue || '—'}{ps.required ? ' *' : ''}
          </Typography>
        )}
      </Box>
    );
  };

  const headerTitle = selectedPattern
    ? selectedPattern.patternType
    : isExpanded ? transitionEvent || t('avl.transition') : orbitalName;

  return (
    <Box className="flex flex-col bg-card border-l border-border h-full w-full sm:w-[340px]">
      {/* Header + Tabs */}
      <Box className="shrink-0 border-b border-border">
        <Box className="flex items-center justify-between px-4 py-2">
          <Box className="flex items-center gap-2">
            {selectedPattern ? (
              <Box
                className="rounded px-2 py-0.5 text-xs font-mono font-semibold"
                style={{ backgroundColor: 'var(--color-primary)', color: 'var(--color-primary-foreground)' }}
              >
                {headerTitle}
              </Box>
            ) : (
              <Typography variant="small" className="font-semibold">{headerTitle}</Typography>
            )}
          </Box>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground text-sm cursor-pointer bg-transparent border-none p-1"
            aria-label={t('common.close')}
          >
            &times;
          </button>
        </Box>

        {/* Tab bar. Persona gating: Code is architect-only; Design and
            Prototype are universal (the sections inside each keep their
            own persona gate exactly as before). */}
        <Box className="flex px-4 gap-4">
          {(['inspector', 'design', 'prototype', 'code'] as const)
            .filter((tab) => tab !== 'code' || userType === 'architect')
            .filter((tab) => tab !== 'inspector' || inspectorHasContent)
            .map((tab) => (
              <button
                key={tab}
                onClick={() => handleTabChange(tab)}
                className={`pb-2 text-xs font-medium border-b-2 cursor-pointer bg-transparent border-x-0 border-t-0 px-0 capitalize ${
                  shownTab === tab
                    ? 'border-[var(--color-primary)] text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                {t(`orbInspector.tab.${tab}`)}
              </button>
            ))}
        </Box>
      </Box>

      {/* Scrollable content */}
      <Box className="flex-1 overflow-y-auto">
        {shownTab === 'code' && userType === 'architect' ? (
          /* ── Code Tab (architect only) ── */
          /* GAP-51: when editable, the CodeBlock molecule renders the existing
             Textarea atom internally and forwards keystrokes via UI:CODE_CHANGE
             on the EventBus. The consumer (builder workspace) listens, debounces,
             parses via safeParseOrbitalSchema, and calls setSchema. Read-only
             consumers (editable=false) see the existing syntax-highlighted view. */
          <Box className="p-2">
            <CodeBlock
              code={orbCode}
              language="orb"
              showCopyButton
              showLanguageBadge
              maxHeight="100%"
              editable={editable}
              onChange={editable ? (code) => eventBus.emit('UI:CODE_CHANGE', { code }) : undefined}
            />
          </Box>
        ) : shownTab === 'design' ? (
          /* ── Design Tab ── Pattern Props + Styles + render-ui source. */
          <>
            {/* Pattern Props */}
            {selectedPattern && patternDef?.propsSchema && (
              <Box className="px-4 py-3 border-b border-border/40">
                <Typography variant="small" className="text-muted-foreground text-xs uppercase tracking-wider mb-2">{t('avl.props')}</Typography>
                {elementAccess?.partOf && (
                  <Badge variant="neutral" size="sm" className="mb-2" data-testid="orb-inspector-part-of">
                    {t('orbPreview.partOf', { behavior: elementAccess.partOf })}
                  </Badge>
                )}
                <Box className="flex flex-col gap-1.5">
                  {setProps.map(renderPropRow)}
                  {moreProps.length > 0 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="self-start text-xs h-6 px-1"
                      onClick={() => setShowMoreProps((open) => !open)}
                      data-testid="orb-inspector-more-props"
                    >
                      {t('avl.moreProps', { count: String(moreProps.length) })}
                    </Button>
                  )}
                  {showMoreProps && moreProps.map(renderPropRow)}
                </Box>
              </Box>
            )}

            {elementAccess?.settings && elementAccess.settings.knobs.length > 0 && (
              <Box className="px-4 py-3 border-b border-border/40" data-testid="orb-inspector-settings">
                <Typography variant="small" className="text-muted-foreground text-xs uppercase tracking-wider mb-2">
                  {elementAccess.partOf ? t('avl.settingsOf', { behavior: elementAccess.partOf }) : t('avl.settings')}
                </Typography>
                <Box className="flex flex-col gap-3">
                  {elementAccess.settings.knobs.map((knob) => (
                    <KnobSettingRow key={`${elementAccess.settings?.trait}.${knob.key}`} knob={knob} editable={editable} />
                  ))}
                </Box>
              </Box>
            )}

            {/* Styles — variant + size pills are clickable when `editable`
                and emit `UI:PROP_CHANGE` with the selection context. The
                page-level dispatcher applies `scope: 'local'` edits to the
                element and `scope: 'global'` edits to the theme token. */}
            <StylesTab
              patternType={patternType}
              patternDef={patternDef}
              patternConfig={patternConfig}
              editable={editable}
              onPropChange={handlePropChange}
              onTokenChange={handleTokenChange}
              themeManifest={themeManifest}
              isDesignSystem={selectedPattern?.nodeData.sourceSchemaName === '__design_system__'}
              offsetInParent={selectedPattern?.offsetInParent}
            />

            {/* Render-UI Source (architect only — raw SExpression tree) */}
            {userType === 'architect' && patterns.length > 0 && !selectedPattern && (
              <Box className="px-4 py-3">
                <Typography variant="small" className="text-muted-foreground text-xs uppercase tracking-wider mb-2">render-ui</Typography>
                <Box className="bg-muted/20 rounded-md p-3 font-mono text-xs leading-relaxed overflow-x-auto">
                  {patterns.map((entry, i) => (
                    <Box key={i}>
                      <Typography variant="small" className="text-muted-foreground text-xs">{t('orbInspector.slotLabel', { slot: entry.slot })}</Typography>
                      <OrbPatternTree config={entry.pattern as PatternNode} depth={0} />
                    </Box>
                  ))}
                </Box>
              </Box>
            )}
          </>
        ) : shownTab === 'prototype' ? (
          /* ── Prototype Tab ── State Transition + Trigger + Guard + Effects. */
          <>
            {/* State Transition */}
            {isExpanded && fromState && toState && (
              <Box className="px-4 py-3 border-b border-border/40">
                <Typography variant="small" className="text-muted-foreground text-xs uppercase tracking-wider mb-2">{t('avl.transition')}</Typography>
                <svg width="100%" height={44} viewBox="0 0 280 44">
                  <AvlState x={8} y={8} name={fromState} role={getStateRole()} width={90} height={26} />
                  <line x1={104} y1={21} x2={158} y2={21} stroke="var(--color-foreground)" strokeWidth={2} markerEnd="url(#orb-arrow)" />
                  <AvlState x={164} y={8} name={toState} role={getStateRole()} width={90} height={26} />
                  <defs>
                    <marker id="orb-arrow" markerWidth={8} markerHeight={6} refX={8} refY={3} orient="auto">
                      <path d="M0,0 L8,3 L0,6 Z" fill="var(--color-foreground)" />
                    </marker>
                  </defs>
                </svg>
                {traitName && (
                  <Typography variant="small" className="text-muted-foreground text-xs">
                    {traitName}{entityName ? t('orbInspector.onEntity', { entity: entityName }) : ''}
                  </Typography>
                )}
              </Box>
            )}

            {/* Trigger */}
            {isExpanded && transitionEvent && (
              <Box className="px-4 py-2 border-b border-border/40">
                <Box className="flex items-center gap-2">
                  <svg width={16} height={16}><AvlEvent x={8} y={8} size={12} /></svg>
                  <Typography variant="small" className="font-semibold text-xs">{transitionEvent}</Typography>
                </Box>
              </Box>
            )}

            {/* Guard (architect only — raw SExpression / boolean expression isn't designer-facing) */}
            {userType === 'architect' && (transition?.guard ?? guard ?? editable) && isExpanded && (
              <Box className="px-4 py-2 border-b border-border/40">
                <HStack gap="xs" className="items-center">
                  <svg width={16} height={16}><AvlGuard x={8} y={8} size={12} /></svg>
                  {editable ? (
                    <Input
                      defaultValue={formatExpression(transition?.guard ?? guard)}
                      placeholder={t('orbInspector.guardExpression')}
                      className="flex-1 text-xs font-mono h-6"
                      onBlur={(e: React.FocusEvent<HTMLInputElement>) => handleGuardChange(e.target.value)}
                    />
                  ) : (
                    <Typography variant="small" className="font-mono text-xs text-muted-foreground">
                      {formatExpression(transition?.guard ?? guard)}
                    </Typography>
                  )}
                </HStack>
              </Box>
            )}

            {/* Effects (architect only — raw effect list maps directly to the IR) */}
            {userType === 'architect' && (effectTypes.length > 0 || editable) && isExpanded && (
              <Box className="px-4 py-3 border-b border-border/40">
                <Typography variant="small" className="text-muted-foreground text-xs uppercase tracking-wider mb-2">
                  {t('avl.effects')} ({effectTypes.length})
                </Typography>
                <Box className="flex flex-col gap-1.5">
                  {effectTypes.map((type, i) => {
                    const category = effectCategoryOf(type);
                    const isKnown = category !== null;
                    const catColor = category ? EFFECT_CATEGORY_COLORS[category] : undefined;
                    return (
                      <HStack key={i} gap="xs" className="items-center">
                        <Typography variant="small" className="text-muted-foreground text-xs w-4 text-right shrink-0">{i + 1}.</Typography>
                        {isKnown && (
                          <svg width={16} height={16}><AvlEffect x={8} y={8} effectType={type} size={6} showBackground /></svg>
                        )}
                        <Typography variant="small" className="text-xs flex-1" style={{ color: catColor?.color }}>
                          {effectSummary(type)}
                        </Typography>
                        {editable && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleRemoveEffect(i)}
                            className="shrink-0 p-0.5 h-6 w-6"
                          >
                            <Icon name="x" size="xs" />
                          </Button>
                        )}
                      </HStack>
                    );
                  })}
                </Box>
                {editable && (
                  <AddEffectButton onAdd={handleAddEffect} />
                )}
              </Box>
            )}
          </>
        ) : (
          /* ── Inspector Tab (overview) ── orbital-scoped sections only. */
          <>
            {/* Entity Fields (architect only — designer/builder hide entity persistence + field types) */}
            {showEntityFields && entity && (
              <Box className="px-4 py-3 border-b border-border/40">
                <Typography variant="small" className="text-muted-foreground text-xs uppercase tracking-wider mb-2">{t('avl.entity')}</Typography>
                <Box className="flex items-center gap-2 mb-2">
                  <svg width={14} height={14}><circle cx={7} cy={7} r={5} fill="var(--color-primary)" /></svg>
                  <Typography variant="small" className="font-semibold text-xs">{entity.name}</Typography>
                  <Typography variant="small" className="text-muted-foreground text-xs">{entity.persistence}</Typography>
                </Box>
                <Box className="flex flex-col gap-1">
                  {entity.fields.map(f => (
                    <HStack key={f.name} gap="xs" className="items-center">
                      <svg width={12} height={12}><AvlFieldType x={6} y={6} kind={f.type} size={4} /></svg>
                      {editable ? (
                        <>
                          <Input
                            defaultValue={f.name}
                            className="flex-1 text-xs font-mono h-6"
                            onBlur={(e: React.FocusEvent<HTMLInputElement>) => {
                              if (e.target.value !== f.name) {
                                handleUpdateField(f.name, { name: e.target.value });
                              }
                            }}
                          />
                          <Select
                            value={f.type}
                            options={FIELD_TYPE_OPTIONS}
                            onValueChange={(v) => handleUpdateField(f.name, { type: v as string })}
                            className="w-20 text-xs h-6"
                          />
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleRemoveField(f.name)}
                            className="shrink-0 p-0.5 h-6 w-6"
                          >
                            <Icon name="x" size="xs" />
                          </Button>
                        </>
                      ) : (
                        <>
                          <Typography variant="small" className="text-xs font-mono flex-1">{f.name}</Typography>
                          <Typography variant="small" className="text-muted-foreground text-xs">{f.type}</Typography>
                          {f.required && <Typography variant="small" className="text-primary text-[9px]">{t('orbInspector.required')}</Typography>}
                        </>
                      )}
                    </HStack>
                  ))}
                </Box>
                {editable && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleAddField}
                    className="mt-2 text-xs w-full"
                  >
                    <Icon name="plus" size="xs" className="mr-1" />
                    {t('orbInspector.addField')}
                  </Button>
                )}
              </Box>
            )}

            {/* Service Mode Toggle (service behaviors only) */}
            {showServiceMode && (
              <Box className="px-4 py-3 border-b border-border/40">
                <Typography variant="small" className="text-muted-foreground text-xs uppercase tracking-wider mb-2">{t('orbInspector.serviceMode')}</Typography>
                <HStack gap="sm" className="items-center">
                  <Button
                    variant={hasRenderUi ? 'primary' : 'ghost'}
                    size="sm"
                    className="flex-1 text-xs"
                    onClick={() => {
                      if (!hasRenderUi) eventBus.emit('UI:SERVICE_MODE_TOGGLE', { orbitalName: node.orbitalName, standalone: true });
                    }}
                  >
                    <Icon name="monitor" size="xs" className="mr-1" />
                    {t('orbInspector.standalone')}
                  </Button>
                  <Button
                    variant={hasRenderUi ? 'ghost' : 'primary'}
                    size="sm"
                    className="flex-1 text-xs"
                    onClick={() => {
                      if (hasRenderUi) eventBus.emit('UI:SERVICE_MODE_TOGGLE', { orbitalName: node.orbitalName, standalone: false });
                    }}
                  >
                    <Icon name="cpu" size="xs" className="mr-1" />
                    {t('orbInspector.embedded')}
                  </Button>
                </HStack>
                <Typography variant="small" className="text-muted-foreground text-xs mt-1">
                  {hasRenderUi ? t('orbInspector.rendersOwnUi') : t('orbInspector.headless')}
                </Typography>
              </Box>
            )}

            {/* Traits (orbital overview) */}
            {showTraits && (
              <Box className="px-4 py-3 border-b border-border/40">
                <Typography variant="small" className="text-muted-foreground text-xs uppercase tracking-wider mb-2">{t('avl.traits')}</Typography>
                <Box className="flex flex-col gap-1">
                  {traits.map(tr => (
                    <Box key={tr.name} className="flex items-center gap-2">
                      <Typography variant="small" className="text-xs font-semibold">{tr.name}</Typography>
                      <Typography variant="small" className="text-muted-foreground text-xs">{t('orbInspector.statesCount', { count: tr.stateCount })}</Typography>
                    </Box>
                  ))}
                </Box>
              </Box>
            )}
          </>
        )}
      </Box>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Add Effect dropdown button
// ---------------------------------------------------------------------------

function AddEffectButton({ onAdd }: { onAdd: (type: string) => void }): React.ReactElement {
  const [open, setOpen] = useState(false);
  const { t } = useTranslate();

  return (
    <Box className="relative mt-2">
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setOpen(prev => !prev)}
        className="text-xs w-full"
      >
        <Icon name="plus" size="xs" className="mr-1" />
        {t('orbInspector.addEffect')}
      </Button>
      {open && (
        <Box className="absolute z-20 top-full left-0 right-0 mt-1 bg-card border border-border rounded-md shadow-lg overflow-hidden">
          {EFFECT_TYPE_OPTIONS.map(opt => (
            <Box
              key={opt.value}
              className="px-3 py-1.5 text-xs cursor-pointer hover:bg-muted/50 flex items-center gap-2"
              {...pressableProps(() => { onAdd(opt.value); setOpen(false); })}
            >
              {effectCategoryOf(opt.value) !== null && (
                <svg width={14} height={14}><AvlEffect x={7} y={7} effectType={opt.value} size={5} showBackground /></svg>
              )}
              <Typography variant="small" className="text-xs">{opt.label}</Typography>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Pattern tree renderer
// ---------------------------------------------------------------------------

function OrbPatternTree({ config, depth }: { config: PatternNode; depth: number }): React.ReactElement | null {
  if (!config || typeof config !== 'object') return null;
  const { type, children, ...props } = config;
  if (typeof type !== 'string') return null;

  const propEntries = Object.entries(props).filter(([k]) => k !== 'type');

  return (
    <Box style={{ paddingLeft: depth * 12 }}>
      <Typography variant="small" className="text-primary font-semibold text-xs">{type}</Typography>
      {propEntries.slice(0, 5).map(([key, val]) => {
        const display = typeof val === 'string'
          ? val.startsWith('@') ? <span className="text-primary">{val}</span> : `"${val}"`
          : Array.isArray(val) && val.length > 0 && typeof val[0] === 'string' && (val[0] as string).includes('/')
            ? <span className="text-warning">({val.map(String).join(' ')})</span>
            : String(val);
        return (
          <Box key={key} className="flex gap-1 text-xs">
            <span className="text-muted-foreground">{key}:</span>
            <span>{display}</span>
          </Box>
        );
      })}
      {Array.isArray(children) && children.map((child, i) => (
        <OrbPatternTree key={i} config={child as PatternNode} depth={depth + 1} />
      ))}
    </Box>
  );
}

OrbInspector.displayName = 'OrbInspector';

// ---------------------------------------------------------------------------
// Styles tab — variant/size editor
// ---------------------------------------------------------------------------

/**
 * Stopgap token contract per pattern. Phase-2 leftover until each
 * `@almadar/core/patterns` PatternEntry grows a real `tokenContract` field
 * sourced from @almadar/ui component analysis. Patterns missing here
 * render an empty list with a "no contract declared" note so the gap is
 * visible. Read by the Styles tab to show which CSS variables a pattern
 * consumes.
 */
const PHASE_2_TOKEN_FALLBACK: Record<string, string[]> = {
  button: ['--color-primary', '--color-primary-foreground', '--radius-md', '--shadow-sm'],
  badge: ['--color-primary', '--radius-full'],
  card: ['--color-card', '--color-border', '--radius-lg', '--shadow-main'],
  input: ['--color-input', '--color-border', '--radius-md'],
  typography: ['--color-foreground', '--color-muted-foreground'],
  divider: ['--color-border'],
  avatar: ['--radius-full', '--color-muted'],
  alert: ['--color-warning', '--color-success', '--color-danger', '--radius-md'],
  modal: ['--color-card', '--shadow-lg', '--radius-lg'],
  toast: ['--color-card', '--shadow-lg', '--radius-md'],
};

interface StylesTabProps {
  patternType: string | undefined;
  patternDef: ReturnType<typeof getPatternDefinition>;
  patternConfig: PatternNode | null;
  editable: boolean;
  onPropChange: (propName: string, value: EventPayloadValue) => void;
  onTokenChange: (token: InspectorTokenRef, value: string) => void;
  themeManifest?: ThemeDefinition;
  /** Selection originates from the synthesized `__design_system__` schema. */
  isDesignSystem: boolean;
  offsetInParent?: OffsetInParent;
}

function StylesTab({ patternType, patternDef, patternConfig, editable, onPropChange, onTokenChange, themeManifest, isDesignSystem, offsetInParent }: StylesTabProps): React.ReactElement {
  const { t } = useTranslate();

  if (!patternType) {
    return (
      <Box className="p-4">
        <Typography variant="small" className="text-muted-foreground text-xs">
          {t('orbInspector.selectPatternForStyles')}
        </Typography>
      </Box>
    );
  }

  const tier = patternDef?.category ?? t('orbInspector.pattern');
  const tokens = PHASE_2_TOKEN_FALLBACK[patternType] ?? [];

  const variantEnum = patternDef?.propsSchema?.variant?.enumValues;
  const sizeEnum = patternDef?.propsSchema?.size?.enumValues;
  const currentVariant = patternConfig && typeof patternConfig.variant === 'string' ? patternConfig.variant : undefined;
  const currentSize = patternConfig && typeof patternConfig.size === 'string' ? patternConfig.size : undefined;

  return (
    <Box className="px-4 py-3 flex flex-col gap-4">
      {/* Header: pattern type + tier badge */}
      <Box className="flex items-center gap-2">
        <Typography variant="small" className="font-semibold text-xs">{patternType}</Typography>
        <Box
          className="rounded px-1.5 py-0.5 text-[9px] font-mono uppercase tracking-wider"
          style={{ backgroundColor: 'var(--color-muted)', color: 'var(--color-muted-foreground)' }}
        >
          {tier}
        </Box>
      </Box>

      {/* Tokens this pattern consumes */}
      <Box>
        <Typography variant="small" className="text-muted-foreground text-xs uppercase tracking-wider mb-2">
          {t('orbInspector.tokens')}
        </Typography>
        {tokens.length === 0 ? (
          <Typography variant="small" className="text-muted-foreground text-xs italic">
            {t('orbInspector.noTokenContract')}
          </Typography>
        ) : (
          <Box className="flex flex-col gap-1">
            {tokens.map((token) => (
              <Box key={token} className="flex items-center gap-2">
                <Typography variant="small" className="font-mono text-xs">{token}</Typography>
              </Box>
            ))}
          </Box>
        )}
      </Box>

      {/* Variant */}
      {variantEnum && variantEnum.length > 0 && (
        <Box>
          <Typography variant="small" className="text-muted-foreground text-xs uppercase tracking-wider mb-2">
            {t('orbInspector.variant')}
          </Typography>
          <Box className="flex flex-wrap gap-1">
            {variantEnum.map((variant) => {
              const isActive = variant === currentVariant || (!currentVariant && variant === 'default');
              return (
                <Box
                  key={variant}
                  as={editable ? 'button' : 'div'}
                  onClick={editable ? () => onPropChange('variant', variant) : undefined}
                  aria-pressed={editable ? isActive : undefined}
                  className={`rounded px-2 py-0.5 text-xs font-mono ${editable ? 'cursor-pointer hover:opacity-80 transition-opacity' : ''}`}
                  style={{
                    backgroundColor: isActive ? 'var(--color-primary)' : 'var(--color-muted)',
                    color: isActive ? 'var(--color-primary-foreground)' : 'var(--color-muted-foreground)',
                  }}
                >
                  {variant}
                </Box>
              );
            })}
          </Box>
        </Box>
      )}

      {/* Size */}
      {sizeEnum && sizeEnum.length > 0 && (
        <Box>
          <Typography variant="small" className="text-muted-foreground text-xs uppercase tracking-wider mb-2">
            {t('orbInspector.size')}
          </Typography>
          <Box className="flex flex-wrap gap-1">
            {sizeEnum.map((size) => {
              const isActive = size === currentSize || (!currentSize && size === 'md');
              return (
                <Box
                  key={size}
                  as={editable ? 'button' : 'div'}
                  onClick={editable ? () => onPropChange('size', size) : undefined}
                  aria-pressed={editable ? isActive : undefined}
                  className={`rounded px-2 py-0.5 text-xs font-mono ${editable ? 'cursor-pointer hover:opacity-80 transition-opacity' : ''}`}
                  style={{
                    backgroundColor: isActive ? 'var(--color-primary)' : 'var(--color-muted)',
                    color: isActive ? 'var(--color-primary-foreground)' : 'var(--color-muted-foreground)',
                  }}
                >
                  {size}
                </Box>
              );
            })}
          </Box>
        </Box>
      )}

      {editable && !isDesignSystem && (
        <AppearanceSection
          patternConfig={patternConfig}
          themeManifest={themeManifest}
          onPropChange={onPropChange}
          onTokenChange={onTokenChange}
          offsetInParent={offsetInParent}
        />
      )}

      {/* Project theme tokens (Design System tab only) — global edits. */}
      {isDesignSystem && themeManifest && editable && (
        <TokenEditorSection themeManifest={themeManifest} onTokenChange={onTokenChange} />
      )}
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Token editor (Design System tab only)
// ---------------------------------------------------------------------------

interface TokenEditorSectionProps {
  themeManifest: ThemeDefinition;
  onTokenChange: (token: InspectorTokenRef, value: string) => void;
}

/** Theme-token categories the inspector exposes for editing. */
const TOKEN_GROUPS: readonly { group: 'colors' | 'radii' | 'spacing' | 'shadows'; labelKey: string }[] = [
  { group: 'colors', labelKey: 'orbInspector.tokenGroup.colors' },
  { group: 'radii', labelKey: 'orbInspector.tokenGroup.radii' },
  { group: 'spacing', labelKey: 'orbInspector.tokenGroup.spacing' },
  { group: 'shadows', labelKey: 'orbInspector.tokenGroup.shadows' },
] as const;

function TokenEditorSection({ themeManifest, onTokenChange }: TokenEditorSectionProps): React.ReactElement {
  const { t } = useTranslate();
  const tokens = themeManifest.tokens ?? {};
  return (
    <Box className="flex flex-col gap-3 pt-2 border-t border-border/40">
      <Typography variant="small" className="text-xs uppercase tracking-wider text-muted-foreground">
        {t('orbInspector.projectThemeTokens')}
      </Typography>
      {TOKEN_GROUPS.map(({ group, labelKey }) => {
        const entries = Object.entries(tokens[group] ?? {});
        if (entries.length === 0) return null;
        return (
          <Box key={group} className="flex flex-col gap-1.5">
            <Typography variant="small" className="text-xs font-mono text-muted-foreground">{t(labelKey)}</Typography>
            {entries.map(([key, value]) => (
              <TokenRow
                key={key}
                group={group}
                tokenKey={key}
                value={String(value)}
                isColor={group === 'colors'}
                onTokenChange={onTokenChange}
              />
            ))}
          </Box>
        );
      })}
    </Box>
  );
}

interface TokenRowProps {
  group: 'colors' | 'radii' | 'spacing' | 'shadows';
  tokenKey: string;
  value: string;
  isColor: boolean;
  onTokenChange: (token: InspectorTokenRef, value: string) => void;
}

function TokenRow({ group, tokenKey, value, isColor, onTokenChange }: TokenRowProps): React.ReactElement {
  return (
    <Box className="flex items-center gap-2">
      {isColor && (
        <Box
          className="w-4 h-4 rounded border border-border/40 shrink-0"
          style={{ backgroundColor: value }}
        />
      )}
      <Typography variant="small" className="font-mono text-xs text-muted-foreground w-24 shrink-0 truncate">
        {tokenKey}
      </Typography>
      <Input
        value={value}
        onChange={(e) => onTokenChange({ group, key: tokenKey }, e.target.value)}
        className="flex-1 text-xs font-mono"
      />
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Appearance — Local (this element's classes) vs Global (the theme token)
// ---------------------------------------------------------------------------

/** A theme token an edit targets: `setToken(group, key, value)` on the host. */
export interface InspectorTokenRef {
  group: 'colors' | 'radii' | 'spacing' | 'typography' | 'shadows';
  key: string;
}

type EditScope = 'local' | 'global';

const COLOR_ROWS: readonly { utility: DesignColorUtility; labelKey: string }[] = [
  { utility: 'bg', labelKey: 'orbInspector.fill' },
  { utility: 'text', labelKey: 'orbInspector.textColor' },
  { utility: 'border', labelKey: 'orbInspector.borderColor' },
];

const SIZE_ROWS: readonly { utility: 'w' | 'h'; labelKey: string }[] = [
  { utility: 'w', labelKey: 'orbInspector.width' },
  { utility: 'h', labelKey: 'orbInspector.height' },
];

const LIMIT_ROWS: readonly { axis: 'w' | 'h'; limit: DesignSizeLimit; labelKey: string }[] = [
  { axis: 'w', limit: 'min', labelKey: 'orbInspector.minWidth' },
  { axis: 'w', limit: 'max', labelKey: 'orbInspector.maxWidth' },
  { axis: 'h', limit: 'min', labelKey: 'orbInspector.minHeight' },
  { axis: 'h', limit: 'max', labelKey: 'orbInspector.maxHeight' },
];

const CONSTRAINTS: readonly DesignConstraint[] = ['start', 'end', 'both', 'center', 'scale'];
const CONSTRAINT_LABELS = {
  x: { start: 'orbInspector.pinLeft', end: 'orbInspector.pinRight', both: 'orbInspector.pinLeftRight', center: 'orbInspector.pinCenter', scale: 'orbInspector.pinScale' },
  y: { start: 'orbInspector.pinTop', end: 'orbInspector.pinBottom', both: 'orbInspector.pinTopBottom', center: 'orbInspector.pinCenter', scale: 'orbInspector.pinScale' },
} as const;

/** The element's own classes, or null when `className` is a binding and not editable here. */
function classesOf(config: PatternNode | null): string[] | null {
  const value = config?.className;
  if (value === undefined || value === null) return [];
  return typeof value === 'string' ? value.split(/\s+/).filter(Boolean) : null;
}

/** The unprefixed class the element uses for one utility (e.g. its `bg-*`), if any. */
function classFor(classes: readonly string[], prefix: string): string | undefined {
  return classes.find((c) => !c.includes(':') && c.startsWith(prefix));
}

interface AppearanceSectionProps {
  patternConfig: PatternNode | null;
  themeManifest?: ThemeDefinition;
  onPropChange: (propName: string, value: EventPayloadValue) => void;
  onTokenChange: (token: InspectorTokenRef, value: string) => void;
  offsetInParent?: OffsetInParent;
}

function AppearanceSection({ patternConfig, themeManifest, onPropChange, onTokenChange, offsetInParent }: AppearanceSectionProps): React.ReactElement {
  const { t } = useTranslate();
  const [scope, setScope] = useState<EditScope>('local');
  const [custom, setCustom] = useState('');
  const [customRefused, setCustomRefused] = useState(false);
  const classes = classesOf(patternConfig);

  if (classes === null) {
    return (
      <Box className="flex flex-col gap-2 pt-2 border-t border-border/40" data-testid="inspector-appearance">
        <Typography variant="small" className="text-xs uppercase tracking-wider text-muted-foreground">{t('orbInspector.appearance')}</Typography>
        <Typography variant="small" className="text-xs text-muted-foreground">{t('orbInspector.classNameIsBinding')}</Typography>
      </Box>
    );
  }

  const setClass = (next: string) => onPropChange('className', cn(classes.join(' '), next));
  const tokenValue = (token: DesignClassToken): string => {
    const group = themeManifest?.tokens?.[token.group];
    return group ? String(group[token.key] ?? '') : '';
  };

  const globalEditor = (current: string | undefined) => {
    const token = current ? tokenOfDesignClass(current) : null;
    if (!token) {
      return <Typography variant="small" className="text-xs text-muted-foreground">{t('orbInspector.notThemeBacked')}</Typography>;
    }
    return (
      <Box className="flex flex-col gap-1">
        <Typography variant="small" className="text-xs text-muted-foreground">
          {t('orbInspector.globalAffects', { token: `${token.group}.${token.key}` })}
        </Typography>
        <Input
          value={tokenValue(token)}
          aria-label={`${token.group}.${token.key}`}
          onChange={(e) => onTokenChange({ group: token.group, key: token.key }, e.target.value)}
          className="text-xs font-mono"
        />
      </Box>
    );
  };

  return (
    <Box className="flex flex-col gap-3 pt-2 border-t border-border/40" data-testid="inspector-appearance">
      <Box className="flex items-center justify-between gap-2">
        <Typography variant="small" className="text-xs uppercase tracking-wider text-muted-foreground">{t('orbInspector.appearance')}</Typography>
        <Box className="flex rounded-md border border-border/60 overflow-hidden" role="group" aria-label={t('orbInspector.editScope')}>
          {(['local', 'global'] as const).map((s) => (
            <Button
              key={s}
              variant={scope === s ? 'primary' : 'ghost'}
              size="sm"
              aria-pressed={scope === s}
              data-testid={`inspector-scope-${s}`}
              onClick={() => setScope(s)}
              className="rounded-none h-6 px-2 text-xs"
            >
              {t(s === 'local' ? 'orbInspector.scopeLocal' : 'orbInspector.scopeGlobal')}
            </Button>
          ))}
        </Box>
      </Box>

      {COLOR_ROWS.map(({ utility, labelKey }) => {
        const current = classFor(classes, `${utility}-`);
        return (
          <Box key={utility} className="flex flex-col gap-1.5" data-testid={`inspector-${utility}`}>
            <Typography variant="small" className="text-xs font-mono text-muted-foreground">{t(labelKey)}</Typography>
            {scope === 'global' ? globalEditor(current) : (
              <Box className="flex flex-wrap gap-1">
                {DESIGN_COLOR_TOKENS.map((token) => {
                  const cls = `${utility}-${token}`;
                  return (
                    <Button
                      key={token}
                      variant="ghost"
                      size="sm"
                      title={cls}
                      aria-label={cls}
                      aria-pressed={current === cls}
                      onClick={() => setClass(cls)}
                      className={`w-5 h-5 p-0 min-w-0 rounded border ${current === cls ? 'ring-2 ring-primary' : 'border-border/60'}`}
                      style={{ backgroundColor: `var(--color-${token})` }}
                    />
                  );
                })}
              </Box>
            )}
          </Box>
        );
      })}

      <Box className="flex flex-col gap-1.5" data-testid="inspector-radius">
        <Typography variant="small" className="text-xs font-mono text-muted-foreground">{t('orbInspector.radius')}</Typography>
        {scope === 'global' ? globalEditor(classFor(classes, 'rounded-')) : (
          <Box className="flex flex-wrap gap-1">
            {DESIGN_RADIUS_TOKENS.map((token) => {
              const cls = `rounded-${token}`;
              const active = classFor(classes, 'rounded-') === cls;
              return (
                <Button
                  key={token}
                  variant={active ? 'primary' : 'secondary'}
                  size="sm"
                  aria-pressed={active}
                  onClick={() => setClass(cls)}
                  className="h-6 px-2 text-xs font-mono"
                >
                  {token}
                </Button>
              );
            })}
          </Box>
        )}
      </Box>

      {SIZE_ROWS.map(({ utility, labelKey }) => {
        const sizing = sizingOf(classes, utility);
        const current = sizing.mode === 'fixed' ? `${utility}-${sizing.step}` : sizing.mode;
        return (
          <Box key={utility} className="flex items-center gap-2" data-testid={`inspector-${utility}`}>
            <Typography variant="small" className="text-xs font-mono text-muted-foreground w-12 shrink-0">{t(labelKey)}</Typography>
            {scope === 'global' ? (
              globalEditor(sizing.mode === 'fixed' ? `${utility}-${sizing.step}` : undefined)
            ) : (
              <Select
                value={current}
                aria-label={t(labelKey)}
                options={[
                  { value: 'hug', label: t('orbInspector.sizingHug') },
                  { value: 'fill', label: t('orbInspector.sizingFill') },
                  ...DESIGN_SPACING_SCALE.map((step) => ({ value: `${utility}-${step}`, label: String(step) })),
                ]}
                onValueChange={(v) => {
                  if (v === 'hug' || v === 'fill') {
                    onPropChange('className', withSizing(classes, utility, { mode: v }).join(' '));
                    return;
                  }
                  const step = DESIGN_SPACING_SCALE.find((s) => `${utility}-${s}` === v);
                  if (step !== undefined) onPropChange('className', withSizing(classes, utility, { mode: 'fixed', step }).join(' '));
                }}
                className="flex-1 text-xs h-6"
              />
            )}
          </Box>
        );
      })}

      {LIMIT_ROWS.map(({ axis, limit, labelKey }) => {
        const prefix = `${limit}-${axis}-`;
        const step = sizeLimitOf(classes, axis, limit);
        const current = step !== null ? String(step) : classFor(classes, prefix) ? 'custom' : 'none';
        return (
          <Box key={prefix} className="flex items-center gap-2" data-testid={`inspector-${limit}-${axis}`}>
            <Typography variant="small" className="text-xs font-mono text-muted-foreground w-12 shrink-0">{t(labelKey)}</Typography>
            {scope === 'global' ? globalEditor(classFor(classes, prefix)) : (
              <Select
                value={current}
                aria-label={t(labelKey)}
                options={[
                  { value: 'none', label: t('orbInspector.limitNone') },
                  ...(current === 'custom' ? [{ value: 'custom', label: t('orbInspector.custom') }] : []),
                  ...DESIGN_SPACING_SCALE.map((s) => ({ value: String(s), label: String(s) })),
                ]}
                onValueChange={(v) => {
                  if (v === 'none') {
                    onPropChange('className', withSizeLimit(classes, axis, limit, null).join(' '));
                    return;
                  }
                  const next = DESIGN_SPACING_SCALE.find((s) => String(s) === v);
                  if (next !== undefined) onPropChange('className', withSizeLimit(classes, axis, limit, next).join(' '));
                }}
                className="flex-1 text-xs h-6"
              />
            )}
          </Box>
        );
      })}

      {/* Absolute position: taken out of auto layout, pinned by Figma-style constraints. */}
      {(() => {
        const position = positionOf(classes);
        const write = (next: typeof position) => onPropChange('className', withPosition(classes, next).join(' '));
        return (
          <Box className="flex flex-col gap-1.5" data-testid="inspector-position">
            {/* Pinning needs the element's measured place; leaving the flow waits for it, returning to it does not. */}
            <Switch
              checked={position.absolute}
              label={t('orbInspector.absolute')}
              disabled={!offsetInParent && !position.absolute}
              onChange={(on) => {
                if (!on) write({ ...position, absolute: false });
                else if (offsetInParent) write({ absolute: true, x: axisPositionFrom('x', 'start', offsetInParent), y: axisPositionFrom('y', 'start', offsetInParent) });
              }}
            />
            {position.absolute && (['x', 'y'] as const).map((axis) => (
              <Box key={axis} className="flex items-center gap-2" data-testid={`inspector-constraint-${axis}`}>
                <Typography variant="small" className="text-xs font-mono text-muted-foreground w-12 shrink-0">
                  {t(axis === 'x' ? 'orbInspector.constraintHorizontal' : 'orbInspector.constraintVertical')}
                </Typography>
                <Select
                  value={position[axis].constraint}
                  aria-label={t(axis === 'x' ? 'orbInspector.constraintHorizontal' : 'orbInspector.constraintVertical')}
                  options={CONSTRAINTS.map((c) => ({ value: c, label: t(CONSTRAINT_LABELS[axis][c]) }))}
                  disabled={!offsetInParent}
                  onValueChange={(v) => {
                    const constraint = CONSTRAINTS.find((c) => c === v);
                    if (constraint && offsetInParent) write({ ...position, [axis]: axisPositionFrom(axis, constraint, offsetInParent) });
                  }}
                  className="flex-1 text-xs h-6"
                />
              </Box>
            ))}
          </Box>
        );
      })()}

      {/* Custom: one arbitrary-value class (w-[243px]); the preview compiles it at runtime. */}
      <Box className="flex flex-col gap-1" data-testid="inspector-custom">
        <Typography variant="small" className="text-xs font-mono text-muted-foreground">{t('orbInspector.custom')}</Typography>
        {scope === 'global' ? (
          <Typography variant="small" className="text-xs text-muted-foreground">{t('orbInspector.notThemeBacked')}</Typography>
        ) : (
          <>
            <Input
              value={custom}
              placeholder="w-[243px]"
              aria-label={t('orbInspector.custom')}
              onChange={(e) => {
                setCustom(e.target.value);
                setCustomRefused(false);
              }}
              onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
                if (e.key !== 'Enter') return;
                const value = custom.trim();
                if (!isArbitraryClass(value)) {
                  setCustomRefused(true);
                  return;
                }
                setClass(value);
                setCustom('');
              }}
              className="text-xs font-mono"
            />
            {customRefused && (
              <Typography variant="small" className="text-xs text-error">{t('orbInspector.customRefused')}</Typography>
            )}
          </>
        )}
      </Box>

      {/* Gap and uniform padding (per-side padding is on the canvas handles). */}
      {(['gap', 'padding'] as const).map((row) => {
        const spacing = spacingOf(classes);
        const uniform = spacing.top === spacing.right && spacing.right === spacing.bottom && spacing.bottom === spacing.left;
        const current = row === 'gap' ? String(spacing.gap) : uniform ? String(spacing.top) : 'mixed';
        const tokenClass = classFor(classes, row === 'gap' ? 'gap-' : 'p-');
        const label = t(row === 'gap' ? 'orbInspector.gap' : 'orbInspector.padding');
        return (
          <Box key={row} className="flex items-center gap-2" data-testid={`inspector-${row}`}>
            <Typography variant="small" className="text-xs font-mono text-muted-foreground w-12 shrink-0">{label}</Typography>
            {scope === 'global' ? globalEditor(tokenClass) : (
              <Select
                value={current}
                aria-label={label}
                options={[
                  ...(current === 'mixed' ? [{ value: 'mixed', label: t('orbInspector.mixed') }] : []),
                  ...DESIGN_SPACING_SCALE.map((step) => ({ value: String(step), label: String(step) })),
                ]}
                onValueChange={(v) => {
                  const step = DESIGN_SPACING_SCALE.find((s) => String(s) === v);
                  if (step === undefined) return;
                  const change = row === 'gap' ? { gap: step } : { top: step, right: step, bottom: step, left: step };
                  onPropChange('className', withSpacing(classes, change).join(' '));
                }}
                className="flex-1 text-xs h-6"
              />
            )}
          </Box>
        );
      })}
    </Box>
  );
}

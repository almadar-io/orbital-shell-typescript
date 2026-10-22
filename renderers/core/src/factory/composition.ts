/**
 * L3 composition factory — a typed CompositionSpec (the entity, the blocks with their
 * declared config, a layout of stacks holding block slots, and event wiring between blocks)
 * is checked against each block's declared contract, then assembled into an orbital from the
 * existing builders. The LLM fills the spec; it never authors `.lolo`.
 */
import { makeOrbitalWithUses, makeTraitRef } from '../builders.js';
import { makeLayoutTrait, makeSlot } from '../builders/layout-trait.js';
import type { AnyPatternConfig } from '../patterns/index.js';
import { controlBody } from '../patterns/helpers/render-ui-pattern-types.js';
import type { Effect } from '../types/effect.js';
import type { SExpr } from '../types/expression.js';
import { configRefEventKnob, isCallSiteConfigDeclaration, isInlineTrait, mergeCallSiteConfigOverrides, resolveConfigRefEventName } from '../types/index.js';
import type { DeclaredTraitConfig, OrbitalDefinition, OrbitalEntity, Trait, TraitConfigValue, TraitEventListener, TraitRef, UseDeclaration } from '../types/index.js';
import type { FactoryParamValue } from './types.js';

export interface CompositionBlock {
  /** Local trait name in the composed orbital. */
  name: string;
  /** `uses` path of the behavior that owns the block (`std/behaviors/std-browse`). */
  from: string;
  /** `uses` alias. */
  as: string;
  /** The behavior's trait this block aliases. */
  trait: string;
  /** Rebind the block to an entity (only for a rebindable trait). */
  linkedEntity?: string;
  /** Call-site config, keys limited to the trait's declared knobs. */
  config?: Readonly<Record<string, FactoryParamValue>>;
}

export type CompositionLayoutNode =
  | { kind: 'block'; block: string }
  | {
      kind: 'stack';
      direction?: 'vertical' | 'horizontal';
      gap?: string;
      align?: string;
      justify?: string;
      className?: string;
      children: ReadonlyArray<CompositionLayoutNode>;
    };

export interface CompositionWire {
  fromBlock: string;
  event: string;
  toBlock: string;
  trigger: string;
}

export type CompositionEntity =
  | {
      kind: 'import';
      from: string;
      as: string;
      /** Upstream orbital that owns the entity and its rules. */
      orbital: string;
      entity: string;
      /** Upstream page path remapped onto the composition page. */
      page: string;
      only?: ReadonlyArray<string>;
    }
  | { kind: 'declare'; entity: OrbitalEntity };

export interface CompositionSpec {
  orbital: string;
  entity: CompositionEntity;
  blocks: ReadonlyArray<CompositionBlock>;
  layout: CompositionLayoutNode;
  wiring?: ReadonlyArray<CompositionWire>;
  page: { name: string; path: string };
  /** Inline traits an existing page carries, kept verbatim: placeable in the layout, never edited, never wired. */
  kept?: ReadonlyArray<Trait>;
}

/** What a block declares — read from its behavior's signature + registry trait by the caller. */
export interface CompositionBlockContract {
  configKeys: ReadonlyArray<string>;
  /** The trait's declared `config {}`; resolves `@config.<knob>` event names. */
  declaredConfig?: DeclaredTraitConfig;
  emits: ReadonlyArray<string>;
  /** Events the trait's transitions handle. */
  triggers: ReadonlyArray<string>;
  /** The trait's own listens (restated when a wire adds one: a reference's `listens` replaces the set). */
  listens: ReadonlyArray<TraitEventListener>;
  entityRebindable: boolean;
  /** Entity fields the block's own effects write (`set @entity.<field> …`). */
  setsFields?: ReadonlyArray<string>;
  /** The record a fixed-binding trait is bound to (a rebindable one takes the composition's). */
  linkedEntity?: string;
}

export interface CompositionContext {
  block(from: string, trait: string): CompositionBlockContract | null;
}

export type CompositionIssueCode =
  | 'unknown-block'
  | 'unknown-config-key'
  | 'unknown-event'
  | 'unknown-trigger'
  | 'layout-unknown-block'
  | 'unplaced-block'
  | 'not-rebindable'
  | 'duplicate-name'
  | 'alias-conflict'
  | 'unknown-wire-block'
  | 'missing-collection'
  | 'unknown-trait-ref'
  | 'entity-mismatch';

export interface CompositionIssue {
  code: CompositionIssueCode;
  path: string;
  message: string;
}

export interface ResolvedBlockContract {
  contract: CompositionBlockContract;
  /** `@config.<knob>` event names with no value at this call site (dropped from the contract). */
  unresolved: string[];
}

function eventNamer(
  contract: CompositionBlockContract,
  config: Readonly<Record<string, FactoryParamValue>> | undefined,
): (event: string) => string | undefined {
  const effective: Record<string, TraitConfigValue> = {};
  for (const [knob, field] of Object.entries(contract.declaredConfig ?? {})) {
    const override = config?.[knob];
    if (typeof override === 'string') effective[knob] = override;
    else if (field.default !== undefined) effective[knob] = field.default;
  }
  return (event) => {
    if (configRefEventKnob(event) === undefined) return event;
    const r = resolveConfigRefEventName(event, contract.declaredConfig, effective);
    return r.ok ? r.value : undefined;
  };
}

/**
 * The name an event (or trigger) takes under `toConfig`, given its name under `fromConfig`: the
 * declared `@config.<knob>` that produced it is resolved again, so a knob rename carries the wire.
 */
export function followEventName(
  contract: CompositionBlockContract,
  side: 'emits' | 'triggers',
  name: string,
  fromConfig: Readonly<Record<string, FactoryParamValue>> | undefined,
  toConfig: Readonly<Record<string, FactoryParamValue>> | undefined,
): { ok: true; value: string } | { ok: false; message: string } {
  const before = eventNamer(contract, fromConfig);
  const after = eventNamer(contract, toConfig);
  const sources = contract[side].filter((e) => before(e) === name);
  if (sources.length === 0) return { ok: true, value: name };
  const values = [...new Set(sources.flatMap((e) => after(e) ?? []))];
  if (values.length > 1) return { ok: false, message: `${name} comes from ${sources.join(', ')}, which this block names differently (${values.join(', ')}) — wire one of those names` };
  return { ok: true, value: values[0]! };
}

/** A block's contract with every `@config.<knob>` event name resolved against its call-site config (folded over the declared defaults). */
export function resolveBlockContract(
  contract: CompositionBlockContract,
  config: Readonly<Record<string, FactoryParamValue>> | undefined,
): ResolvedBlockContract {
  const unresolved: string[] = [];
  const named = eventNamer(contract, config);
  const resolve = (event: string): string | undefined => {
    const v = named(event);
    if (v === undefined && !unresolved.includes(event)) unresolved.push(event);
    return v;
  };
  const names = (events: ReadonlyArray<string>): string[] =>
    events.flatMap((e) => {
      const v = resolve(e);
      return v === undefined ? [] : [v];
    });
  const listens = contract.listens.flatMap((l): TraitEventListener[] => {
    const event = resolve(l.event);
    const triggers = resolve(l.triggers);
    return event === undefined || triggers === undefined ? [] : [{ ...l, event, triggers }];
  });
  return { contract: { ...contract, emits: names(contract.emits), triggers: names(contract.triggers), listens }, unresolved };
}

/** Whether a block can sit on a page about `record`: rebindable, unbound, or fixed to that record. */
export function bindsRecord(contract: CompositionBlockContract, record: string): boolean {
  return contract.entityRebindable || contract.linkedEntity === undefined || contract.linkedEntity === record;
}

function placedBlocks(node: CompositionLayoutNode, out: string[]): void {
  if (node.kind === 'block') out.push(node.block);
  else for (const child of node.children) placedBlocks(child, out);
}

export function checkComposition(spec: CompositionSpec, ctx: CompositionContext): CompositionIssue[] {
  const issues: CompositionIssue[] = [];
  if (spec.entity.kind === 'declare' && spec.entity.entity.persistence === 'persistent' && !spec.entity.entity.collection) {
    issues.push({ code: 'missing-collection', path: 'entity.collection', message: `persistent entity ${spec.entity.entity.name} declares no collection` });
  }
  const contracts = new Map<string, CompositionBlockContract>();
  const names = new Set<string>();
  const aliases = new Map<string, string>();
  if (spec.entity.kind === 'import') aliases.set(spec.entity.as, spec.entity.from);
  for (const b of spec.blocks) {
    const at = `blocks.${b.name}`;
    if (names.has(b.name)) issues.push({ code: 'duplicate-name', path: at, message: `two blocks are named "${b.name}"` });
    names.add(b.name);
    const prior = aliases.get(b.as);
    if (prior !== undefined && prior !== b.from) {
      issues.push({ code: 'alias-conflict', path: `${at}.as`, message: `alias "${b.as}" already names ${prior}` });
    }
    aliases.set(b.as, b.from);
    const contract = ctx.block(b.from, b.trait);
    if (contract === null) {
      issues.push({ code: 'unknown-block', path: at, message: `${b.from} declares no trait ${b.trait}` });
      continue;
    }
    contracts.set(b.name, resolveBlockContract(contract, b.config).contract);
    for (const key of Object.keys(b.config ?? {})) {
      if (!contract.configKeys.includes(key)) {
        issues.push({ code: 'unknown-config-key', path: `${at}.config.${key}`, message: `${b.trait} declares no knob "${key}" (declares: ${contract.configKeys.join(', ')})` });
      }
    }
    const recordName = spec.entity.kind === 'import' ? spec.entity.entity : spec.entity.entity.name;
    if (!bindsRecord(contract, recordName)) {
      issues.push({
        code: 'entity-mismatch',
        path: at,
        message: `${b.trait} is bound to the record "${contract.linkedEntity}" and cannot be rebound — name this page's record "${contract.linkedEntity}" or use another part`,
      });
    }
    if (b.linkedEntity !== undefined && !contract.entityRebindable) {
      issues.push({ code: 'not-rebindable', path: `${at}.linkedEntity`, message: `${b.trait} has a fixed entity binding` });
    }
  }
  for (const b of spec.blocks) {
    const declared = ctx.block(b.from, b.trait)?.declaredConfig ?? {};
    for (const [key, value] of Object.entries(b.config ?? {})) {
      if (declared[key]?.type !== 'trait' || typeof value !== 'string') continue;
      const target = value.startsWith('@trait.') ? value.slice('@trait.'.length) : undefined;
      if (target === undefined || !names.has(target)) {
        issues.push({
          code: 'unknown-trait-ref',
          path: `blocks.${b.name}.config.${key}`,
          message: `${key} must be "@trait.<block>" naming a block of this composition (${[...names].join(', ')}), got "${value}"`,
        });
      }
    }
  }
  const keptNames = new Set<string>();
  for (const k of spec.kept ?? []) {
    if (names.has(k.name) || keptNames.has(k.name)) issues.push({ code: 'duplicate-name', path: `kept.${k.name}`, message: `two parts are named "${k.name}"` });
    keptNames.add(k.name);
  }
  const placed: string[] = [];
  placedBlocks(spec.layout, placed);
  for (const p of placed) {
    if (!names.has(p) && !keptNames.has(p)) issues.push({ code: 'layout-unknown-block', path: `layout.${p}`, message: `the layout places "${p}", which is not a block` });
  }
  // A block another block renders through a trait slot (`@trait.<name>` in its config) is placed there.
  const slotted = new Set<string>();
  const collectSlots = (v: FactoryParamValue): void => {
    if (typeof v === 'string') {
      if (v.startsWith('@trait.')) slotted.add(v.slice('@trait.'.length));
    } else if (Array.isArray(v)) {
      for (const x of v) collectSlots(x);
    } else if (typeof v === 'object' && v !== null) {
      for (const x of Object.values(v)) collectSlots(x);
    }
  };
  for (const b of spec.blocks) for (const v of Object.values(b.config ?? {})) collectSlots(v);
  for (const b of spec.blocks) {
    if (!placed.includes(b.name) && !slotted.has(b.name)) issues.push({ code: 'unplaced-block', path: `blocks.${b.name}`, message: `"${b.name}" is not placed in the layout` });
  }
  for (const [i, w] of (spec.wiring ?? []).entries()) {
    const at = `wiring.${i}`;
    const src = contracts.get(w.fromBlock);
    const dst = contracts.get(w.toBlock);
    if (!names.has(w.fromBlock) || !names.has(w.toBlock)) {
      issues.push({ code: 'unknown-wire-block', path: at, message: `wire ${w.fromBlock} → ${w.toBlock} names a missing block` });
      continue;
    }
    if (src !== undefined && !src.emits.includes(w.event)) {
      issues.push({ code: 'unknown-event', path: `${at}.event`, message: `${w.fromBlock} does not emit ${w.event} (emits: ${src.emits.join(', ')})` });
    }
    if (dst !== undefined && !dst.triggers.includes(w.trigger)) {
      issues.push({ code: 'unknown-trigger', path: `${at}.trigger`, message: `${w.toBlock} handles no ${w.trigger} (handles: ${dst.triggers.join(', ')})` });
    }
  }
  return issues;
}

function layoutTree(node: CompositionLayoutNode): AnyPatternConfig | string {
  if (node.kind === 'block') return makeSlot(node.block);
  return {
    type: 'stack',
    ...(node.direction !== undefined ? { direction: node.direction } : {}),
    ...(node.gap !== undefined ? { gap: node.gap } : {}),
    ...(node.align !== undefined ? { align: node.align } : {}),
    ...(node.justify !== undefined ? { justify: node.justify } : {}),
    ...(node.className !== undefined ? { className: node.className } : {}),
    children: node.children.map(layoutTree),
  };
}

function entityName(e: CompositionEntity): string {
  return e.kind === 'import' ? e.entity : e.entity.name;
}

export type CompositionResult = { ok: true; orbital: OrbitalDefinition } | { ok: false; issues: CompositionIssue[] };

export function assembleComposition(spec: CompositionSpec, ctx: CompositionContext): CompositionResult {
  const issues = checkComposition(spec, ctx);
  if (issues.length > 0) return { ok: false, issues };
  const entity = entityName(spec.entity);
  const uses: UseDeclaration[] = [];
  const seen = new Set<string>();
  const addUse = (from: string, as: string): void => {
    if (seen.has(as)) return;
    seen.add(as);
    uses.push({ from, as });
  };
  if (spec.entity.kind === 'import') addUse(spec.entity.from, spec.entity.as);
  for (const b of spec.blocks) addUse(b.from, b.as);

  const root = layoutTree(spec.layout);
  const viewName = `${spec.orbital}View`;
  const view = makeLayoutTrait({
    name: viewName,
    linkedEntity: entity,
    renderUI: typeof root === 'string' ? { type: 'stack', children: [root] } : root,
  });

  const blockTraits: TraitRef[] = spec.blocks.map((b) => {
    const declared = ctx.block(b.from, b.trait);
    const contract = declared !== null ? resolveBlockContract(declared, b.config).contract : null;
    const wires = (spec.wiring ?? []).filter((w) => w.toBlock === b.name);
    const listens: TraitEventListener[] | undefined =
      wires.length > 0 && contract !== null
        ? [
            ...contract.listens,
            ...wires.map((w): TraitEventListener => ({ event: w.event, triggers: w.trigger, source: { kind: 'trait', trait: w.fromBlock } })),
          ]
        : undefined;
    const rebind = b.linkedEntity ?? (contract?.entityRebindable === true ? entity : undefined);
    return makeTraitRef({
      ref: `${b.as}.traits.${b.trait}`,
      name: b.name,
      ...(rebind !== undefined ? { linkedEntity: rebind } : {}),
      ...(b.config !== undefined
        ? { config: mergeCallSiteConfigOverrides({}, b.config) }
        : {}),
      ...(listens !== undefined ? { listens } : {}),
    });
  });

  if (spec.entity.kind === 'import') {
    const e = spec.entity;
    const orbital: OrbitalDefinition = {
      ...makeOrbitalWithUses({ name: spec.orbital, uses, entity: `${e.as}.orbitals.${e.orbital}.entity`, traits: [view, ...blockTraits, ...(spec.kept ?? [])] }),
      reference: {
        ref: `${e.as}.orbitals.${e.orbital}`,
        entity: e.entity,
        ...(e.only !== undefined ? { only: [...e.only] } : {}),
        pages: { [e.page]: spec.page.path },
        mounts: { [e.page]: [viewName] },
      },
    };
    return { ok: true, orbital };
  }
  return {
    ok: true,
    orbital: makeOrbitalWithUses({
      name: spec.orbital,
      uses,
      entity: spec.entity.entity,
      traits: [view, ...blockTraits, ...(spec.kept ?? [])],
      pages: [{ name: spec.page.name, path: spec.page.path, traits: [{ ref: viewName }] }],
    }),
  };
}

/** A block's contract, read off the atom's own registry trait. */
/** `orbitalEntity`: the primary record of the orbital declaring `trait` — what a trait with no `->` binds. */
export function blockContractOf(trait: Trait, orbitalEntity?: string): CompositionBlockContract {
  const triggers: string[] = [];
  for (const t of trait.stateMachine?.transitions ?? []) if (!triggers.includes(t.event)) triggers.push(t.event);
  const sets = new Set<string>();
  const visitEffect = (effect: Effect | SExpr): void => {
    if (!Array.isArray(effect)) return;
    if (effect[0] === 'set' && typeof effect[1] === 'string' && effect[1].startsWith('@entity.')) {
      const field = effect[1].slice('@entity.'.length).split('.')[0];
      if (field !== undefined && field.length > 0) sets.add(field);
    }
    for (const child of controlBody(effect)) visitEffect(child);
  };
  for (const t of trait.stateMachine?.transitions ?? []) for (const e of t.effects ?? []) visitEffect(e);
  const linkedEntity = trait.linkedEntity ?? orbitalEntity;
  return {
    configKeys: Object.keys(trait.config ?? {}),
    ...(trait.config !== undefined ? { declaredConfig: trait.config } : {}),
    emits: (trait.emits ?? []).map((e) => e.event),
    triggers,
    listens: trait.listens ?? [],
    entityRebindable: trait.entityRebindable === true,
    setsFields: [...sets],
    ...(linkedEntity !== undefined ? { linkedEntity } : {}),
  };
}

function toParamValue(value: TraitConfigValue | undefined): FactoryParamValue | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) {
    const out: FactoryParamValue[] = [];
    for (const v of value) {
      const p = toParamValue(v);
      if (p !== undefined) out.push(p);
    }
    return out;
  }
  if (typeof value === 'object') {
    const out: Record<string, FactoryParamValue> = {};
    for (const [k, v] of Object.entries(value)) {
      const p = toParamValue(v);
      if (p !== undefined) out[k] = p;
    }
    return out;
  }
  return undefined;
}

/**
 * An organism orbital broken into its parts: every trait reference whose alias the orbital
 * `uses` (aliases and lowered inline embeds alike) as a ready block, call-site config unwrapped.
 */
export function decomposeOrbital(orbital: OrbitalDefinition): CompositionBlock[] {
  const fromOf = new Map((orbital.uses ?? []).map((u) => [u.as, u.from]));
  const blocks: CompositionBlock[] = [];
  for (const t of orbital.traits) {
    if (typeof t === 'string' || isInlineTrait(t)) continue;
    const m = /^([A-Za-z_]\w*)\.traits\.([A-Za-z_]\w*)$/.exec(t.ref);
    if (m === null) continue;
    const from = fromOf.get(m[1]!);
    if (from === undefined) continue;
    const config: Record<string, FactoryParamValue> = {};
    for (const [key, entry] of Object.entries(t.config ?? {})) {
      const value = toParamValue(isCallSiteConfigDeclaration(entry) ? entry.default : entry);
      if (value !== undefined) config[key] = value;
    }
    blocks.push({
      name: t.name ?? m[2]!,
      from,
      as: m[1]!,
      trait: m[2]!,
      ...(t.linkedEntity !== undefined ? { linkedEntity: t.linkedEntity } : {}),
      ...(Object.keys(config).length > 0 ? { config } : {}),
    });
  }
  return blocks;
}

type TraitRefObject = Extract<TraitRef, { ref: string }>;

function isTraitRefObject(t: TraitRef): t is TraitRefObject {
  return typeof t !== 'string' && !isInlineTrait(t) && 'ref' in t;
}

function refListens(t: TraitRefObject): ReadonlyArray<TraitEventListener> {
  return t.listens ?? [];
}

export type CompositionSpecOfResult = { ok: true; spec: CompositionSpec } | { ok: false; reason: string };

function sameListen(a: TraitEventListener, b: TraitEventListener): boolean {
  const src = (l: TraitEventListener): string => (l.source?.kind === 'trait' ? `trait:${l.source.trait}` : JSON.stringify(l.source ?? null));
  return a.event === b.event && a.triggers === b.triggers && src(a) === src(b);
}

/**
 * A page built from trait references, read back as the composition it is: its blocks (the app
 * chrome left out — composition wraps the page itself), the page's trait order as the layout,
 * listens beyond a block's own contract as wiring, its entity and its page. A page carrying an
 * inline trait is no composition of blocks and is refused with the reason.
 */
export function compositionSpecOf(
  orbital: OrbitalDefinition,
  ctx: CompositionContext,
  chromeRefs: ReadonlySet<string>,
): CompositionSpecOfResult {
  const kept: Trait[] = [];
  for (const t of orbital.traits) {
    if (typeof t === 'string') return { ok: false, reason: `trait "${t}" is a bare name, not a block reference` };
    if (isInlineTrait(t)) kept.push(t);
  }
  const refs = orbital.traits.filter(isTraitRefObject);
  const chromeNames = new Set(refs.filter((t) => chromeRefs.has(t.ref)).map((t) => t.name ?? t.ref));
  const blocks = decomposeOrbital(orbital).filter((b) => !chromeRefs.has(`${b.as}.traits.${b.trait}`));
  if (blocks.length !== refs.length - chromeNames.size) {
    return { ok: false, reason: 'a trait reference names no `uses` alias' };
  }
  const names = new Set(blocks.map((b) => b.name));
  const wiring: CompositionWire[] = [];
  for (const block of blocks) {
    const ref = refs.find((t) => (t.name ?? '') === block.name || (t.name === undefined && t.ref.endsWith(`.traits.${block.name}`)));
    const contract = ctx.block(block.from, block.trait);
    const own = contract !== null ? resolveBlockContract(contract, block.config).contract.listens : [];
    const listens = ref !== undefined ? refListens(ref) : [];
    for (const l of listens) {
      if (l.source?.kind !== 'trait' || !names.has(l.source.trait) || own.some((o) => sameListen(o, l))) continue;
      wiring.push({ fromBlock: l.source.trait, event: l.event, toBlock: block.name, trigger: l.triggers });
    }
  }
  let entity: CompositionEntity;
  let page: { name: string; path: string };
  let order: string[];
  if (typeof orbital.entity === 'object' && !('extends' in orbital.entity)) {
    entity = { kind: 'declare', entity: orbital.entity };
    const first = (orbital.pages ?? []).find((p) => typeof p !== 'string' && !('ref' in p) && typeof p.path === 'string');
    if (first === undefined || typeof first === 'string' || 'ref' in first) return { ok: false, reason: 'the orbital has no inline page' };
    page = { name: first.name, path: first.path };
    order = (first.traits ?? []).flatMap((t) => (typeof t === 'string' ? [t] : 'ref' in t && typeof t.ref === 'string' ? [t.ref] : []));
  } else {
    const reference = orbital.reference;
    const m = reference !== undefined ? /^([A-Za-z_]\w*)\.orbitals\.([A-Za-z_]\w*)$/.exec(reference.ref) : null;
    const from = m !== null ? (orbital.uses ?? []).find((u) => u.as === m[1])?.from : undefined;
    const mounted = Object.entries(reference?.mounts ?? {})[0];
    if (reference === undefined || m === null || from === undefined || reference.entity === undefined || mounted === undefined) {
      return { ok: false, reason: 'the orbital neither declares its entity nor imports one with a mounted page' };
    }
    const [upstream, traits] = mounted;
    entity = { kind: 'import', from, as: m[1]!, orbital: m[2]!, entity: reference.entity, page: upstream, ...(reference.only !== undefined ? { only: [...reference.only] } : {}) };
    page = { name: `${orbital.name}Page`, path: reference.pages?.[upstream] ?? upstream };
    order = [...traits];
  }
  const keptNames = new Set(kept.map((k) => k.name));
  const placed = order.filter((n) => names.has(n) || keptNames.has(n));
  for (const b of blocks) if (!placed.includes(b.name)) placed.push(b.name);
  return {
    ok: true,
    spec: {
      orbital: orbital.name,
      entity,
      blocks,
      layout: { kind: 'stack', direction: 'vertical', children: placed.map((block) => ({ kind: 'block', block })) },
      wiring,
      page,
      ...(kept.length > 0 ? { kept } : {}),
    },
  };
}

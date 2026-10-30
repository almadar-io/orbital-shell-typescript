/**
 * Embedded-trait facts the render substrate (`@almadar/ui`) reads: which traits
 * embed which (`@trait.X`), which knobs a trait forwards (`@config.X`), and
 * which children read their embedder's `@callsitePayload`. Resolving a trait's
 * config is the kernel's (`traitConfig`), never done here.
 *
 * @packageDocumentation
 */
import type { ConfigFieldDeclaration, DeclaredTraitConfig, OrbitalDefinition, OrbitalSchema, RuntimeValue, SExpr, Trait, TraitConfig, TraitConfigValue, TraitRef } from './types/index.js';
import { isCallSiteConfigDeclaration } from './types/index.js';

const TRAIT_BINDING_PREFIX = '@trait.';
const CONFIG_FORWARD_RE = /^@config\.([A-Za-z_][A-Za-z0-9_]*)$/;
/**
 * Call-site payload capture grammar. Mirrors the Rust orbital-core
 * `CALLSITE_PAYLOAD_PREFIX` (`orbital-core/src/schema/types.rs`) — a
 * JSX-hoisted inline child trait's config value of this form is a snapshot
 * of the COMPOSING transition's triggering event payload, resolved against
 * the `callsitePayload` core binding root (`@almadar/evaluator`,
 * `@almadar/core`'s `CORE_BINDINGS`).
 */
const CALLSITE_PAYLOAD_PREFIX = '@callsitePayload.';

/** True when any string leaf in `value`'s tree starts with `prefix`. Same
 *  recursive shape as `collectTraitRefsFromValue`, generalized to a plain
 *  prefix test instead of a name-collecting Set — no regex, no heuristics
 *  on unrelated text. */
function valueContainsPrefixedString(value: RuntimeValue, prefix: string): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.startsWith(prefix);
  if (Array.isArray(value)) return value.some((item) => valueContainsPrefixedString(item, prefix));
  if (typeof value === 'object') {
    return Object.values(value as Record<string, RuntimeValue>).some((v) => valueContainsPrefixedString(v, prefix));
  }
  return false;
}

function collectTraitRefsFromValue(value: RuntimeValue, into: Set<string>): void {
  if (value === null || value === undefined) return;
  if (typeof value === 'string') {
    if (value.startsWith(TRAIT_BINDING_PREFIX)) {
      const rest = value.slice(TRAIT_BINDING_PREFIX.length);
      const dot = rest.indexOf('.');
      const traitName = dot === -1 ? rest : rest.slice(0, dot);
      if (traitName.length > 0) into.add(traitName);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectTraitRefsFromValue(item, into);
    return;
  }
  if (typeof value === 'object') {
    for (const v of Object.values(value as Record<string, RuntimeValue>)) {
      collectTraitRefsFromValue(v, into);
    }
  }
}

const CONFIG_BINDING_PREFIX = '@config.';

function collectConfigKeysFromValue(value: RuntimeValue, into: Set<string>): void {
  if (value === null || value === undefined) return;
  if (typeof value === 'string') {
    if (value.startsWith(CONFIG_BINDING_PREFIX)) {
      const key = value.slice(CONFIG_BINDING_PREFIX.length).split('.')[0];
      if (key.length > 0) into.add(key);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectConfigKeysFromValue(item, into);
    return;
  }
  if (typeof value === 'object') {
    for (const v of Object.values(value as Record<string, RuntimeValue>)) collectConfigKeysFromValue(v, into);
  }
}

/**
 * The `@trait.X` children some fired effects compose — directly, or through a
 * `@config.K` they render whose value (on `trait`) holds `@trait.X`.
 */
export function traitsEmbeddedByEffects(trait: Trait, effects: RuntimeValue): ReadonlySet<string> {
  const refs = new Set<string>();
  const configKeys = new Set<string>();
  collectTraitRefsFromValue(effects, refs);
  collectConfigKeysFromValue(effects, configKeys);
  const config = trait.config as Record<string, RuntimeValue> | undefined;
  if (config) for (const key of configKeys) collectTraitRefsFromValue(config[key] ?? null, refs);
  refs.delete(trait.name);
  return refs;
}

/**
 * The `@trait.X` children a trait's transitions on `eventKey` compose (see
 * {@link traitsEmbeddedByEffects}). Every arm of the event counts: which guarded
 * arm fires is decided at runtime.
 */
export function traitsEmbeddedByEvent(trait: Trait, eventKey: string): ReadonlySet<string> {
  const transitions = (trait.stateMachine as { transitions?: Array<{ event?: string; effects?: RuntimeValue }> } | undefined)?.transitions ?? [];
  const out = new Set<string>();
  for (const transition of transitions) {
    if (transition.event !== eventKey) continue;
    for (const child of traitsEmbeddedByEffects(trait, transition.effects ?? null)) out.add(child);
  }
  return out;
}

/** Resolve a `TraitRef` entry to its target `Trait` — unwraps the runtime
 *  resolver's `{ ref, config, _resolved }` wrapper when present; otherwise
 *  the entry is already a plain inline `Trait` (the compiled path's shape). */
function targetTraitOf(traitRef: TraitRef): Trait | undefined {
  if (!traitRef || typeof traitRef !== 'object') return undefined;
  const resolved = (traitRef as TraitRef & { _resolved?: Trait })._resolved;
  return (resolved && typeof resolved === 'object') ? resolved : (traitRef as Trait);
}

/**
 * Per-orbital referrer → embedded-children adjacency: for every trait in the
 * orbital, the set of trait names it embeds via `@trait.X` (config OR state
 * machine — same scan as `collectEmbeddedTraitReferrers`, but keeping EVERY
 * edge instead of first-referrer-wins, and scoped to one orbital so
 * same-named traits in sibling orbitals never alias). This is the static
 * mirror of the client's page-binding pull (`OrbPreview.allPageTraits`):
 * page-declared traits plus this adjacency's transitive closure is the set
 * of traits that get a state machine on the client.
 */
export function collectTraitEmbedAdjacency(
  orbital: OrbitalDefinition,
): ReadonlyMap<string, ReadonlySet<string>> {
  const out = new Map<string, ReadonlySet<string>>();
  const traits: TraitRef[] = orbital.traits;
  if (!Array.isArray(traits)) return out;
  for (const traitRef of traits) {
    const target = targetTraitOf(traitRef);
    if (!target) continue;
    const referrerName = target.name;
    if (typeof referrerName !== 'string' || referrerName.length === 0) continue;
    const refs = new Set<string>();
    if (target.config) collectTraitRefsFromValue(target.config, refs);
    const stateMachine = (target as { stateMachine?: SExpr }).stateMachine;
    if (stateMachine) collectTraitRefsFromValue(stateMachine, refs);
    refs.delete(referrerName);
    if (refs.size > 0) out.set(referrerName, refs);
  }
  return out;
}

/**
 * Config-slot-only sibling of `collectTraitEmbedAdjacency`: edges formed by
 * `@trait.X` references in trait CONFIG values (`contentTrait`, `idleContent`,
 * body-content trees) but NOT in state machines. This is the "content
 * channel" — which trait the page's composed tree designated as its content —
 * used by the wiring lint to distinguish a claimed content body from chrome
 * that merely renders into the same slot.
 */
export function collectTraitConfigRefAdjacency(
  orbital: OrbitalDefinition,
): ReadonlyMap<string, ReadonlySet<string>> {
  const out = new Map<string, ReadonlySet<string>>();
  const traits: TraitRef[] = orbital.traits;
  if (!Array.isArray(traits)) return out;
  for (const traitRef of traits) {
    const target = targetTraitOf(traitRef);
    if (!target) continue;
    const referrerName = target.name;
    if (typeof referrerName !== 'string' || referrerName.length === 0) continue;
    if (!target.config) continue;
    const refs = new Set<string>();
    collectTraitRefsFromValue(target.config, refs);
    refs.delete(referrerName);
    if (refs.size > 0) out.set(referrerName, refs);
  }
  return out;
}

/**
 * True when a trait's own config declares at least one `@config.<key>` forward
 * — i.e. part of what it renders is decided by whoever embeds it, resolved by
 * {@link buildResolvedTraitConfigs} against that single referrer. A nested
 * token naming one of the trait's own knobs is the trait reading itself, not a
 * forward. Traits with no forward render identically regardless of embedder, which is what
 * separates an inert shared chrome trait (one `Divider` embedded from two
 * states) from a genuinely embedder-dependent one.
 */
export function traitDeclaresConfigForward(trait: Trait | undefined | null): boolean {
  const config = trait?.config;
  if (!config) return false;
  let found = false;
  const walk = (value: RuntimeValue): void => {
    if (found || value === null || value === undefined) return;
    if (typeof value === 'string') {
      const knob = CONFIG_FORWARD_RE.exec(value)?.[1];
      if (knob !== undefined && !(knob in config)) found = true;
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) walk(item);
      return;
    }
    if (typeof value === 'object') {
      for (const v of Object.values(value as Record<string, RuntimeValue>)) walk(v);
    }
  };
  for (const field of Object.values(config)) {
    const value = (field as { default?: SExpr })?.default;
    // A whole-default forward publishes the knob from the embedder, even under its own name.
    if (typeof value === 'string') {
      if (CONFIG_FORWARD_RE.test(value)) return true;
      continue;
    }
    walk(value);
    if (found) return true;
  }
  return false;
}

/**
 * True when `trait`'s own config (any nested value, including each field's
 * `.default`) or state machine literally contains a `@callsitePayload.<field>`
 * capture — the JSX-hoisted-child grammar. Scans both, mirroring
 * `collectTraitEmbedAdjacency`'s scan: a molecule can carry the capture in a
 * config default (`content: @callsitePayload.error`) or directly inside a
 * transition's `render-ui` effect args.
 *
 * Used by {@link collectCallsiteCaptureChildren} to find which embedded
 * children need their lifecycle transition re-run under their embedder's
 * payload whenever the embedder's own transition fires (`@almadar/runtime`'s
 * `OrbitalServerRuntime.executeEffects`, `@almadar/ui`'s
 * `useTraitStateMachine`).
 */
/** A trait config (declared defaults merged with a call-site override) that reads `@callsitePayload`. */
export function configReferencesCallsitePayload(config: TraitConfig | undefined): boolean {
  return config !== undefined && valueContainsPrefixedString(config as RuntimeValue, CALLSITE_PAYLOAD_PREFIX);
}

export function traitReferencesCallsitePayload(trait: Trait | undefined | null): boolean {
  if (!trait) return false;
  if (trait.config && valueContainsPrefixedString(trait.config as RuntimeValue, CALLSITE_PAYLOAD_PREFIX)) {
    return true;
  }
  const stateMachine = (trait as { stateMachine?: SExpr }).stateMachine;
  if (stateMachine && valueContainsPrefixedString(stateMachine, CALLSITE_PAYLOAD_PREFIX)) {
    return true;
  }
  return false;
}

/**
 * Per-orbital referrer → embedded-children adjacency, filtered down to
 * children whose subtree needs to be re-rendered under the referrer's
 * payload: a direct child that itself references `@callsitePayload` (see
 * {@link traitReferencesCallsitePayload}), OR a direct child that is a
 * pass-through to a capture-bearing descendant somewhere below it (a
 * grandchild's capture resolves UP the embed chain to the nearest host
 * transition that actually has a payload — mirrors
 * `orbital-compiler/src/phases/validation/binding.rs`'s
 * `validate_callsite_payload_captures`, which validates the same capture up
 * the embed chain on the compiled path).
 *
 * The caller re-renders level by level: after a trait's transition fires
 * with payload `P`, look up its direct children here, re-run each child's
 * lifecycle transition with `callsitePayload: P`, then recurse into that
 * child's own entry in this same map (still with `P`) for grandchildren —
 * so a non-capturing intermediate trait is walked through (to reach the
 * capturing descendant) without itself needing a payload-dependent redraw.
 */
export function collectCallsiteCaptureChildren(
  orbital: OrbitalDefinition,
): ReadonlyMap<string, ReadonlySet<string>> {
  const adjacency = collectTraitEmbedAdjacency(orbital);
  const traitsByName = new Map<string, Trait>();
  const traits: TraitRef[] = orbital.traits;
  if (Array.isArray(traits)) {
    for (const traitRef of traits) {
      const target = targetTraitOf(traitRef);
      if (target?.name) traitsByName.set(target.name, target);
    }
  }

  // Memoized "does this trait's own capture, or any descendant reachable
  // through `adjacency`, capture?" — a cycle guard (`seen`) protects against
  // a malformed embed graph looping back on itself; embeds don't legitimately
  // cycle, so this is defensive, not load-bearing.
  const reachesCapture = new Map<string, boolean>();
  function traitReachesCapture(name: string, seen: Set<string>): boolean {
    const cached = reachesCapture.get(name);
    if (cached !== undefined) return cached;
    if (seen.has(name)) return false;
    seen.add(name);
    const trait = traitsByName.get(name);
    if (trait && traitReferencesCallsitePayload(trait)) {
      reachesCapture.set(name, true);
      return true;
    }
    const children = adjacency.get(name);
    if (children) {
      for (const child of children) {
        if (traitReachesCapture(child, seen)) {
          reachesCapture.set(name, true);
          return true;
        }
      }
    }
    reachesCapture.set(name, false);
    return false;
  }

  const out = new Map<string, ReadonlySet<string>>();
  for (const [referrer, children] of adjacency) {
    const keep = new Set<string>();
    for (const child of children) {
      if (traitReachesCapture(child, new Set())) keep.add(child);
    }
    if (keep.size > 0) out.set(referrer, keep);
  }
  return out;
}

/**
 * Every `@config.<knob>` token a declared config entry carries: its whole
 * `default`, any token nested in it (`metrics[].target`), and the provenance
 * of forwards a resolver already folded (`forwardedFrom`,
 * `nestedForwardedFrom`). Twin of `orbital_config.rs` `field_forward_tokens`.
 */
export function configForwardTokens(entry: ConfigFieldDeclaration): string[] {
  const tokens: string[] = [];
  const walk = (value: TraitConfigValue | undefined): void => {
    if (typeof value === 'string') {
      if (value.startsWith('@config.')) tokens.push(value);
    } else if (Array.isArray(value)) {
      for (const item of value) walk(item);
    } else if (value !== null && typeof value === 'object') {
      for (const item of Object.values(value)) walk(item);
    }
  };
  walk(entry.default);
  if (entry.forwardedFrom !== undefined) tokens.push(entry.forwardedFrom);
  tokens.push(...(entry.nestedForwardedFrom ?? []));
  return tokens;
}

/**
 * The organism-scope knobs `traits` forward: every declared call-site config
 * entry whose `default` or `forwardedFrom` is a bare `@config.<knob>`. An app
 * stored one `.orb` per orbital keeps exactly these knobs of the organism's
 * `config` in each file (an unforwarded one is `ORB_O_CONFIG_DEAD_KNOB`).
 */
export function collectForwardedConfigKeys(traits: ReadonlyArray<TraitRef>): ReadonlySet<string> {
  const forwarded = new Set<string>();
  for (const traitRef of traits) {
    const config = typeof traitRef === 'string' ? undefined : traitRef.config;
    if (!config) continue;
    for (const entry of Object.values(config)) {
      if (!isCallSiteConfigDeclaration(entry)) continue;
      for (const token of configForwardTokens(entry)) {
        const knob = CONFIG_FORWARD_RE.exec(token)?.[1];
        if (knob) forwarded.add(knob);
      }
    }
  }
  return forwarded;
}

/** The organism-scope knobs an orbital forwards: its traits' forwards plus its `uses` entries' config forwards (an import forwarding the app's config). */
export function collectOrbitalForwardedConfigKeys(orbital: Pick<OrbitalDefinition, 'traits' | 'uses'>): ReadonlySet<string> {
  const forwarded = new Set(collectForwardedConfigKeys(orbital.traits ?? []));
  for (const use of orbital.uses ?? []) {
    for (const entry of Object.values(use.config ?? {})) {
      for (const token of configForwardTokens(entry)) {
        const knob = CONFIG_FORWARD_RE.exec(token)?.[1];
        if (knob) forwarded.add(knob);
      }
    }
  }
  return forwarded;
}

/** `config` narrowed to `forwarded`; undefined when none of its knobs is forwarded. */
export function filterConfigToForwardedKeys(
  config: DeclaredTraitConfig,
  forwarded: ReadonlySet<string>,
): DeclaredTraitConfig | undefined {
  const kept = Object.entries(config).filter(([key]) => forwarded.has(key));
  return kept.length > 0 ? Object.fromEntries(kept) : undefined;
}

/**
 * One orbital's own file: the orbital plus the organism `config` knobs its traits forward
 * (`@config.<knob>`), so the forward still resolves when the app's files are composed back
 * (the Rust composer unions them). The file shape the studio stores and rabit's per-orbital build writes.
 */
export function orbitalFileOf(schema: OrbitalSchema, orbital: OrbitalDefinition): OrbitalSchema {
  const config = schema.config !== undefined
    ? filterConfigToForwardedKeys(schema.config, collectOrbitalForwardedConfigKeys(orbital))
    : undefined;
  return { name: orbital.name, version: schema.version ?? '1.0.0', orbitals: [orbital], ...(config !== undefined ? { config } : {}) };
}

/**
 * S-Expression Bindings
 *
 * Defines binding types and utilities for S-expression context.
 * Bindings are references to values that are resolved at runtime.
 *
 * Core Bindings:
 * - @entity - The linked entity for this trait (e.g., @entity.health)
 * - @payload - Event payload data (e.g., @payload.amount)
 * - @state - Current state machine state
 * - @now - Current timestamp (Date.now())
 *
 * Entity Bindings:
 * - @EntityName.field - Reference to singleton/runtime entity (e.g., @GameConfig.gravity)
 *
 * @packageDocumentation
 */

import { z } from 'zod';

// Re-export core binding utilities from expression.ts
export {
  isBinding,
  parseBinding,
  isValidBinding,
  CORE_BINDINGS,
  type CoreBinding,
  type ParsedBinding,
} from './expression.js';
import type { SExpr } from './expression.js';
import type { RuntimeValue } from './json.js';

// ============================================================================
// Binding Schema
// ============================================================================

/**
 * Schema for a binding string.
 * Validates that the string starts with @ and has valid format.
 */
export const BindingSchema = z.string().refine(
  (val) => {
    if (!val.startsWith('@')) return false;
    const parts = val.slice(1).split('.');
    if (parts.length === 0 || parts[0] === '') return false;
    // All parts must be valid identifiers (letters, numbers, underscore)
    // supporting unicode characters for i18n
    return parts.every((part) => /^[\p{L}_][\p{L}0-9_]*$/u.test(part));
  },
  { message: 'Invalid binding format. Must be @name or @name.path.to.field' }
);

// ============================================================================
// Binding Constants
// ============================================================================

/**
 * Binding documentation for LLM prompts and validation messages.
 * 
 * IMPORTANT: Keep synchronized with CORE_BINDINGS in expression.ts
 */
export const BINDING_DOCS = {
  entity: {
    description: 'Reference to the linked entity for this trait',
    examples: ['@entity.health', '@entity.x', '@entity.status'],
    requiresPath: true,
  },
  payload: {
    description: 'Reference to the event payload data',
    examples: ['@payload.amount', '@payload.targetId', '@payload.action'],
    requiresPath: true,
  },
  state: {
    description: 'Current state machine state name',
    examples: ['@state'],
    requiresPath: false,
  },
  now: {
    description: 'Current timestamp in milliseconds',
    examples: ['@now'],
    requiresPath: false,
  },
  config: {
    description: 'Trait configuration values',
    examples: ['@config.apiEndpoint', '@config.theme'],
    requiresPath: true,
  },
  computed: {
    description: 'Computed/calculated values',
    examples: ['@computed.total', '@computed.isValid'],
    requiresPath: true,
  },
  trait: {
    description: 'Trait context data',
    examples: ['@trait.name', '@trait.category'],
    requiresPath: true,
  },
  user: {
    description: 'Authenticated user / agent context for ownership and role-based gating',
    examples: ['@user.id', '@user.role'],
    requiresPath: true,
  },
  callsitePayload: {
    description:
      'Call-site-captured event payload — emitted by the compiler\'s inline-trait hoisting when an extracted render block captured @payload; resolved at the composing effect by the runtime BindingResolver',
    examples: ['@callsitePayload.error', '@callsitePayload.row'],
    requiresPath: true,
  },
  pages: {
    description:
      'Render-resolved schema sigil — the host orbital\'s pages as a NavItem[] array (href = page.path, label = page.name). Substituted from the OrbitalSchema before codegen; never survives as a live binding.',
    examples: ['@pages'],
    requiresPath: false,
  },
  currentTheme: {
    description:
      'Render-resolved schema sigil — the host orbital\'s active data-theme key, derived from Orbital.theme. Substituted from the OrbitalSchema before codegen; never survives as a live binding.',
    examples: ['@currentTheme'],
    requiresPath: false,
  },
  locale: {
    description: 'The active locale code (`en`, `ar`, `sl`, …) — the locale whose catalog `i18n/t` reads, set by the host from the route.',
    examples: ['@locale'],
    requiresPath: false,
  },
  event: {
    description: 'The delivery being processed: { event, payload, source } — for a listens delivery the source emit, with its BusEventSource envelope (Runtime Spec Clause 5.5)',
    examples: ['@event.event', '@event.payload.n', '@event.source.trait', '@event.source.tick'],
    requiresPath: false,
  },
  prevEvents: {
    description: 'The deliveries this trait already received in this dispatch, in order, each shaped like @event',
    examples: ['@prevEvents'],
    requiresPath: false,
  },
  prevStates: {
    description: 'The states this trait left in this dispatch, in order',
    examples: ['@prevStates'],
    requiresPath: false,
  },
  fromState: {
    description: "The transition's source state",
    examples: ['@fromState'],
    requiresPath: false,
  },
  toState: {
    description: "The transition's target state (null in a listens `when`, where no transition is chosen yet)",
    examples: ['@toState'],
    requiresPath: false,
  },
} as const;

/**
 * Validation rules for bindings in different contexts.
 */
export const BINDING_CONTEXT_RULES = {
  guard: {
    allowed: ['entity', 'payload', 'state', 'now', 'config', 'user', 'event', 'prevEvents', 'prevStates', 'fromState', 'toState'] as const,
    description:
      'Guards can read the delivery being processed and this dispatch\'s log (@event, @prevEvents, @prevStates) and the transition\'s ends (@fromState, @toState; Runtime Spec Clause 5.5). Guards can access entity fields, event payload, current state, time, the call-site trait config (@config.X), and the authenticated user context (@user.id, @user.role) for ownership / role gates. Config access lets atoms write mode-aware guards — e.g. std-modal\'s OPEN can require @payload.row only when @config.mode equals "edit", letting create-mode legitimately fire OPEN with no row. Like effects, @config.X is substituted at molecule/organism inline time with the literal call-site value; at atom-scope validate, @config is allowed-but-unresolved.',
  },
  effect: {
    allowed: ['entity', 'payload', 'state', 'now', 'trait', 'config', 'user', 'callsitePayload', 'pages', 'currentTheme', 'locale', 'event', 'prevEvents', 'prevStates', 'fromState', 'toState'] as const,
    description:
      'Effects can access and modify entity fields, use payload data, embed another trait\'s live frame via @trait.X inside render-ui children, read trait config values (@config.X) for atoms parameterized by their call-site, and read the authenticated user context (@user.id, @user.role). At molecule/organism inline time, @config.X is substituted with the literal value from the call-site config block; at atom-scope validate, @config is allowed-but-unresolved. @callsitePayload.X is the call-site-captured event payload emitted by the compiler\'s inline-trait hoisting (a hoisted render block that captured @payload); it is resolved at the composing effect by the runtime BindingResolver.',
  },
  tick: {
    allowed: ['entity', 'state', 'now', 'config', 'user'] as const,
    description: 'Ticks can access entity fields, current state, time, trait config (@config.X) for parameterized atoms, and the authenticated user context (@user.id, @user.role). Same substitution semantics as guards/effects.',
  },
} as const;

export type BindingContext = keyof typeof BINDING_CONTEXT_RULES;

// ============================================================================
// Render-Time Binding Markers
// ============================================================================

/**
 * Tag property of a `RenderBindingMarker`. `$`-prefixed so it can never
 * collide with a pattern prop key (prop keys are camelCase identifiers).
 */
export const RENDER_BINDING_MARKER = '$renderBinding' as const;

/**
 * A render-ui prop leaf that is evaluated at RENDER time, not at flush time.
 *
 * The interpreted path's executor carries `@entity`-dependent leaves into
 * slot content as these markers instead of resolving them eagerly; the
 * renderer (`@almadar/ui`'s SlotContentRenderer) resolves each marker
 * against the live entity store on every render — the same model the
 * compiled shell uses (state-based JSX reading `fields?.X` per React
 * render). Payload-dependent leaves are never deferred: `@payload` is
 * event-scoped and does not exist at render time.
 *
 * A `type` (not `interface`) so it carries an implicit index signature and
 * stays assignable to the `SExpr` record branch at guard call sites.
 */
export type RenderBindingMarker = {
  readonly [RENDER_BINDING_MARKER]: true;
  /** The raw prop expression: a binding string (`'@entity.hp'`, embedded
   * form `'HP: @entity.hp'`) or an S-expression tree. */
  readonly expression: SExpr;
};

/** Narrow an arbitrary prop value to a `RenderBindingMarker`. */
export function isRenderBindingMarker(value: RuntimeValue): value is RenderBindingMarker {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    RENDER_BINDING_MARKER in value &&
    value[RENDER_BINDING_MARKER] === true
  );
}

/** Matches a whole `@entity` token (path or bracket suffix allowed). */
const ENTITY_BINDING_RE = /@entity(?=[.\[\]]|$)/;

/** Matches a whole `@payload` / `@callsitePayload` token. */
const PAYLOAD_BINDING_RE = /@(?:callsitePayload|payload)(?=[.\[\]]|$)/;

/**
 * Does this raw prop expression reference `@entity` anywhere (pure binding,
 * embedded-binding string, nested S-expression, or object tree)? Marker
 * objects count as entity-referencing by construction.
 */
export function containsEntityBinding(value: SExpr): boolean {
  if (typeof value === 'string') return ENTITY_BINDING_RE.test(value);
  if (Array.isArray(value)) return value.some(containsEntityBinding);
  if (value !== null && typeof value === 'object') {
    if (isRenderBindingMarker(value)) return true;
    return Object.values(value as Record<string, SExpr>).some(containsEntityBinding);
  }
  return false;
}

/**
 * Does this raw prop expression reference the event payload (`@payload` /
 * `@callsitePayload`) anywhere? Such leaves stay flush-time evaluated —
 * the payload does not exist at render time.
 */
export function containsPayloadBinding(value: SExpr): boolean {
  if (typeof value === 'string') return PAYLOAD_BINDING_RE.test(value);
  if (Array.isArray(value)) return value.some(containsPayloadBinding);
  if (value !== null && typeof value === 'object') {
    return Object.values(value as Record<string, SExpr>).some(containsPayloadBinding);
  }
  return false;
}

// ============================================================================
// Binding Validation Helpers
// ============================================================================

/**
 * Check if a binding is valid in a given context.
 *
 * @param binding - Parsed binding
 * @param context - Context where binding is used
 * @returns Error message if invalid, null if valid
 */
export function validateBindingInContext(
  binding: { type: 'core' | 'entity'; root: string },
  context: BindingContext
): string | null {
  const rules = BINDING_CONTEXT_RULES[context];

  if (binding.type === 'core') {
    if (!(rules.allowed as readonly string[]).includes(binding.root)) {
      return `Binding @${binding.root} is not allowed in ${context} context. Allowed: ${rules.allowed.join(', ')}`;
    }
  }

  // Entity bindings are always allowed (they reference singletons/runtime entities)
  return null;
}

/**
 * Get all valid binding examples for a context.
 *
 * @param context - Context to get examples for
 * @returns Array of example binding strings
 */
export function getBindingExamples(context: BindingContext): string[] {
  const rules = BINDING_CONTEXT_RULES[context];
  const examples: string[] = [];

  for (const binding of rules.allowed) {
    const doc = BINDING_DOCS[binding];
    examples.push(...doc.examples);
  }

  // Add entity binding example
  examples.push('@GameConfig.gravity', '@Filter.searchTerm');

  return examples;
}

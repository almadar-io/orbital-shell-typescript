/**
 * Effect Types (Self-Contained)
 *
 * Defines effect types for trait transitions and ticks.
 * Effects are S-expressions (arrays) that describe actions to perform.
 *
 * @packageDocumentation
 */

import { z } from 'zod';
import { type SExpr, type Expression, type EventPayload, SExprDataSchema } from './expression.js';
import type { RuntimeValue, JsonValue, JsonObject } from './json.js';
import { type ServiceParams } from './service.js';
import { type EntityRow, type FieldValue } from './entity.js';

// ============================================================================
// UI Slots
// ============================================================================

/**
 * Known UI slots where content can be rendered
 */
export const UI_SLOTS = [
    // App slots
    'main',
    'sidebar',
    'dock', // Right inline panel that pushes main (narrow screens: a drawer)
    'modal',
    'drawer',
    'overlay',
    'center',
    'toast',
    'floating',
    'system', // For invisible system components (InputListener, CollisionDetector)
    'content',
    'screen',
    // Game HUD slots
    'hud',
    'hud-top',
    'hud-bottom',
    'hud.health',
    'hud.score',
    'hud.inventory',
    'hud.stamina',
    // Game overlay slots
    'overlay.inventory',
    'overlay.dialogue',
    'overlay.menu',
    'overlay.pause',
] as const;

export type UISlot = (typeof UI_SLOTS)[number];

/** The slots a renderer mounts as `#slot-{name}`: every slot except the HUD group key, the `screen` alias and dotted sub-slots. */
export const RENDERED_SLOTS: readonly UISlot[] = UI_SLOTS.filter(
  (slot) => !slot.includes('.') && slot !== 'hud' && slot !== 'screen',
);

export const UISlotSchema = z.enum(UI_SLOTS);

// ============================================================================
// Pattern Config (for render-ui effects)
// ============================================================================

// Import pattern types for local use and re-export for consumers
import type {
    PatternType,
    PatternConfig,
    PatternProps,
    PatternPropsMap,
    AnyPatternConfig,
} from '../patterns/index.js';

/**
 * Type-safe pattern configuration for render-ui effects.
 *
 * Re-exported from @almadar/patterns. Generated from patterns-registry.json.
 *
 * @example
 * // Type-safe with specific pattern type
 * const config: PatternConfig<'table-view'> = {
 *   patternType: 'table-view',
 *   columns: [{ key: 'name', header: 'Name' }],  // ✅ Required prop
 *   entity: 'User',
 * };
 *
 * // Error: Property 'columns' is missing (required prop)
 * const bad: PatternConfig<'table-view'> = { patternType: 'table-view' };
 *
 * // Error: 'fake-pattern' is not assignable to PatternType
 * const invalid: PatternConfig = { patternType: 'fake-pattern' };
 */
export type {
    PatternType,
    PatternConfig,
    PatternProps,
    PatternPropsMap,
    AnyPatternConfig,
};

// ============================================================================
// Service Config (for call-service effects)
// ============================================================================

/**
 * Configuration extracted from call-service effects
 */
export type CallServiceConfig = {
    service: string;
    action: string;
    endpoint?: string;
    method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    params?: ServiceParams;
    onSuccess?: string;
    onError?: string;
};

// ============================================================================
// Typed Effect Tuples
// ============================================================================

/**
 * A binding reference to a render tree stored elsewhere — a trait `config`
 * knob or a payload field — e.g. `"@config.bodyContent"`. Resolved to a pattern
 * node at render time. This is how an atom renders a tree that contains data
 * bindings (`entity: "@payload.data"`, `fields: "@config.fields"`): the tree is
 * a permissive `TraitConfigValue` stored in `config` (a binding string is not a
 * valid `AnyPatternConfig` prop value), and the render-ui effect points at it.
 * Worked example: `std-browse`'s loaded transition is `['render-ui', 'main',
 * '@config.bodyContent']`. The Rust validator accepts this form; this variant
 * lets the TS effect type express it.
 */
export type RenderBinding = `@${string}`;

/**
 * A binding reference resolving to a {@link UISlot} at inline time — a trait
 * `config` knob holding the slot name, e.g. `"@config.reviewSlot"`. Mirrors
 * {@link RenderBinding} for the SLOT position: the compiler's inline phase
 * substitutes the config value before anything renders, and the Rust
 * validator accepts the pre-substitution form (worked example:
 * `std-approval-gate`'s review queue renders into `@config.reviewSlot`).
 * This variant lets the TS effect type express the template-layer form.
 */
export type SlotBinding = `@config.${string}`;

/**
 * Template-layer pattern node: a render tree whose discriminant and/or props
 * are still bindings (`type: '@config.viewPattern'`, `title: '@config.title'`)
 * or loose nested descriptors the compiler's inline phase resolves. The
 * resolved layer is {@link AnyPatternConfig}; this variant lets generated
 * behavior descriptors (std-ts) carry the pre-substitution form the Rust
 * validator accepts (worked example: `std-graphs` renders
 * `{ type: '@config.viewPattern', chartType: '@config.chartType', … }`).
 */
export type TemplatePatternConfig = { type: PatternType | RenderBinding } & Record<string, JsonValue>;

/**
 * Render UI effect - displays a pattern in a UI slot.
 * @example ['render-ui', 'main', { patternType: 'table-view', columns: [{ key: 'name', header: 'Name' }] }]
 * @example ['render-ui', 'main', '@config.bodyContent']  // a {@link RenderBinding} target
 * @example ['render-ui', '@config.reviewSlot', { patternType: 'table-view' }]  // a {@link SlotBinding} slot
 */
export type RenderUIEffect =
    | ['render-ui', UISlot | SlotBinding, AnyPatternConfig]
    | ['render-ui', UISlot | SlotBinding, TemplatePatternConfig]
    | ['render-ui', UISlot | SlotBinding, RenderBinding]
    | ['render-ui', UISlot | SlotBinding, null];

/**
 * Lambda expression for per-item rendering in data-grid/data-list.
 * The compiler generates: {(paramName: Record<string, unknown>) => (<>JSX</>)}
 * where @{paramName}.field bindings reference the current iteration item.
 *
 * @example ["fn", "item", { "type": "stack", "children": [{ "type": "typography", "content": "@item.title" }] }]
 */
export type RenderItemLambda = ['fn', string, AnyPatternConfig];

/**
 * Dynamic-collection children entry: renders one child per item of a collection
 * expression, authored inline in a `children:` position and kept verbatim as IR
 * (no new node kind). The collection expression is an {@link SExpr} evaluated at
 * render time; the {@link RenderItemLambda} body is instantiated per item with
 * the lambda param bound as an `@item`-scope binding. Both execution paths lower
 * onto the one lambda + `@item` + splice machinery.
 *
 * @example ["array/map", "@entity.tasks", ["fn", "item", { "type": "typography", "content": "@item.title" }]]
 */
export type RenderChildrenMap = ['array/map', SExpr, RenderItemLambda];

/**
 * Trailing options object on navigate effects. `crumb` labels the navigation
 * stack entry the client pushes for the target page (e.g. the record title a
 * list router has in `?row` at push time); without it the entry falls back to
 * the target page's declared/derived label.
 */
export type NavigateOptions = { crumb?: string | SExpr };

/**
 * Navigate effect - navigates to an internal page path or an external URL.
 * @example ['navigate', '/tasks'] or ['navigate', '/tasks/:id', { id: '123' }]
 * @example ['navigate', 'https://example.com']
 * @example ['navigate', '/contracts/42', { id: '42' }, { crumb: '@payload.row.title' }]
 */
export type NavigateEffect =
    | ['navigate', string | SExpr]
    | ['navigate', string | SExpr, Record<string, string | SExpr>]
    | ['navigate', string | SExpr, Record<string, string | SExpr>, NavigateOptions];

/**
 * Navigate-back effect - pops the current entry off the orbital-scoped
 * navigation stack and navigates to the previous one. The stack is
 * client-session state (cold loads are seeded from declared page-path
 * prefixes), so an ancestor always exists on nested paths; the validator
 * rejects `navigate-back` reachable only from pages with no path ancestor.
 * @example ['navigate-back']
 */
export type NavigateBackEffect = ['navigate-back'];

/**
 * Emit effect - emits an event, optionally with payload.
 * @example ['emit', 'SAVE'] or ['emit', 'PLAYER_DIED', { playerId: '@entity.id' }]
 * @example ['emit', 'FILTER_CHANGED', '@entity.filters']
 */
export type EmitEffect = ['emit', string] | ['emit', string, EventPayload | string];

/**
 * `emit:` config block attached to async / reactive data operators.
 *
 * Each key names an event the runtime should fire on the bus when the
 * effect reaches the corresponding lifecycle point. The set of keys an
 * operator actually supports is enforced by the compiler validator:
 *
 * | Operator         | Supported keys            |
 * |------------------|---------------------------|
 * | `fetch`          | `success`, `failure`      |
 * | `persist`        | `success`, `failure`      |
 * | `call-service`   | `success`, `failure`, `cancelled` |
 * | `set`            | `success`                 |
 * | `ref`            | `on_change`, `failure`    |
 * | `fetch-stream`   | `on_message`, `success`, `failure` |
 *
 * Payload convention:
 * - `success` / `on_change` → the effect's result (fetched entity, new value)
 * - `failure`               → `{ error: string, code?: string }`
 * - `on_message`            → the incoming chunk (`fetch-stream`)
 *
 * See `docs/Almadar_Std_Gaps.md` §3.1 for the close-the-circuit design.
 */
export interface EmitConfig {
    /** Fires after a one-shot async effect resolves successfully. */
    success?: string;
    /** Fires when the effect throws; payload is `{ error: string }`. */
    failure?: string;
    /** `call-service` only: fires when `cancel-call` aborts the call; payload is `{ key }`. */
    cancelled?: string;
    /** Reactive-subscription event (per update for `ref`). */
    on_change?: string;
    /** Per-chunk fire for `fetch-stream`. */
    on_message?: string;
}

/**
 * Set effect - sets a binding to a value.
 *
 * Two forms are supported to match the runtime's `set` handler signature
 * `(targetId, field, value)`:
 *
 * - 3-element binding form (legacy / std behaviors): ['set', '@entity.field', value]
 * - 4-element target form (canonical runtime): ['set', entityId, fieldName, value]
 *
 * The 4-element form is what `OrbitalServerRuntime`'s set handler
 * dispatches directly (`update(entityType, targetId, { field: value })`).
 * Prefer the 4-element form when authoring schemas in TypeScript that
 * load directly into the runtime.
 *
 * @example ['set', '@entity.health', 100]                       // 3-element
 * @example ['set', '@entity.id', 'health', 100]                 // 4-element
 * @example ['set', '@entity.id', 'count', ['+', '@entity.count', 1]]
 */
export type SetEffect =
    | ['set', string, SExpr]
    | ['set', string, string, SExpr];

/**
 * Trailing config object on persist effects. When present, it carries the
 * `emit` map specifying which events to fire on persist success/failure.
 * Mirrors what the runtime's `EffectExecutor` reads at the 5th tuple
 * position. See `(persist create Entity @payload.data { emit: { success:
 * "Saved", failure: "SaveFailed" } })` in `.lolo` source.
 */
export type PersistEmitConfig = {
    emit?: { success?: string; failure?: string };
};

/**
 * Persist effect data argument: an entity row literal (field map), a
 * binding string referencing a row in scope (e.g. `@payload.data`,
 * `@entity`), or an expression form that evaluates to a row (e.g.
 * `["object/merge", "@payload.data", { sender: "@user.id" }]`). At
 * runtime, binding strings and expressions resolve to `EntityRow` values
 * before the persist op runs — both paths evaluate the expression first.
 */
export type PersistRowInput = { id?: string | SExpr } & Record<string, FieldValue | SExpr | undefined>;

export type PersistData = EntityRow | PersistRowInput | string | SExpr[];

/**
 * One EVALUATED operation of the runtime path's `["persist", "batch", [...ops]]`
 * form, as `EffectExecutor` hands it to `handlers.persist('batch', '', { operations })`
 * and both server persist handlers execute it. The row is optional on
 * create/update (an absent row persists `{}`), exactly as the handlers always
 * tolerated. The compiled path has no batch persist — ledger §169.
 */
export type PersistBatchOperation =
    | ['create', string, EntityRow?]
    | ['update', string, string, EntityRow?]
    | ['delete', string, string];

function isRowObject(value: RuntimeValue): value is EntityRow {
    return typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Date);
}

/** The ONE structural check for a batch operation — every consumer narrows through it. */
export function isPersistBatchOperation(value: RuntimeValue): value is PersistBatchOperation {
    if (!Array.isArray(value) || typeof value[1] !== 'string') return false;
    switch (value[0]) {
        case 'create':
            return value.length === 2 || (value.length === 3 && isRowObject(value[2]));
        case 'update':
            return typeof value[2] === 'string' && (value.length === 3 || (value.length === 4 && isRowObject(value[3])));
        case 'delete':
            return value.length === 3 && typeof value[2] === 'string';
        default:
            return false;
    }
}

/**
 * Persist effect - creates, updates, deletes, or clears entities.
 *
 * Each operation accepts an optional trailing `PersistEmitConfig` so the
 * runtime can fire success / failure events when the operation completes.
 *
 * @example ['persist', 'create', 'Task', { title: '@payload.title' }]
 * @example ['persist', 'update', '@entity.entityType', '@payload.data']
 * @example ['persist', 'create', 'Task', '@payload.data', { emit: { success: 'TaskCreated' } }]
 */
export type PersistEffect =
    | ['persist', 'create', string, PersistData]
    | ['persist', 'create', string, PersistData, PersistEmitConfig]
    | ['persist', 'upsert', string, PersistData]
    | ['persist', 'upsert', string, PersistData, PersistEmitConfig]
    | ['persist', 'update', string, PersistData]
    | ['persist', 'update', string, PersistData, PersistEmitConfig]
    | ['persist', 'delete', string]
    | ['persist', 'delete', string, PersistData]
    | ['persist', 'delete', string, PersistData, PersistEmitConfig]
    | ['persist', 'clear', string]
    | ['persist', 'clear', string, PersistData]
    | ['persist', 'clear', string, PersistData, PersistEmitConfig]
    | ['persist', 'batch', SExpr]
    | ['persist', 'batch', SExpr, PersistEmitConfig];

/**
 * Call service effect - invokes an external service.
 *
 * Two shapes are accepted:
 *
 * 1. Flat form (what the runtime reads and every .orb file uses):
 *    `['call-service', serviceName, action, params?]` — args[0]=service,
 *    args[1]=action, args[2]=params. This is the canonical form; the
 *    runtime's EffectExecutor decodes exactly these positions.
 *
 * 2. Legacy config-object form (kept for the `callService()` helper):
 *    `['call-service', serviceName, CallServiceConfig]` — retained so
 *    older call sites using the builder helper continue to typecheck.
 *
 * @example ['call-service', 'my-service', 'run', { target: '@entity.target', event: 'order.placed' }]
 * @example ['call-service', 'my-service', 'run', { target: '...', event: '...' }, { emit: { success: 'OK', failure: 'ERR' } }]
 * @example ['call-service', 'WeatherAPI', { service: 'weather', action: 'get', onSuccess: 'OK' }]
 */
/** Trailing config on `call-service`: outcome events, plus `onMessage` for
 *  the live messages a running call delivers to the requesting client. */
export type CallServiceEmitConfig = {
    /** Expression evaluated at call time to a string; names the call for `cancel-call`. */
    key?: SExpr;
    emit?: { success?: string; failure?: string; cancelled?: string; onMessage?: string };
};

/**
 * Cancel-call effect - aborts the in-flight keyed call (`call-service`, `http`,
 * `browser/prompt` or `browser/embed`) started with that key in the same running
 * app; no-op when none is in flight. The cancelled call emits its `emit.cancelled`
 * event with `{ key }`, never success/failure, and a reply that arrives later is dropped.
 * @example ['cancel-call', '@entity.id']
 */
export type CancelCallEffect = ['cancel-call', SExpr];

/** Trailing config of `random-bytes`, `credential-status` and `credential-forget`: outcome events only. */
export type HostCallEmitConfig = {
    emit?: { success?: string; failure?: string };
};

/**
 * Random-bytes effect - `n` bytes (an integer from 1 to 1024) of the host CSPRNG, journaled on the kernel path.
 * Success carries {@link RandomBytesPayload}; failure carries `{ error }`. Server-only.
 * @example ['random-bytes', 32, { emit: { success: 'STATE_DRAWN' } }]
 */
export type RandomBytesEffect =
    | ['random-bytes', SExpr]
    | ['random-bytes', SExpr, HostCallEmitConfig & { key?: SExpr }];

/** Success payload of `random-bytes`: the bytes as base64url without padding; a keyed call adds its `key`. */
export interface RandomBytesPayload {
    value: string;
    key?: string;
}

/**
 * Credential-status effect - a bare secret knob checks the signed-in viewer's credential. An explicit
 * `{ credential: knob, scope: 'app' | 'user' }` selects a scope; app checks need no viewer and empty is absent.
 * Success carries {@link CredentialPayload}; user checks fail when nobody is signed in. Server-only.
 * @example ['credential-status', '@config.googleToken', { emit: { success: 'STATUS_KNOWN' } }]
 */
export type CredentialStatusEffect =
    | ['credential-status', SExpr]
    | ['credential-status', SExpr, HostCallEmitConfig];

/**
 * Credential-forget effect - drops the signed-in viewer's credential a `secret` knob names; success carries
 * `{ connected: false }`. Server-only.
 * @example ['credential-forget', '@config.googleToken', { emit: { success: 'DISCONNECTED' } }]
 */
export type CredentialForgetEffect =
    | ['credential-forget', SExpr]
    | ['credential-forget', SExpr, HostCallEmitConfig];

/** Success payload of `credential-status` and `credential-forget`. */
export interface CredentialPayload {
    connected: boolean;
    /** The non-secret account label stored beside the credential (the email it was signed in as); empty text when it has none. Never the value. */
    label: string;
}

/**
 * Access-check effect - the kernel's verdict on an entity's declared access policy for `viewer` (`null` for nobody) on
 * `row`, through the evaluator fetch and persist enforce. Success carries {@link AccessCheckPayload}; an undeclared entity,
 * an unknown action or a missing key fails with `{ error }`. Server-only.
 * @example ['access-check', { entity: 'Task', action: 'create', row: { ownerId: 'u1' }, viewer: { id: 'u1' } }, { emit: { success: 'CHECKED' } }]
 */
export type AccessCheckEffect =
    | ['access-check', AccessCheckRequest]
    | ['access-check', AccessCheckRequest, HostCallEmitConfig];

/** The request of `access-check`. */
export interface AccessCheckRequest {
    entity: SExpr;
    action: SExpr;
    row: SExpr;
    viewer: SExpr;
}

/** Success payload of `access-check`. */
export interface AccessCheckPayload {
    allowed: boolean;
}

/** The credential administration operators: the kernel owns the role gate, the declared-name check and the masking. */
export type CredentialAdminOperator =
    | 'credential-list'
    | 'credential-set'
    | 'credential-remove'
    | 'credential-test'
    | 'credential-mode'
    | 'credential-rotate';

/**
 * Credential administration effect - `(credential-<verb> request { emit })`. `credential-list` is open; `set`,
 * `remove`, `test`, `mode` and `rotate` need the caller's `@user.role` among `ALMADAR_CREDENTIAL_ADMIN_ROLES` (default
 * admin, owner). Failures carry
 * {@link CredentialAdminFailure}. Server-only.
 * @example ['credential-set', { service: 'KeysOrbital', envVar: 'ALMADAR_API_KEY_SALT', value: '@payload.value' }, { emit: { success: 'SAVED' } }]
 */
export type CredentialAdminEffect =
    | [CredentialAdminOperator, SExpr]
    | [CredentialAdminOperator, SExpr, HostCallEmitConfig];

/** One credential in the masked inventory: where it resolves from and its last four characters, never its value. */
export interface CredentialListEntry {
    id: string;
    service: string;
    envVar: string;
    required: boolean;
    description: string;
    configured: boolean;
    source: 'store' | 'env' | 'none';
    last4: string;
}

/** One service's row of the inventory. */
export interface CredentialServiceStatus {
    id: string;
    service: string;
    configured: boolean;
    mocked: boolean;
    status: 'real' | 'emulated' | 'mocked' | 'not configured';
    backend: string;
    needs: string;
}

/** Success payload of `credential-list`. */
export interface CredentialListPayload {
    enabled: boolean;
    mode: 'mock' | 'real';
    services: CredentialServiceStatus[];
    entries: CredentialListEntry[];
}

/** Success payload of `credential-set`. */
export interface CredentialSetPayload {
    saved: true;
    service: string;
    envVar: string;
    last4: string;
}

/** Success payload of `credential-remove`. */
export interface CredentialRemovePayload {
    removed: boolean;
}

/** Success payload of `credential-test`: presence only, never a live probe. */
export interface CredentialTestPayload {
    service: string;
    configured: boolean;
    missing: string[];
    probed: false;
    ok: boolean;
    message: string;
}

/** Success payload of `credential-mode`. */
export interface CredentialModePayload {
    mode: 'mock' | 'real';
}

/** Success payload of `credential-rotate`. */
export interface CredentialRotatePayload {
    rotated: number;
    alreadyCurrent: number;
    unreadable: number;
}

/** Failure payload of every credential administration effect: `AUTH_ERROR` for a refused role, `VALIDATION_ERROR` for a bad request. */
export interface CredentialAdminFailure {
    error: string;
    code: 'AUTH_ERROR' | 'VALIDATION_ERROR' | null;
}

/** The provider words an OAuth connection can be kept for. */
export type OAuthProviderWord = 'google' | 'github' | 'auth0';

/** The operations an `oauth-client` auth performs (closed set). */
export type OAuthOp = 'discovery' | 'code' | 'connect' | 'refresh' | 'revoke' | 'userinfo';

/** The `oauth-endpoint` target words: the URL comes from the client's metadata. */
export type OAuthEndpointWord = 'token' | 'revocation' | 'userinfo';

/**
 * An OAuth client object: where the authorization server is described (`issuer` XOR `endpoints`) and which
 * `secret` knobs hold the client credentials. `mode: 'mock'` has no runtime on the kernel host.
 */
export type OAuthClient = {
    tag: OAuthProviderWord;
    mode: 'real' | 'mock';
    clientId: SExpr;
    clientSecret?: SExpr;
    clientAuth: 'basic' | 'post' | 'none';
} & (
    | { issuer: SExpr; endpoints?: never }
    | { issuer?: never; endpoints: { authorization: SExpr; token: SExpr; revocation?: SExpr; userinfo?: SExpr } }
);

/** The options of `oauth-authorize`: the redirect, the scopes, the subject that must complete it, extra authorization params. */
export interface OAuthAuthorizeOptions {
    redirectUri: SExpr;
    scope?: SExpr;
    subject?: SExpr;
    params?: Record<string, SExpr>;
}

/**
 * OAuth-authorize effect - builds the authorization URL and keeps the pending grant (PKCE verifier included)
 * with the host; success carries {@link OAuthAuthorizePayload}, failure {@link OAuthEffectFailurePayload}. Server-only.
 * @example ['oauth-authorize', { tag: 'google', mode: 'real', issuer: '@config.issuer', clientId: '@config.id', clientAuth: 'post' }, { redirectUri: '@config.redirect' }, { emit: { success: 'AUTH_URL' } }]
 */
export type OAuthAuthorizeEffect =
    | ['oauth-authorize', OAuthClient, OAuthAuthorizeOptions]
    | ['oauth-authorize', OAuthClient, OAuthAuthorizeOptions, HostCallEmitConfig & { key?: SExpr }];

/**
 * OAuth-connection-status effect - the signed-in viewer's connection to a provider; success carries
 * {@link OAuthConnectionPayload}. Server-only.
 * @example ['oauth-connection-status', 'google', { emit: { success: 'CONNECTION' } }]
 */
export type OAuthConnectionStatusEffect =
    | ['oauth-connection-status', OAuthProviderWord]
    | ['oauth-connection-status', OAuthProviderWord, HostCallEmitConfig];

/**
 * OAuth-connection-forget effect - drops the signed-in viewer's connection to a provider; success carries the
 * disconnected {@link OAuthConnectionPayload}. Server-only.
 * @example ['oauth-connection-forget', 'google', { emit: { success: 'DISCONNECTED' } }]
 */
export type OAuthConnectionForgetEffect =
    | ['oauth-connection-forget', OAuthProviderWord]
    | ['oauth-connection-forget', OAuthProviderWord, HostCallEmitConfig];

/** Success payload of `oauth-authorize`. */
export interface OAuthAuthorizePayload {
    authUrl: string;
    state: string;
    /** The authorization code the person's consent returned on a host that asked them itself; empty text on every other host. */
    code: string;
    /** The call's evaluated `key` option; null when unkeyed. */
    key: string | null;
}

/** Success payload of `oauth-connection-status` and `oauth-connection-forget`, and of an `oauth-client` `connect`. */
export interface OAuthConnectionPayload {
    provider: OAuthProviderWord;
    connected: boolean;
    account: string;
    avatarUrl: string;
    scope: string[];
    connectedAt: string;
}

/** Failure payload of the OAuth effects: a fixed safe message, the public code and the closed reason. */
export interface OAuthEffectFailurePayload {
    error: string;
    code: HttpOAuthFailureCode;
    reason: HttpOAuthFailureReason;
}

/** Failure payload of `oauth-authorize`: the OAuth failure (or a bare `error`) beside the call's `key`. */
export type OAuthAuthorizeFailurePayload = (OAuthEffectFailurePayload | { error: string }) & { key: string | null };

/** Success payloads of the `oauth-client` ops (each also carries the call's `key`). */
export interface OAuthDiscoveryPayload { issuer: string; key: string | null }
export interface OAuthCodePayload {
    accessToken: string;
    refreshToken: string | null;
    expiresIn: number;
    tokenType: string;
    scope: string[];
    subject: string | null;
    key: string | null;
}
export interface OAuthRefreshPayload { accessToken: string; expiresIn: number; key: string | null }
export interface OAuthRevokePayload { revoked: boolean; key: string | null }
export interface OAuthUserinfoPayload { sub: string; email: string; name: string; picture: string; key: string | null }
export type OAuthConnectPayload = OAuthConnectionPayload & { key: string | null };

export type CallServiceEffect =
    | ['call-service', string, string]
    | ['call-service', string, string, ServiceParams]
    | ['call-service', string, string, ServiceParams, CallServiceEmitConfig]
    | ['call-service', string, CallServiceConfig];

/** HTTP method word of the `http` effect. */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/**
 * Http effect - one HTTP request to a declared egress origin (server-only).
 * `request` carries the closed keys query/headers/body/auth/timeoutMs/responseAs/paginate/stream.
 * @example ['http', 'GET', 'https://api.iconify.design', '/search', { query: { query: '@payload.q' } }, { key: '@entity.id', emit: { success: 'OK', failure: 'ERR' } }]
 */
export type HttpEffect =
    | ['http', HttpMethod, string, SExpr]
    | ['http', HttpMethod, string, SExpr, SExpr]
    | ['http', HttpMethod, string, SExpr, SExpr, CallServiceEmitConfig];

/**
 * Redis effect - one command to a declared `redis://`/`rediss://` egress origin (server-only); the kernel owns RESP.
 * @example ['redis', 'redis://cache.internal:6379', ['GET', '@payload.key'], { auth: '@config.password' }, { emit: { success: 'GOT', failure: 'ERR' } }]
 */
export type RedisEffect =
    | ['redis', string, SExpr]
    | ['redis', string, SExpr, SExpr]
    | ['redis', string, SExpr, SExpr, SExpr];

/**
 * Postgres effect - one parameterised read-only query to a declared `postgres://` egress origin (server-only); the kernel owns the wire protocol.
 * @example ['postgres', 'postgres://db.internal:5432', 'select id from t where a = $1', ['@payload.a'], { user: 'app' }, { emit: { success: 'ROWS', failure: 'ERR' } }]
 */
export type PostgresEffect =
    | ['postgres', string, SExpr, SExpr]
    | ['postgres', string, SExpr, SExpr, SExpr]
    | ['postgres', string, SExpr, SExpr, SExpr, SExpr];

/** Success payload of an `http` effect; a non-2xx status is still a success reply. */
export interface HttpReplyPayload {
    status: number;
    /** Lower-cased header names. */
    headers: Record<string, string>;
    body: string;
    /** The call's evaluated `key` option; null when unkeyed. */
    key: string | null;
}

/** Success payload of an `http` effect with `paginate`. */
export interface HttpPagedPayload<T> {
    pages: number;
    items: T[];
    last: HttpReplyPayload;
    /** The call's evaluated `key` option; null when unkeyed. */
    key: string | null;
}

export interface HttpPresignedPayload {
    url: string;
    key: string | null;
}

/** Evaluated HTTP input; clock metadata belongs to the dispatch, never the authored request. */
export interface HttpCall {
    method: string;
    origin: string;
    path: string;
    request: JsonObject;
    key?: string | null;
    nowMs?: number;
    /** `beacon` hands the built request to the host's beacon port instead of an exchange; absent is `fetch`. */
    delivery?: 'fetch' | 'beacon';
}

/** Success payload of a `browser/beacon` effect: how the host took the request, never a collector reply. */
export interface HttpBeaconPayload {
    /** Queue accepted, or the keepalive fetch answered 2xx. */
    sent: boolean;
    via: 'queue' | 'fetch';
    /** The keepalive fetch's status; null when the queue accepted or the fetch threw. */
    status: number | null;
    /** The call's evaluated `key`; null when unkeyed. */
    key: string | null;
}

/** A page fact `browser/page-facts` can read; the list order is the read order. */
export type PageFactField = 'hostname' | 'referrer' | 'screenWidth';

/** Success payload of `browser/page-facts`: a fact that was not requested carries its default. */
export interface BrowserPageFacts {
    /** False when there is no page (no window or document). */
    available: boolean;
    hostname: string;
    referrer: string;
    screenWidth: number | null;
}

/**
 * Page-facts effect - read the requested page facts (client-only).
 * @example ['browser/page-facts', ['referrer', 'screenWidth'], { emit: { success: 'FACTS', failure: 'FACTS_FAILED' } }]
 */
export type BrowserPageFactsEffect =
    | ['browser/page-facts', PageFactField[]]
    | ['browser/page-facts', PageFactField[], CallServiceEmitConfig];

/** The on-device model's surface; the host (a browser, the chrome-extension shell) supplies it. */
export interface OnDeviceModelPort {
    availability(): Promise<'available' | 'downloadable' | 'downloading' | 'unavailable'>;
    /** Run one prompt whose reply must satisfy the JSON schema; returns the raw reply text. An aborted `signal` stops it. */
    prompt(text: string, schema: object, signal?: AbortSignal): Promise<string>;
}

/** The on-device text embedder: one vector per text, in input order. An aborted `signal` stops it. */
export interface OnDeviceEmbedderPort {
    embed(texts: string[], signal?: AbortSignal): Promise<number[][]>;
}

/** The on-device model and embedder a host wires in; each is absent when the host has none. */
export interface OnDeviceModelPorts {
    model?: OnDeviceModelPort;
    embedder?: OnDeviceEmbedderPort;
}

/**
 * Why an on-device call gave no answer: the host wires none (`unconfigured`), has one that cannot answer now
 * (`unavailable`), or it answered with an error (`failed`).
 */
export type OnDeviceFailureKind = 'unconfigured' | 'unavailable' | 'failed';

/** Success payload of `browser/prompt`: the model's raw reply text and the call's key (null unkeyed). */
export interface BrowserPromptPayload {
    reply: string;
    key: string | null;
}

/** Success payload of `browser/embed`: one vector per text, in input order, and the call's key (null unkeyed). */
export interface BrowserEmbedPayload {
    embeddings: number[][];
    key: string | null;
}

/** Failure payload of `browser/prompt` and `browser/embed`. */
export interface OnDeviceFailurePayload {
    error: string;
    kind: OnDeviceFailureKind;
    key: string | null;
}

/**
 * Prompt effect - ask the host's on-device model for a reply satisfying the JSON Schema text (client-only,
 * keyed and cancellable by `cancel-call`).
 * @example ['browser/prompt', '@payload.text', '{"type":"object"}', { key: '@entity.batchId', emit: { success: 'REPLIED', failure: 'FAILED', cancelled: 'CANCELLED' } }]
 */
export type BrowserPromptEffect =
    | ['browser/prompt', string, string]
    | ['browser/prompt', string, string, CallServiceEmitConfig];

/**
 * Embed effect - ask the host's on-device embedder for one vector per text (client-only, keyed and cancellable).
 * @example ['browser/embed', ['a', 'b'], { key: '@entity.batchId', emit: { success: 'EMBEDDED', failure: 'FAILED', cancelled: 'CANCELLED' } }]
 */
export type BrowserEmbedEffect =
    | ['browser/embed', string[]]
    | ['browser/embed', string[], CallServiceEmitConfig];

/**
 * Beacon effect - fire-and-forget text/plain POST to an absolute http(s) URL through the browser's beacon queue,
 * then one keepalive fetch (client-only).
 * @example ['browser/beacon', 'https://collector.example.com/e', { text: '@entity.body', key: '@entity.id' }, { emit: { success: 'DONE', failure: 'FAILED', cancelled: 'CANCELLED' } }]
 */
export type BrowserBeaconEffect =
    | ['browser/beacon', string, SExpr]
    | ['browser/beacon', string, SExpr, CallServiceEmitConfig];

/** Why a `browser/tab-*` call failed: refused before any ask, no tabs on the host, no page script, a vanished element, or another error. */
export type BrowserTabFailureKind = 'invalid' | 'unavailable' | 'not-ready' | 'not-found' | 'failed';

/** Failure payload of every `browser/tab-*` effect. */
export interface BrowserTabFailurePayload {
    error: string;
    kind: BrowserTabFailureKind;
    /** The call's evaluated `key`; null when unkeyed. */
    key: string | null;
}

/** One element a `browser/tab-query` read, with the fields its call declared. */
export interface BrowserTabElement {
    elementId: string;
    fields: Record<string, string>;
}

/** What a `browser/tab-capture` hands back: the tab, the image format and the image as standard base64. */
export interface BrowserTabCapture {
    tab: number;
    format: 'png' | 'jpeg';
    image: string;
    /** The call's evaluated `key`; null when unkeyed. */
    key: string | null;
}

/** One element a `browser/tab-apply-many` named, in the tab it was named in. */
export interface BrowserTabElementRef {
    tab: number;
    elementId: string;
}

/**
 * Tab effects - drive the browser's tabs (client-only, keyed and cancellable). The request is the op's closed
 * object; the kernel validates it and shapes the result.
 * @example ['browser/tab-query', { tab: '@entity.tab', selector: '.result', fields: { title: { selector: 'h2' } } }, { emit: { success: 'RESULTS_READ', failure: 'QUERY_FAILED' } }]
 */
export type BrowserTabEffect =
    | [BrowserTabOperator, SExpr]
    | [BrowserTabOperator, SExpr, CallServiceEmitConfig];

/** The `browser/tab-*` operator names. */
export type BrowserTabOperator =
    | 'browser/tab-list'
    | 'browser/tab-open'
    | 'browser/tab-close'
    | 'browser/tab-navigate'
    | 'browser/tab-query'
    | 'browser/tab-watch'
    | 'browser/tab-unwatch'
    | 'browser/tab-apply'
    | 'browser/tab-apply-many'
    | 'browser/tab-act'
    | 'browser/tab-capture';

/** The leg of an `http` call that failed: its token-exchange grant or the authored request. */
export type HttpFailurePhase = 'grant' | 'request';

/** Public AUTH code of an `oauth` failure. */
export type HttpOAuthFailureCode = 'AUTH_ERROR' | 'VALIDATION_ERROR' | 'NOT_CONFIGURED' | 'SERVICE_ERROR' | 'NETWORK_ERROR';

/** Closed reason set of an `oauth` failure. */
export type HttpOAuthFailureReason =
  | 'state-unknown'
  | 'state-expired'
  | 'subject-mismatch'
  | 'provider-mismatch'
  | 'not-signed-in'
  | 'store-unavailable'
  | 'metadata-invalid'
  | 'response-invalid'
  | 'token-rejected'
  | 'userinfo-mismatch'
  | 'unconfigured-client';

/**
 * Failure payload of an `http` effect; `refused` = rejected before sending, `unavailable` = the host has no port
 * for a capability the call needs. `phase` names the failed leg (null for a refusal or other failure) and
 * `grantStatus`/`grantBody` the status and raw body text of a non-2xx grant reply (never a 2xx body, which carries tokens); `code`/`reason` are set only for `oauth`.
 */
export type HttpFailurePayload = {
  error: string;
  /** The call's evaluated `key` option; null when unkeyed. */
  key: string | null;
} & (
  | { kind: 'unconfigured'; credential: string; phase: HttpFailurePhase | null; grantStatus: number | null; grantBody: string | null; code: null; reason: null }
  | { kind: 'timeout' | 'failed' | 'refused' | 'unavailable'; credential: null; phase: HttpFailurePhase | null; grantStatus: number | null; grantBody: string | null; code: null; reason: null }
  | { kind: 'oauth'; credential: null; phase: null; grantStatus: null; grantBody: null; code: HttpOAuthFailureCode; reason: HttpOAuthFailureReason }
);

/** One `onMessage` delivery of an `http` effect with `stream` (json-lines: `event`/`id` null). */
export interface HttpStreamEvent {
    data: string;
    event: string | null;
    id: string | null;
    /** The call's evaluated `key` option; null when unkeyed. */
    key: string | null;
}

/**
 * Spawn effect - creates a new entity instance (games).
 * @example ['spawn', 'Bullet', { x: '@entity.x', y: '@entity.y' }]
 */
export type SpawnEffect = ['spawn', string] | ['spawn', string, EntityRow];

/**
 * Despawn effect - removes an entity instance (games).
 * @example ['despawn', '@entity.id']
 */
export type DespawnEffect = ['despawn', string];

/**
 * Do effect - executes multiple effects in sequence.
 * Uses SExpr to allow deeply nested conditionals.
 * @example ['do', ['set', '@entity.x', 0], ['set', '@entity.y', 0]]
 */
export type DoEffect = ['do', ...SExpr[]];

/**
 * Options accepted by `fetch` / `ref` / `deref` effects. Mirrors what
 * `OrbitalServerRuntime`'s fetch handler reads at runtime: `id`, `filter`,
 * `limit`, `offset`, `include`, plus the trailing `emit:` map for
 * success/failure event names.
 */
export type FetchOptions = {
    /** Fetch a single entity by ID */
    id?: string;
    /** Filter expression (S-expression) */
    filter?: SExpr;
    /** Maximum number of entities to return. The template layer may carry a
     *  binding (`'@config.pageSize'`) or a computed S-expression — the
     *  compiler's inline phase resolves it to a number. */
    limit?: number | RenderBinding | SExpr[];
    /** Number of entities to skip — same template-layer forms as `limit`. */
    offset?: number | RenderBinding | SExpr[];
    /** `"field"` or `"field:asc|desc"`, applied after the filter and before offset/limit; missing values sort last. */
    orderBy?: string | RenderBinding | SExpr[];
    /** Relations to populate (entity field names). The template layer may
     *  carry a binding (`'@config.include'`) — same as `limit`/`offset`, the
     *  compiler's inline phase resolves it to the concrete list. */
    include?: string[] | RenderBinding;
    /** `rows` (absent) delivers the rows; `ids` delivers a `RowSetMarker`, only passed whole as a `render-ui` prop. */
    deliver?: 'rows' | 'ids';
    /** `exact` (absent) counts every match for `totalCount`; `none` skips the count. */
    total?: 'exact' | 'none';
    /** Lifecycle events to emit on resolve / reject */
    emit?: { success?: string; failure?: string };
};

/**
 * Fetch effect - retrieves entity data (server-side).
 * @example ['fetch', 'User'] or ['fetch', 'User', { id: '@payload.userId' }]
 */
export type FetchEffect = ['fetch', string] | ['fetch', string, FetchOptions];

/** Options for `fetch-stream` — mirror of the compiler's `OirEffect::FetchStream`
 *  (`orbital-core/src/ir/effects.rs`) and the runtime's `fetchStream` handler. */
export type FetchStreamOptions = {
    id?: string | SExpr;
    filter?: SExpr;
    /** `on_message` fires per chunk; `success` on completion. */
    emit?: { on_message?: string; success?: string; failure?: string };
};

/**
 * Fetch-stream effect - streams entity rows (server-side), one `on_message`
 * emit per chunk. The compiled path (`OirEffect::FetchStream`) and the
 * runtime (`EffectExecutor` `'fetch-stream'`) both execute it.
 * @example ['fetch-stream', 'Message', { filter: ['=', '@entity.roomId', '@payload.roomId'], emit: { on_message: 'CHUNK' } }]
 */
export type FetchStreamEffect = ['fetch-stream', string] | ['fetch-stream', string, FetchStreamOptions];

/**
 * Result returned by a fetch / ref / deref handler.
 *
 * `rows` carries the entity (or entities) that survived `filter` AND
 * pagination (`offset`/`limit`). `total` is the count of rows that
 * matched the filter BEFORE pagination, so paginating consumers can
 * compute `totalPages = ceil(total / pageSize)` without a second
 * round-trip. Single-entity fetches by id return `total: 1` (or `0`
 * if not found, in which case the handler returns `null` instead).
 */
export interface FetchResult {
    rows: EntityRow | EntityRow[];
    total: number;
}

/**
 * If effect - conditional effect execution.
 * Uses SExpr to allow deeply nested conditionals.
 * @example ['if', ['>', '@entity.health', 0], ['emit', 'ALIVE'], ['emit', 'DEAD']]
 */
export type IfEffect = ['if', Expression, SExpr] | ['if', Expression, SExpr, SExpr];

/**
 * When effect - conditional effect similar to if but without else.
 * Uses SExpr to allow deeply nested conditionals.
 * @example ['when', ['>', '@entity.health', 0], ['emit', 'ALIVE']]
 */
export type WhenEffect = ['when', Expression, SExpr];

/**
 * Let effect - creates local bindings for effects.
 * Uses SExpr to allow deeply nested conditionals.
 * @example ['let', ['temp', ['get', '@payload.value']], ['set', '@entity.value', 'temp']]
 */
export type LetEffect = ['let', [string, SExpr][], ...SExpr[]];

/**
 * Log effect - logs a message for debugging.
 * @example ['log', 'User created:', '@entity.name']
 */
export type LogEffect = ['log', ...SExpr[]];

/**
 * Wait effect - delays execution.
 * @example ['wait', 1000] - wait 1 second
 */
export type WaitEffect = ['wait', number];

// ============================================================================
// Resource Effects (reactive entity subscriptions and atomic operations)
// ============================================================================

/**
 * Ref effect - creates a reactive entity subscription.
 * Returns a reactive reference that auto-updates when the entity changes.
 * @example ['ref', '@entity.health'] - reactive subscription to health
 * @example ['ref', 'User', { id: '@payload.userId' }] - reactive ref to specific user
 */
export type RefEffect =
    | ['ref', string]
    | ['ref', string, FetchOptions];

/**
 * Deref effect - snapshot read of an entity value.
 * Returns the current value without subscribing to changes.
 * @example ['deref', '@entity.health'] - read current health value
 * @example ['deref', 'User', { id: '@payload.userId' }] - read specific user snapshot
 */
export type DerefEffect =
    | ['deref', string]
    | ['deref', string, FetchOptions];

/**
 * Swap! effect - atomic compare-and-swap on an entity field.
 * Only updates if the current value matches the expected value.
 * @example ['swap', '@entity.health', ['fn', ['old'], ['-', 'old', '@payload.damage']]]
 * @example ['swap', '@entity.counter', ['+', '@entity.counter', 1]]
 */
export type SwapEffect = ['swap', string, SExpr];

/**
 * Options accepted by `watch` effects. Mirrors what the runtime reads when
 * registering the change callback: `debounce` and the trailing `emit:` map.
 */
export type WatchOptions = {
    /** Debounce duration in milliseconds */
    debounce?: number;
    /** Lifecycle events to emit on update / failure */
    emit?: { on_message?: string; failure?: string };
};

/**
 * Watch effect - registers a callback for entity changes.
 * Emits an event whenever the watched binding changes.
 * @example ['watch', '@entity.health', 'HEALTH_CHANGED']
 * @example ['watch', '@entity.status', 'STATUS_UPDATED', { debounce: 100 }]
 */
export type WatchEffect =
    | ['watch', string, string]
    | ['watch', string, string, WatchOptions];

/**
 * Atomic effect - groups multiple effects into an atomic transaction.
 * All effects either succeed together or are rolled back.
 * @example ['atomic', ['set', '@entity.x', 10], ['set', '@entity.y', 20]]
 * @example ['atomic', ['persist', 'update', 'User', { balance: 100 }], ['emit', 'BALANCE_UPDATED']]
 */
export type AtomicEffect = ['atomic', ...SExpr[]];

// ============================================================================
// ML Effects (from almadar-std/modules/nn, tensor, train)
// ============================================================================

/**
 * One layer in an NN architecture description. The set of valid layer kinds
 * lives in `almadar-std/modules/nn`; here we keep the wire shape generic
 * enough for the cross-package runtime + Python bridge to round-trip.
 */
export type NnLayer = {
    type: string;
    [key: string]: string | number | boolean | number[] | string[] | undefined;
};

/**
 * Hyperparameters for `train` and `evaluate`. Recursive to allow nested
 * optimizer / scheduler config blocks without falling back to `unknown`.
 */
export type NnConfig = {
    [key: string]: string | number | boolean | string[] | number[] | NnConfig | undefined;
};

/**
 * Forward-pass config: `input` is a binding string (`@payload.input`), and
 * `on-complete` names the event to fire when the prediction lands.
 */
export type ForwardConfig = {
    architecture: NnLayer[];
    input: string;
    'on-complete'?: string;
    config?: NnConfig;
};

/**
 * Training-loop config. `dataset` is a binding string referencing the rows
 * to train on. Optimizer / loss / scheduler land inside `config`.
 */
export type TrainConfig = {
    architecture: NnLayer[];
    dataset: string;
    config?: NnConfig;
    'on-complete'?: string;
};

/**
 * Evaluation config. `metrics` lists named metrics the Python backend
 * computes (`accuracy`, `precision`, ...).
 */
export type EvaluateConfig = {
    architecture: NnLayer[];
    dataset: string;
    metrics: string[];
    config?: NnConfig;
    'on-complete'?: string;
};

/**
 * Forward effect - runs a neural network forward pass (Python backend).
 * @example ['forward', 'primary', { architecture: [...], input: '@payload.input', 'on-complete': 'PREDICTION_READY' }]
 */
export type ForwardEffect = ['forward', string, ForwardConfig];

/**
 * Train effect - runs a training loop (Python backend).
 * @example ['train', { architecture: [...], dataset: '@entity.data', config: { epochs: 10 }, 'on-complete': 'TRAINING_DONE' }]
 */
export type TrainEffect = ['train', TrainConfig];

/**
 * Evaluate effect - runs model evaluation (Python backend).
 * @example ['evaluate', { architecture: [...], dataset: '@entity.testData', metrics: ['accuracy'], 'on-complete': 'EVAL_DONE' }]
 */
export type EvaluateEffect = ['evaluate', EvaluateConfig];

/**
 * Checkpoint save effect - saves model weights.
 * @example ['checkpoint/save', '/path/to/model.pt', '@entity.weights']
 */
export type CheckpointSaveEffect = ['checkpoint/save', string, SExpr];

/**
 * Checkpoint load effect - loads model weights.
 * @example ['checkpoint/load', '/path/to/model.pt']
 */
export type CheckpointLoadEffect = ['checkpoint/load', string];

// ============================================================================
// Agent Effects (from agent/* operator namespace)
// ============================================================================

/**
 * Agent effect - invokes an agent/* operator.
 * Covers all 22 operators in the std-agent category.
 * @example ['agent/memorize', 'use data-grid for tables', 'preference']
 * @example ['agent/recall', 'user preferences']
 * @example ['agent/generate', 'Summarize this schema']
 */
export type AgentEffect = [`agent/${string}`, ...SExpr[]];

/**
 * OS effect - invokes an os/* operator.
 *
 * The `os/` family declared in `@almadar/std` (`modules/os.ts`): one-shot operations and
 * streams that answer through a trailing `EmitConfig` block.
 *
 * @example ['os/read-file', '/etc/hosts', { emit: { success: 'FILE_READ', failure: 'READ_FAILED' } }]
 */
export type OsEffect = [`os/${string}`, ...SExpr[]];

/**
 * Browser effect - invokes a browser/* device operator (client host path).
 * User-initiated, async, resolves via the standard trailing emit envelope.
 * Concrete operators (browser/open-file-picker, browser/clipboard-read,
 * browser/clipboard-write, browser/geolocation-current) and their arity /
 * payload shapes live in @almadar/std BROWSER_OPERATORS.
 * @example ['browser/open-file-picker', { multiple: false }, { emit: { success: 'FILES_PICKED', failure: 'PICK_CANCELLED' } }]
 */
export type BrowserEffect = [`browser/${string}`, ...SExpr[]];

/**
 * LLM effect - invokes an llm/* operator (agent path).
 * @example ['llm/generate', '@entity.request', { emit: { success: 'PLANNED', failure: 'PLAN_FAILED' } }]
 */
export type LlmEffect = [`llm/${string}`, ...SExpr[]];

/**
 * Behavior reflection effects: list installed behaviors by registry folder,
 * describe a trait value, read a behavior's source. They read the host's
 * installed packages through `orb`, so they run on the server.
 * @example ['behavior/catalog', { paths: ['std/ui/core/molecules'] }, { emit: { success: 'LISTED', failure: 'LIST_FAILED' } }]
 */
export type BehaviorReflectionEffect = ['behavior/catalog' | 'behavior/describe' | 'behavior/source' | 'behavior/resolve' | 'behavior/dependencies', ...SExpr[]];

/**
 * Program effects: read `.lolo` text into a quoted program, print one back,
 * evaluate one (validate, then instantiate). Run `orb` on the server.
 * @example ['program/eval', '@entity.program', { emit: { success: 'BUILT', failure: 'BUILD_FAILED' } }]
 */
export type ProgramEffect = ['program/read' | 'program/print' | 'program/eval' | 'program/validate' | 'program/compose' | 'program/step' | 'program/live', ...SExpr[]];

/**
 * Agent-port effects, the three abilities an LLM tool loop is written with: `program/inputs` lists the
 * running program's declared external inputs, `program/dispatch` fires one AS THE CALLER through the ordinary
 * dispatch (guards, grants and policies apply), `persist/read-named` reads an entity named at run time through
 * its `@read` policy for the caller. Success carries `{ result }`, failure `{ error, errors? }`.
 * @example ['program/dispatch', '@payload.address', '@payload.arguments', { emit: { success: 'DISPATCHED', failure: 'DISPATCH_FAILED' } }]
 */
export type AgentPortEffect = ['program/inputs' | 'program/dispatch' | 'persist/read-named', ...SExpr[]];

/**
 * Remaining agent-path operator effects: session/* (workspace session ops),
 * trace/* (trace emission), memory/* (agent memory), application/* (app
 * lifecycle). Expression-only namespaces (array/, math/, object/, str/, …)
 * are deliberately NOT effect heads.
 * @example ['session/write-spec', '@entity.spec']
 */
export type SessionEffect = [`session/${string}`, ...SExpr[]];
export type TraceEffect = [`trace/${string}`, ...SExpr[]];
export type MemoryEffect = [`memory/${string}`, ...SExpr[]];
export type ApplicationEffect = [`application/${string}`, ...SExpr[]];

/** Effect operators the std registry declares that had no typed tuple (arity from the registry). */
export type NotifyEffect = ['notify', SExpr] | ['notify', SExpr, SExpr];
export type SendServerEffect = ['send-server', SExpr] | ['send-server', SExpr, SExpr];
export type NnSetWeightsEffect = ['nn/setWeights', SExpr, SExpr];
export type TrainLoopEffect = ['train/loop', SExpr, SExpr, SExpr];
export type TrainStepEffect = ['train/step', SExpr, SExpr, SExpr, SExpr];
export type TrainClipGradientsEffect = ['train/clipGradients', SExpr, SExpr];
export type TrainClipWeightsEffect = ['train/clipWeights', SExpr, SExpr];
export type TrainSgdEffect = ['train/sgd', SExpr, SExpr] | ['train/sgd', SExpr, SExpr, SExpr];
export type TrainAdamEffect = ['train/adam', SExpr, SExpr] | ['train/adam', SExpr, SExpr, SExpr] | ['train/adam', SExpr, SExpr, SExpr, SExpr];
export type ProbSeedEffect = ['prob/seed', SExpr];
export type ProbConditionEffect = ['prob/condition', SExpr];
export type WorkspaceWriteOrbitalEffect = ['workspace/write-orbital', SExpr, SExpr];
export type WorkspaceWriteFileEffect = ['workspace/write-file', SExpr, SExpr];
export type WorkspaceWriteSchemaEffect = ['workspace/write-schema', SExpr];
export type WorkspaceWritePlanEffect = ['workspace/write-plan', SExpr];
export type WorkspaceArchiveOrbitalEffect = ['workspace/archive-orbital', SExpr];

/**
 * Union of all typed effects.
 * Provides compile-time validation for common effect types.
 */
export type TypedEffect =
    | RenderUIEffect
    | NavigateEffect
    | NavigateBackEffect
    | EmitEffect
    | SetEffect
    | PersistEffect
    | CallServiceEffect
    | CancelCallEffect
    | RandomBytesEffect
    | CredentialStatusEffect
    | CredentialForgetEffect
    | CredentialAdminEffect
    | AccessCheckEffect
    | OAuthAuthorizeEffect
    | OAuthConnectionStatusEffect
    | OAuthConnectionForgetEffect
    | HttpEffect
    | RedisEffect
    | PostgresEffect
    | SpawnEffect
    | DespawnEffect
    | DoEffect
    | FetchEffect
    | FetchStreamEffect
    | IfEffect
    | WhenEffect
    | LetEffect
    | LogEffect
    | WaitEffect
    | RefEffect
    | DerefEffect
    | SwapEffect
    | WatchEffect
    | AtomicEffect
    | ForwardEffect
    | TrainEffect
    | EvaluateEffect
    | CheckpointSaveEffect
    | CheckpointLoadEffect
    | AgentEffect
    | OsEffect
    | BrowserEffect
    | LlmEffect
    | BehaviorReflectionEffect
    | ProgramEffect
    | AgentPortEffect
    | SessionEffect
    | TraceEffect
    | MemoryEffect
    | ApplicationEffect
    | NotifyEffect
    | SendServerEffect
    | NnSetWeightsEffect
    | TrainLoopEffect
    | TrainStepEffect
    | TrainClipGradientsEffect
    | TrainClipWeightsEffect
    | TrainSgdEffect
    | TrainAdamEffect
    | ProbSeedEffect
    | ProbConditionEffect
    | WorkspaceWriteOrbitalEffect
    | WorkspaceWriteFileEffect
    | WorkspaceWriteSchemaEffect
    | WorkspaceWritePlanEffect
    | WorkspaceArchiveOrbitalEffect;

// ============================================================================
// Effect Type (Strictly Typed)
// ============================================================================

/**
 * Effect type - typed S-expression format.
 *
 * Effects are strongly typed tuples that enforce:
 * - Valid effect operators (render-ui, emit, set, persist, navigate, call-service)
 * - Valid UISlots for render-ui
 * - Valid PatternTypes and props for render-ui
 * - Correct argument types for each effect
 *
 * Available typed effects:
 * - RenderUIEffect: ['render-ui', UISlot, PatternConfig]
 * - NavigateEffect: ['navigate', path] or ['navigate', path, params]
 * - EmitEffect: ['emit', eventName] or ['emit', eventName, payload]
 * - SetEffect: ['set', binding, value]
 * - PersistEffect: ['persist', operation, entity, data?]
 * - CallServiceEffect: ['call-service', serviceName, config]
 *
 * @example
 * ["set", "@entity.health", 100]
 * ["emit", "PLAYER_DIED", { "playerId": "@entity.id" }]
 * ["render-ui", "main", { "patternType": "table-view", "columns": [{ "key": "name", "header": "Name" }] }]
 * ["call-service", "WeatherAPI", { "action": "getWeather", "onSuccess": "OK" }]
 * ["navigate", "/tasks"]
 * ["persist", "create", "Task", { "title": "@payload.title" }]
 */
export type Effect = TypedEffect;

/** Every literal effect operator the {@link Effect} union declares, as runtime data. */
export const EFFECT_OPERATORS = [
  'render-ui', 'navigate', 'navigate-back', 'emit', 'set', 'persist', 'call-service', 'cancel-call', 'random-bytes', 'credential-status', 'credential-forget', 'credential-list', 'credential-set', 'credential-remove', 'credential-test', 'credential-mode', 'credential-rotate', 'access-check', 'oauth-authorize', 'oauth-connection-status', 'oauth-connection-forget', 'http', 'redis', 'postgres', 'spawn',
  'despawn', 'do', 'fetch', 'fetch-stream', 'if', 'when', 'let', 'log', 'wait', 'ref', 'deref',
  'swap', 'watch', 'atomic', 'forward', 'train', 'evaluate', 'checkpoint/save',
  'checkpoint/load', 'notify', 'send-server', 'nn/setWeights',
  'train/loop', 'train/step', 'train/clipGradients', 'train/clipWeights', 'train/sgd',
  'train/adam', 'prob/seed', 'prob/condition', 'workspace/write-orbital', 'workspace/write-file',
  'workspace/write-schema', 'workspace/write-plan', 'workspace/archive-orbital', 'behavior/catalog',
  'behavior/describe', 'behavior/source', 'behavior/resolve', 'behavior/dependencies', 'program/read', 'program/print', 'program/eval', 'program/validate', 'program/compose', 'program/step',
  'program/inputs', 'program/dispatch', 'program/live', 'persist/read-named',
] as const;

/** Namespaced effect families (`<family>/<name>`, e.g. `llm/generate`) the {@link Effect} union declares. */
export const EFFECT_OPERATOR_FAMILIES = [
  'agent', 'os', 'browser', 'llm', 'session', 'trace', 'memory',
  'application',
] as const;

export type EffectOperator = (typeof EFFECT_OPERATORS)[number];
export type EffectOperatorFamily = (typeof EFFECT_OPERATOR_FAMILIES)[number];

type EffectHead = Effect[0];
type FamilyOfHead<H> = H extends `${infer P}/${string}` ? (`${P}/\u0000` extends H ? P : never) : never;
type LiteralOfHead<H> = H extends `${infer P}/${string}` ? (`${P}/\u0000` extends H ? never : H) : H;
type AssertTrue<T extends true> = T;
/** Fails to compile when the runtime lists and the {@link Effect} union drift apart, in either direction. */
export type EffectOperatorsInSync = AssertTrue<
  [Exclude<LiteralOfHead<EffectHead>, EffectOperator>, Exclude<EffectOperator, LiteralOfHead<EffectHead>>,
   Exclude<FamilyOfHead<EffectHead>, EffectOperatorFamily>, Exclude<EffectOperatorFamily, FamilyOfHead<EffectHead>>] extends [never, never, never, never]
    ? true : false
>;

/**
 * The effects a server reports an outcome for on
 * `OrbitalEventResponse.effectResults` (`ServerEffectResult.effect`). Every
 * member is checked against the effect heads above at compile time, so a
 * name that is not an effect cannot be listed and a new server-reported
 * effect is added HERE only — the wire type, its zod twin and the
 * `events-wire` fixture case all derive from this array.
 */
export const SERVER_REPORTED_EFFECTS = [
    'set',
    'persist',
    'call-service',
    'http',
    'fetch',
    'fetch-stream',
    'ref',
    'deref',
    'swap',
    'atomic',
    'emit',
] as const satisfies readonly Effect[0][];

export type ServerReportedEffect = (typeof SERVER_REPORTED_EFFECTS)[number];

/** A namespaced effect head (`trace/emit`, `memory/store`, `llm/…`) — what a
 *  `substrate` result's `name` carries. Derived from the union, never listed. */
export type NamespacedEffectName = Extract<Effect[0], `${string}/${string}`>;

/**
 * Schema for Effect - validates S-expression format. Arguments validate as
 * s-expr-shaped DATA (`SExprDataSchema`) — literal data arrays (empty or
 * non-operator-headed) are valid argument values; the operator-head refine
 * applies to the effect itself, not to every argument.
 */
const EffectShapeSchema = z.array(SExprDataSchema).min(1).refine(
    (arr) => typeof arr[0] === 'string',
    { message: 'Effect must be an S-expression with a string operator as first element' }
);

/** Validates the S-expression shape and yields the typed `Effect` (the claim `isEffect` makes). */
export const EffectSchema: z.ZodType<Effect> = z.custom<Effect>(
    (value) => EffectShapeSchema.safeParse(value).success,
    { message: 'Effect must be an S-expression with a string operator as first element' }
);

export type EffectInput = z.input<typeof EffectSchema>;

/**
 * Type guard to check if a value is a valid Effect (S-expression).
 * 
 * Validates that a value conforms to the Effect structure. Effects are
 * represented as arrays where the first element is a string (effect type)
 * and subsequent elements are parameters. Used for runtime validation
 * of effect structures.
 * 
 * @param {RuntimeValue} value - Value to check
 * @returns {boolean} True if value is a valid Effect, false otherwise
 *
 * @example
 * isEffect(['set', '@entity.health', 100]); // returns true
 * isEffect('not-an-effect'); // returns false
 * isEffect([]); // returns false
 */
export function isEffect(value: RuntimeValue): value is Effect {
    return Array.isArray(value) && value.length > 0 && typeof value[0] === 'string';
}

/**
 * Alias for isEffect (for clarity when working with S-expressions)
 */
export const isSExprEffect = isEffect;

// ============================================================================
// Effect Builder Helpers
// ============================================================================

/**
 * Creates a set effect for state updates.
 * 
 * Generates an effect that sets a binding to a value. Used in state
 * machine transitions to update entity fields, UI state, or other
 * mutable data.
 * 
 * @param {string} binding - Target binding (e.g., '@entity.health')
 * @param {SExpr} value - Value to set (can be literal or expression)
 * @returns {Effect} Set effect array
 * 
 * @example
 * set('@entity.health', 100); // returns ["set", "@entity.health", 100]
 * set('@state.loading', false); // returns ["set", "@state.loading", false]
 */
export function set(binding: string, value: SExpr): Effect {
    return ['set', binding, value];
}

/**
 * Creates an emit effect for event dispatching.
 * 
 * Generates an effect that emits an event with optional payload.
 * Used in state machine transitions to trigger events that can be
 * handled by other traits, services, or external systems.
 * 
 * @param {string} event - Event name to emit
 * @param {EventPayload} [payload] - Optional event payload
 * @returns {Effect} Emit effect array
 * 
 * @example
 * emit('PLAYER_DIED', { playerId: '@entity.id' }); // returns ["emit", "PLAYER_DIED", { playerId: "@entity.id" }]
 * emit('GAME_STARTED'); // returns ["emit", "GAME_STARTED"]
 */
export function emit(event: string, payload?: EventPayload): Effect {
    return payload ? ['emit', event, payload] : ['emit', event];
}

/**
 * Creates a navigation effect for page routing.
 * 
 * Generates an effect that navigates to a specified path with optional
 * parameters. Used in state machine transitions to change pages or
 * update URL parameters.
 * 
 * @param {string} path - Target path (e.g., '/tasks')
 * @param {Record<string, string>} [params] - Optional URL parameters
 * @returns {NavigateEffect} Navigation effect array
 * 
 * @example
 * navigate('/tasks'); // returns ["navigate", "/tasks"]
 * navigate('/user', { id: '123' }); // returns ["navigate", "/user", { id: "123" }]
 */
export function navigate(path: string): NavigateEffect;
export function navigate(path: string, params: Record<string, string>): NavigateEffect;
export function navigate(path: string, params: Record<string, string>, options: NavigateOptions): NavigateEffect;
export function navigate(path: string, params?: Record<string, string>, options?: NavigateOptions): NavigateEffect {
    if (params && options) return ['navigate', path, params, options];
    return params ? ['navigate', path, params] : ['navigate', path];
}

/**
 * Creates a navigate-back effect: pop the orbital's navigation stack and
 * navigate to the previous entry.
 *
 * @example
 * navigateBack(); // returns ["navigate-back"]
 */
export function navigateBack(): NavigateBackEffect {
    return ['navigate-back'];
}

/**
 * Create a render-ui effect
 * @example ["render-ui", "main", { "patternType": "table-view", "columns": [{ "key": "name", "header": "Name" }] }]
 */
export function renderUI(target: UISlot, pattern: AnyPatternConfig): RenderUIEffect {
    return ['render-ui', target, pattern];
}

/**
 * Create a persist effect
 * @example ["persist", "create", "Task", { "title": "@payload.title" }]
 */
export function persist(
    action: 'create' | 'upsert' | 'update',
    entity: string,
    data: PersistData
): PersistEffect;
export function persist(
    action: 'delete' | 'clear',
    entity: string,
    data?: PersistData
): PersistEffect;
export function persist(
    action: 'create' | 'upsert' | 'update' | 'delete' | 'clear',
    entity: string,
    data?: PersistData
): PersistEffect {
    if (action === 'create' || action === 'upsert' || action === 'update') {
        return ['persist', action, entity, data!] as PersistEffect;
    }
    return data
        ? ['persist', action, entity, data] as PersistEffect
        : ['persist', action, entity] as PersistEffect;
}

/**
 * Create a call-service effect
 * @example ["call-service", "my-service", { "service": "my-service", "action": "run", "onSuccess": "OK", "onError": "ERR" }]
 */
export function callService(
    serviceName: string,
    config: CallServiceConfig
): CallServiceEffect {
    return ['call-service', serviceName, config];
}

/**
 * Create a spawn effect (games)
 * @example ["spawn", "Bullet", { "x": "@entity.x", "y": "@entity.y" }]
 */
export function spawn(entity: string): SpawnEffect;
export function spawn(entity: string, initialState: EntityRow): SpawnEffect;
export function spawn(entity: string, initialState?: EntityRow): SpawnEffect {
    return initialState ? ['spawn', entity, initialState] : ['spawn', entity];
}

/**
 * Create a despawn effect (games)
 * @example ["despawn", "@entity.id"]
 */
export function despawn(entityId: string): DespawnEffect {
    return ['despawn', entityId];
}

/**
 * Create a do effect (multiple effects)
 * @example ["do", ["set", "@entity.x", 0], ["set", "@entity.y", 0]]
 */
export function doEffects(...effects: SExpr[]): DoEffect {
    return ['do', ...effects];
}

/**
 * Create a fetch effect (server-side data retrieval)
 * @example ["fetch", "User"] - fetch all users
 * @example ["fetch", "User", { "id": "@payload.userId" }] - fetch by ID
 * @example ["fetch", "User", { "filter": ["=", "@entity.status", "active"], "limit": 10 }]
 */
export function fetch(entity: string): FetchEffect;
export function fetch(entity: string, options: FetchOptions): FetchEffect;
export function fetch(entity: string, options?: FetchOptions): FetchEffect {
    return options ? ['fetch', entity, options] : ['fetch', entity];
}

// ============================================================================
// Resource Effect Builder Helpers
// ============================================================================

/**
 * Create a ref effect (reactive entity subscription).
 *
 * @param {string} binding - Binding or entity name to subscribe to
 * @param {FetchOptions} [selector] - Optional selector for specific entity
 * @returns {RefEffect} Ref effect array
 *
 * @example
 * ref('@entity.health'); // returns ["ref", "@entity.health"]
 * ref('User', { id: '@payload.userId' }); // returns ["ref", "User", { id: "@payload.userId" }]
 */
export function ref(binding: string): RefEffect;
export function ref(binding: string, selector: FetchOptions): RefEffect;
export function ref(binding: string, selector?: FetchOptions): RefEffect {
    return selector ? ['ref', binding, selector] : ['ref', binding];
}

/**
 * Create a deref effect (snapshot read).
 *
 * @param {string} binding - Binding or entity name to read
 * @param {FetchOptions} [selector] - Optional selector for specific entity
 * @returns {DerefEffect} Deref effect array
 *
 * @example
 * deref('@entity.health'); // returns ["deref", "@entity.health"]
 * deref('User', { id: '@payload.userId' }); // returns ["deref", "User", { id: "@payload.userId" }]
 */
export function deref(binding: string): DerefEffect;
export function deref(binding: string, selector: FetchOptions): DerefEffect;
export function deref(binding: string, selector?: FetchOptions): DerefEffect {
    return selector ? ['deref', binding, selector] : ['deref', binding];
}

/**
 * Create a swap effect (atomic compare-and-swap).
 *
 * @param {string} binding - Binding to atomically update
 * @param {SExpr} transform - Transformation expression applied to the current value
 * @returns {SwapEffect} Swap effect array
 *
 * @example
 * swap('@entity.counter', ['+', '@entity.counter', 1]);
 * // returns ["swap", "@entity.counter", ["+", "@entity.counter", 1]]
 */
export function swap(binding: string, transform: SExpr): SwapEffect {
    return ['swap', binding, transform];
}

/**
 * Create a watch effect (entity change callback).
 *
 * @example
 * watch('@entity.health', 'HEALTH_CHANGED');
 * watch('@entity.status', 'STATUS_UPDATED', { debounce: 100 });
 */
export function watch(binding: string, event: string): WatchEffect;
export function watch(binding: string, event: string, options: WatchOptions): WatchEffect;
export function watch(binding: string, event: string, options?: WatchOptions): WatchEffect {
    return options
        ? ['watch', binding, event, options]
        : ['watch', binding, event];
}

/**
 * Create an atomic effect (transaction group).
 *
 * @param {...SExpr[]} effects - Effects to execute atomically
 * @returns {AtomicEffect} Atomic effect array
 *
 * @example
 * atomic(['set', '@entity.x', 10], ['set', '@entity.y', 20]);
 * // returns ["atomic", ["set", "@entity.x", 10], ["set", "@entity.y", 20]]
 */
export function atomic(...effects: SExpr[]): AtomicEffect {
    return ['atomic', ...effects];
}

// ============================================================================
// Runtime Pattern Types
// ============================================================================

/** Resolved pattern props for render-ui effects at runtime. Recursive for nested pattern configs. */
export type ResolvedPatternProps = {
  [prop: string]:
    | string
    | number
    | boolean
    | null
    | undefined
    | ResolvedPatternProps
    | RenderChildrenMap
    | Array<ResolvedPatternProps | RenderChildrenMap>;
};

/**
 * Zod twin of `PatternConfig`/`AnyPatternConfig` — validates the WIRE SHAPE
 * (a plain object, or `null` for an unset render-ui target) only. Per-pattern
 * prop shape (the hundreds of generated `PatternPropsMap` variants) is
 * enforced by the patterns registry at `orb validate` / lolo parse time, not
 * re-validated here — a second, drifting copy of that registry is exactly
 * the duplicate this schema must not become.
 */
export const PatternConfigSchema: z.ZodType<AnyPatternConfig | null> = z.custom<AnyPatternConfig | null>(
    (value) => value === null || (typeof value === 'object' && value !== null && !Array.isArray(value)),
    { message: 'Expected a pattern config object or null' },
);

/** A pattern config that must be present — the non-null twin of {@link PatternConfigSchema}. */
export const PatternObjectSchema: z.ZodType<AnyPatternConfig> = z.custom<AnyPatternConfig>(
    (value) => typeof value === 'object' && value !== null && !Array.isArray(value),
    { message: 'Expected a pattern config object' },
);

/** Zod twin of `ResolvedPatternProps` — validates the wire shape (a plain object) only, see {@link PatternConfigSchema}. */
export const ResolvedPatternPropsSchema: z.ZodType<ResolvedPatternProps> = z.custom<ResolvedPatternProps>(
    (value) => typeof value === 'object' && value !== null && !Array.isArray(value),
    { message: 'Expected a resolved pattern props object' },
);

/** A node in a render-ui effect tree. */
export interface RenderUINode {
  type: string;
  props?: ResolvedPatternProps;
  /** Static child nodes and/or dynamic-collection map entries. A
   *  {@link RenderChildrenMap} entry expands at render time into resolved
   *  `RenderUINode`s, so components always receive a flat, fully-resolved list. */
  children?: Array<RenderUINode | RenderChildrenMap>;
  content?: string;
  entity?: string;
  renderItem?: RenderUINode;
}


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
 * | `fetch-stream`   | `on_message`, `success`, `failure` |
 *
 * Payload convention:
 * - `success`             → the effect's result (fetched entity, new value)
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

/** Request parts of an `http` effect: query, headers, at most one body, auth, retry, timeouts, response and stream options. */
export type HttpRequestParts = { [part: string]: SExpr };

/**
 * Http effect - `(http METHOD origin path request? options?)`. The origin must be declared in the app's egress;
 * credentials are host-resolved secret knobs. Success carries `{ status, headers, body, key }`. Server-only.
 * @example ['http', 'GET', 'https://api.example.com', '/items', { query: { limit: 10 } }, { emit: { success: 'ITEMS_LOADED', failure: 'ITEMS_FAILED' } }]
 */
export type HttpEffect =
    | ['http', SExpr, SExpr, SExpr]
    | ['http', SExpr, SExpr, SExpr, HttpRequestParts]
    | ['http', SExpr, SExpr, SExpr, HttpRequestParts, CallServiceEmitConfig];

/** The OAuth client an `oauth-authorize` names: tag, mode, issuer XOR endpoints, secret-knob client credentials, clientAuth. */
export type OAuthClient = { [field: string]: SExpr };

/** Authorization request of `oauth-authorize`. */
export interface OAuthAuthorizeRequest {
    redirectUri: SExpr;
    scope?: SExpr;
    subject?: SExpr;
    params?: SExpr;
}

/**
 * OAuth-authorize effect - starts an authorization for a client; success carries `{ authUrl, state, code }`. Server-only.
 * @example ['oauth-authorize', { tag: 'google', mode: 'real' }, { redirectUri: 'https://app.example.com/cb', scope: ['openid'] }, { emit: { success: 'AUTH_URL' } }]
 */
export type OAuthAuthorizeEffect =
    | ['oauth-authorize', OAuthClient, OAuthAuthorizeRequest]
    | ['oauth-authorize', OAuthClient, OAuthAuthorizeRequest, HostCallEmitConfig & { key?: SExpr }];

/**
 * OAuth-connection-status effect - the signed-in viewer's connection to a provider (google, github or auth0).
 * @example ['oauth-connection-status', 'google', { emit: { success: 'CONNECTION' } }]
 */
export type OAuthConnectionStatusEffect =
    | ['oauth-connection-status', SExpr]
    | ['oauth-connection-status', SExpr, HostCallEmitConfig];

/**
 * OAuth-connection-forget effect - drops the signed-in viewer's connection to a provider.
 * @example ['oauth-connection-forget', 'google', { emit: { success: 'DISCONNECTED' } }]
 */
export type OAuthConnectionForgetEffect =
    | ['oauth-connection-forget', SExpr]
    | ['oauth-connection-forget', SExpr, HostCallEmitConfig];

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

export type CallServiceEffect =
    | ['call-service', string, string]
    | ['call-service', string, string, ServiceParams]
    | ['call-service', string, string, ServiceParams, CallServiceEmitConfig]
    | ['call-service', string, CallServiceConfig];

/** A page fact `browser/page-facts` can read; the list order is the read order. */
export type PageFactField = 'hostname' | 'referrer' | 'screenWidth' | 'href';

/** Success payload of `browser/page-facts`: a fact that was not requested carries its default. */
export interface BrowserPageFacts {
    /** False when there is no page (no window or document). */
    available: boolean;
    hostname: string;
    referrer: string;
    screenWidth: number | null;
    /** The full URL of the current location; empty when it was not requested or there is no page. */
    href: string;
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
/** Public AUTH code of an `oauth` failure. */
/** Closed reason set of an `oauth` failure. */
/**
 * Failure payload of an `http` effect; `refused` = rejected before sending, `unavailable` = the host has no port
 * for a capability the call needs. `phase` names the failed leg (null for a refusal or other failure) and
 * `grantStatus`/`grantBody` the status and raw body text of a non-2xx grant reply (never a 2xx body, which carries tokens); `code`/`reason` are set only for `oauth`.
 */
/** One `onMessage` delivery of an `http` effect with `stream` (json-lines: `event`/`id` null). */
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
 * Options accepted by `fetch` effects. Mirrors what
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
 * Result returned by a fetch handler.
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
export type BehaviorReflectionEffect = ['behavior/catalog' | 'behavior/describe' | 'behavior/source' | 'behavior/resolve' | 'behavior/dependencies' | 'behavior/packages', ...SExpr[]];

/**
 * Program effects: read `.lolo` text into a quoted program, print one back,
 * evaluate one (validate, then instantiate). Run `orb` on the server.
 * @example ['program/eval', '@entity.program', { emit: { success: 'BUILT', failure: 'BUILD_FAILED' } }]
 */
export type ProgramEffect = ['program/read' | 'program/print' | 'program/eval' | 'program/validate' | 'program/prove' | 'program/os-grants' | 'program/compose' | 'program/step' | 'program/live' | 'program/self' | 'program/tick' | 'program/resolve-rows', ...SExpr[]];

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
export type KvEffect = [`kv/${string}`, ...SExpr[]];
export type ApplicationEffect = [`application/${string}`, ...SExpr[]];
export type AudioEffect = [`audio/${string}`, ...SExpr[]];
export type AuthEffect = [`auth/${string}`, ...SExpr[]];

/** Effect operators the std registry declares that had no typed tuple (arity from the registry). */
export type NotifyEffect = ['notify', SExpr] | ['notify', SExpr, SExpr];
export type SendServerEffect = ['send-server', SExpr] | ['send-server', SExpr, SExpr];
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
    | HttpEffect
    | OAuthAuthorizeEffect
    | OAuthConnectionStatusEffect
    | OAuthConnectionForgetEffect
    | RandomBytesEffect
    | CredentialStatusEffect
    | CredentialForgetEffect
    | CredentialAdminEffect
    | AccessCheckEffect
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
    | KvEffect
    | ApplicationEffect
    | AudioEffect
    | AuthEffect
    | NotifyEffect
    | SendServerEffect
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
  'render-ui', 'navigate', 'navigate-back', 'emit', 'set', 'persist', 'call-service', 'cancel-call', 'http', 'oauth-authorize', 'oauth-connection-status', 'oauth-connection-forget', 'random-bytes', 'credential-status', 'credential-forget', 'credential-list', 'credential-set', 'credential-remove', 'credential-test', 'credential-mode', 'credential-rotate', 'access-check', 'spawn',
  'despawn', 'do', 'fetch', 'fetch-stream', 'if', 'when', 'let', 'log', 'wait',
  'notify', 'send-server',
  'prob/seed', 'prob/condition', 'workspace/write-orbital', 'workspace/write-file',
  'workspace/write-schema', 'workspace/write-plan', 'workspace/archive-orbital', 'behavior/catalog',
  'behavior/describe', 'behavior/source', 'behavior/resolve', 'behavior/dependencies', 'behavior/packages', 'program/read', 'program/print', 'program/eval', 'program/validate', 'program/prove', 'program/os-grants', 'program/compose', 'program/step',
  'program/inputs', 'program/dispatch', 'program/live', 'program/self', 'program/tick', 'program/resolve-rows', 'persist/read-named',
] as const;

/** Namespaced effect families (`<family>/<name>`, e.g. `llm/generate`) the {@link Effect} union declares. */
export const EFFECT_OPERATOR_FAMILIES = [
  'agent', 'os', 'browser', 'llm', 'session', 'trace', 'memory', 'kv',
  'application', 'audio', 'auth',
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
 * `EventResponse.effectResults` (`ServerEffectResult.effect`). Every
 * member is checked against the effect heads above at compile time, so a
 * name that is not an effect cannot be listed and a new server-reported
 * effect is added HERE only — the wire type, its zod twin and the
 * `events-wire` fixture case all derive from this array.
 */
export const SERVER_REPORTED_EFFECTS = [
    'set',
    'persist',
    'call-service',
    'fetch',
    'fetch-stream',
    'emit',
] as const satisfies readonly Effect[0][];

export type ServerReportedEffect = (typeof SERVER_REPORTED_EFFECTS)[number];

/** A namespaced effect head (`llm/generate`, `behavior/describe`, `program/read`) — what a
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


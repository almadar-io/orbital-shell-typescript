/**
 * Generates the ONE recorded event-wire fixture set (Program A, §156, wave
 * A2): every server and client test — vitest in `@almadar/runtime` /
 * `@almadar/ui` / `almadar-playground-runtime`, `cargo test` in
 * `orbital-core` / `orbital-server` / `orbital-client` and the native
 * (Android/iOS) shell decoders, the Hono codegen contract test, and `orb
 * verify --server` — loads these SAME files instead of hand-rolling its own
 * wire examples, so the four previously-divergent implementations converge
 * on one recorded shape. Separate from `packages/almadar-parity` (behaviour
 * traces across execution paths, not wire bytes).
 *
 * Each fixture is built as a typed `OrbitalEventRequest`/`OrbitalEventResponse`
 * (plus the SSE stream / live-push item shapes), validated against the zod
 * schemas `@almadar/core` owns (`src/types/bus.ts`), then written as stable,
 * 2-space, key-sorted JSON. A schema violation throws and exits non-zero —
 * this script IS the fixture's own conformance gate.
 *
 * Scenario used across every case (std-notes-flavoured, realistic): orbital
 * `NoteBoard`, entity `Note {id, title, body?, pinned?}`, traits
 * `NoteCatalog` (browse/list), `InlineButtonRender3` (the embedded "New
 * Note" button), `NotePersistor` (create/save/delete).
 *
 * Run: `pnpm --filter @almadar/core run build:fixtures` (also wired into
 * `build`, before the `tsup` compile step).
 */
import { writeFileSync, mkdirSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  type OrbitalEventRequest,
  type OrbitalEventResponse,
  type ClientEffectTuple,
  type EmittedEvent,
  type LiveBroadcastItem,
  OrbitalEventRequestSchema,
  OrbitalEventResponseSchema,
  ClientEffectTupleSchema,
  EmittedEventSchema,
  LiveBroadcastItemSchema,
} from '../src/types/bus.js';
import { type ServerEffectResult, ServerEffectResultSchema } from '../src/types/effect-result.js';
import { SERVER_REPORTED_EFFECTS } from '../src/types/effect.js';
import { type SSEStreamItem, type EventWireFixture, EVENT_WIRE_FIXTURE_CASES, SSEStreamItemSchema } from '../src/fixtures.js';
import type { JsonObject, JsonValue } from '../src/types/json.js';


const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURES_ROOT = join(PACKAGE_ROOT, 'fixtures', 'events-wire');

// Baseline whole-orbital state snapshot shared by every case that does not
// move a different trait — mirrors `OrbitalServerRuntime.processOrbitalEvent`
// building `states` from `registered.manager.getAllStates()` (ALL traits,
// not just the dispatch target).
const IDLE_STATES = { NoteCatalog: 'browsing', InlineButtonRender3: 'idle', NotePersistor: 'idle' };

const noteSavedEmit: EmittedEvent = {
  event: 'NoteSaved',
  payload: { id: 'note-1' },
  source: { orbital: 'NoteBoard', trait: 'NotePersistor' },
};

const savingButtonEffect: ClientEffectTuple = ['render-ui', 'toolbar', { type: 'button', label: 'Saving…', disabled: true }];

const savedToastEffect: ClientEffectTuple = ['render-ui', 'toast', { type: 'toast-slot', variant: 'success', title: 'Note saved' }];

const saveResponse: OrbitalEventResponse = {
  success: true,
  transitioned: true,
  states: { ...IDLE_STATES, NotePersistor: 'saved' },
  emittedEvents: [noteSavedEmit],
  clientEffectsByTrait: [
    { traitName: 'NotePersistor', effect: savingButtonEffect },
    { traitName: 'NotePersistor', effect: savedToastEffect },
  ],
};

const CASES: Record<string, EventWireFixture> = {
  'render-ui-3': {
    request: { event: 'INIT', targetTrait: 'NoteCatalog', clientId: 'tab-1' },
    response: {
      success: true,
      transitioned: true,
      states: IDLE_STATES,
      emittedEvents: [],
      clientEffectsByTrait: [{ traitName: 'NoteCatalog', effect: ['render-ui', 'main', { type: 'stack', direction: 'vertical' }] }],
    },
  },

  'render-ui-clear': {
    request: { event: 'CLOSE_DIALOG', targetTrait: 'NoteCatalog', clientId: 'tab-1' },
    response: {
      success: true,
      transitioned: true,
      states: IDLE_STATES,
      emittedEvents: [],
      clientEffectsByTrait: [{ traitName: 'NoteCatalog', effect: ['render-ui', 'modal', null] }],
    },
  },

  'navigate-1': {
    request: { event: 'VIEW_ALL', targetTrait: 'NoteCatalog', clientId: 'tab-1' },
    response: {
      success: true,
      transitioned: true,
      states: IDLE_STATES,
      emittedEvents: [],
      clientEffectsByTrait: [{ traitName: 'NoteCatalog', effect: ['navigate', '/notes'] }],
    },
  },

  'navigate-2': {
    request: { event: 'OPEN_NOTE', targetTrait: 'NoteCatalog', payload: { id: 'note-1' }, clientId: 'tab-1' },
    response: {
      success: true,
      transitioned: true,
      states: IDLE_STATES,
      emittedEvents: [],
      clientEffectsByTrait: [{ traitName: 'NoteCatalog', effect: ['navigate', '/notes/:id', { id: 'note-1' }] }],
    },
  },

  'navigate-3': {
    request: { event: 'OPEN_NOTE', targetTrait: 'NoteCatalog', payload: { id: 'note-1' }, clientId: 'tab-1' },
    response: {
      success: true,
      transitioned: true,
      states: IDLE_STATES,
      emittedEvents: [],
      clientEffectsByTrait: [{ traitName: 'NoteCatalog', effect: ['navigate', '/notes/:id', { id: 'note-1' }, { crumb: 'Grocery list' }] }],
    },
  },

  'navigate-back': {
    request: { event: 'CANCEL', targetTrait: 'NoteCatalog', clientId: 'tab-1' },
    response: {
      success: true,
      transitioned: true,
      states: IDLE_STATES,
      emittedEvents: [],
      clientEffectsByTrait: [{ traitName: 'NoteCatalog', effect: ['navigate-back'] }],
    },
  },

  // Guard-rejection semantics matched to `OrbitalServerRuntime.processOrbitalEvent`
  // as it stands today (`packages/almadar-runtime/src/OrbitalServerRuntime.ts`
  // ~2185-2530): a guard failure means `StateMachineManager.sendEvent` returns
  // no result for the target trait, so `transitioned: results.length > 0` is
  // `false` — the method does NOT early-return (that path is reserved for
  // "orbital not found" / payload-validation failures, which DO ship
  // `states: {}`), it falls through to build `states` from
  // `registered.manager.getAllStates()` (the full, unchanged snapshot) and
  // returns `success: true`. `guardFailed` is not populated by the runtime
  // yet (that lands in wave A1) but IS part of the canonical wire schema
  // (`OrbitalEventResponseSchema`, A0) — this fixture fixtures the FORWARD
  // shape A1 converges the runtime onto, addressed `"<Trait>.<event>"`.
  'guard-rejected': {
    request: { event: 'CREATE_DRAFT', targetTrait: 'NoteCatalog', payload: {}, clientId: 'tab-1' },
    response: {
      success: true,
      transitioned: false,
      states: IDLE_STATES,
      emittedEvents: [],
      guardFailed: 'NoteCatalog.CREATE_DRAFT',
    },
  },

  'cascade-emitted-events': {
    request: {
      event: 'SAVE',
      targetTrait: 'NotePersistor',
      entityId: 'note-1',
      payload: { title: 'Grocery list' },
      clientId: 'tab-1',
    },
    response: {
      success: true,
      transitioned: true,
      states: { ...IDLE_STATES, NotePersistor: 'saved' },
      emittedEvents: [
        noteSavedEmit,
        {
          event: 'NoteListRefreshed',
          payload: {},
          source: { orbital: 'NoteBoard', trait: 'NoteCatalog', fromBridge: true },
        },
      ],
    },
  },

  'stateless-traits': {
    request: {
      event: 'RENAME',
      traits: [
        { trait: 'NoteCatalog', from: 'browsing' },
        { trait: 'NotePersistor', from: 'idle' },
      ],
      entityByTrait: {
        NoteCatalog: { id: 'note-1', title: 'Old title' },
        NotePersistor: { id: 'note-1', title: 'Old title' },
      },
      behavior: 'NoteBoard',
      payload: { title: 'New title' },
    },
    response: {
      success: true,
      transitioned: true,
      states: { NoteCatalog: 'browsing', NotePersistor: 'idle' },
      emittedEvents: [],
      frames: { from: 0, to: 0, ops: [['set', { NotePersistor: { id: 'note-1', title: 'New title' } }]] },
    },
  },

  'tick-run-leg': {
    request: {
      event: '$TICK_autosave',
      runTick: { trait: 'Editor', tick: 'autosave' },
      targetTrait: 'Editor',
      traits: [{ trait: 'Editor', from: 'editing' }],
      entityByTrait: { Editor: { id: 'draft-1', text: 'unsaved' } },
    },
    response: {
      success: true,
      transitioned: false,
      states: { Editor: 'editing' },
      emittedEvents: [],
    },
  },

  'client-effects-by-trait': {
    request: { event: 'REFRESH', clientId: 'tab-1' },
    response: {
      success: true,
      transitioned: true,
      states: IDLE_STATES,
      emittedEvents: [],
      clientEffectsByTrait: [
        { traitName: 'NoteCatalog', effect: ['render-ui', 'main', { type: 'data-list', entity: 'Note' }] },
        { traitName: 'InlineButtonRender3', effect: ['render-ui', 'toolbar', { type: 'button', label: 'New Note' }] },
      ],
    },
  },

  'client-effects-provenance': {
    request: { event: 'SAVE', targetTrait: 'NoteForm', clientId: 'tab-1' },
    response: {
      success: true,
      transitioned: true,
      states: { ...IDLE_STATES, NoteForm: 'saved' },
      emittedEvents: [],
      clientEffectsByTrait: [
        { traitName: 'NoteForm', effect: ['render-ui', 'main', { type: 'alert', message: 'Saved' }], event: 'SAVE', fromState: 'editing' },
        { traitName: 'NoteCatalog', effect: ['render-ui', 'sidebar', { type: 'data-list', entity: 'Note' }], event: 'REFRESH', fromState: 'idle' },
      ],
    },
  },

  'effect-results': {
    request: {
      event: 'SAVE',
      targetTrait: 'NotePersistor',
      entityId: 'note-1',
      payload: { title: 'Grocery list' },
      clientId: 'tab-1',
    },
    response: {
      success: true,
      transitioned: true,
      states: { ...IDLE_STATES, NotePersistor: 'saved' },
      emittedEvents: [noteSavedEmit],
      effectResults: [
        { effect: 'persist', action: 'create', entityType: 'Note', data: { id: 'note-1', title: 'Grocery list' }, success: true },
        { effect: 'fetch', entityType: 'Note', data: { id: 'note-1', title: 'Grocery list' }, success: true },
      ] satisfies ServerEffectResult[],
    },
  },

  // One result per member of `SERVER_REPORTED_EFFECTS` plus the `substrate`
  // grouping — iterated, never listed, so the Rust `ServerEffectKind` mirror
  // (`orbital-core/src/effects/response.rs`) cannot drift from core without
  // `events_wire_fixtures.rs` going red.
  'effect-results-every-kind': {
    request: {
      event: 'SAVE',
      targetTrait: 'NotePersistor',
      entityId: 'note-1',
      payload: { title: 'Grocery list' },
      clientId: 'tab-1',
    },
    response: {
      success: true,
      transitioned: true,
      states: { ...IDLE_STATES, NotePersistor: 'saved' },
      emittedEvents: [],
      effectResults: [
        ...SERVER_REPORTED_EFFECTS.map((effect): ServerEffectResult => ({ effect, entityType: 'Note', success: true })),
        { effect: 'substrate', name: 'llm/generate', data: { id: 'gen-1' }, success: true },
      ],
    },
  },

  // Ordered item sequence mirrors the SSE endpoint's `onPush` writes
  // (`OrbitalServerRuntime.ts` ~2634 'effect', ~2683 'event') followed by the
  // final ~4125 'complete' write, whose `data` is byte-identical to this
  // case's own `response.json`.
  'sse-stream': {
    request: {
      event: 'SAVE',
      targetTrait: 'NotePersistor',
      entityId: 'note-1',
      payload: { title: 'Grocery list' },
      clientId: 'tab-1',
    },
    response: saveResponse,
    stream: [
      { type: 'effect', data: savingButtonEffect, timestamp: 1700000000000 },
      { type: 'event', data: noteSavedEmit, timestamp: 1700000000012 },
      { type: 'effect', data: savedToastEffect, timestamp: 1700000000045 },
      { type: 'complete', data: saveResponse, timestamp: 1700000000210 },
    ],
  },

  // `live-push.json` mirrors `LiveBroadcastItem` (~344-356 in
  // `OrbitalServerRuntime.ts` pre-promotion): fired from the `persist`
  // effect's `emit:{success}` envelope and relayed to every OTHER connected
  // client (the originating tab's `clientId` rides `originClientId` so the
  // transport can exclude it from delivery).
  'live-push': {
    request: {
      event: 'SAVE',
      targetTrait: 'NotePersistor',
      entityId: 'note-1',
      payload: { title: 'Grocery list' },
      clientId: 'tab-1',
    },
    response: {
      success: true,
      transitioned: true,
      states: { ...IDLE_STATES, NotePersistor: 'saved' },
      emittedEvents: [noteSavedEmit],
      effectResults: [
        { effect: 'persist', action: 'create', entityType: 'Note', data: { id: 'note-1', title: 'Grocery list' }, success: true },
      ],
    },
    livePush: {
      event: 'NoteSaved',
      payload: { id: 'note-1', title: 'Grocery list' },
      source: { orbital: 'NoteBoard', trait: 'NotePersistor' },
      originClientId: 'tab-1',
    },
  },
};

// The canonical case-name list is owned by `src/fixtures.ts` (the
// consumer-facing module); assert this generator's authored `CASES` map
// agrees with it exactly, so an added/renamed/removed case can't silently
// drift the two apart.
{
  const authored = Object.keys(CASES).sort();
  const declared = [...EVENT_WIRE_FIXTURE_CASES].sort();
  if (JSON.stringify(authored) !== JSON.stringify(declared)) {
    throw new Error(
      `CASES (authored here) != EVENT_WIRE_FIXTURE_CASES (declared in src/fixtures.ts): ` +
      `authored [${authored.join(', ')}], declared [${declared.join(', ')}]`,
    );
  }
}

// ============================================================================
// Stable, deterministic JSON serialization: 2-space indent, object keys
// sorted lexicographically (array ORDER is preserved — it's wire-meaningful,
// e.g. tuple slots and `emittedEvents` declaration order).
// ============================================================================

function sortKeysDeep(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value !== null && typeof value === 'object') {
    const sorted: JsonObject = {};
    for (const key of Object.keys(value).sort()) {
      sorted[key] = sortKeysDeep(value[key]);
    }
    return sorted;
  }
  return value;
}

// The file content IS the JSON serialization, so re-parsing the stringified
// value types it as `JsonValue` exactly — no cast.
function writeJson(path: string, value: object): void {
  const json: JsonValue = JSON.parse(JSON.stringify(value));
  writeFileSync(path, `${JSON.stringify(sortKeysDeep(json), null, 2)}\n`, 'utf8');
}

function main(): void {
  if (existsSync(FIXTURES_ROOT)) {
    // Regeneration must be idempotent and must not leave stale case
    // directories behind when a case is renamed/removed.
    rmSync(FIXTURES_ROOT, { recursive: true, force: true });
  }
  mkdirSync(FIXTURES_ROOT, { recursive: true });

  for (const caseName of EVENT_WIRE_FIXTURE_CASES) {
    const fixture = CASES[caseName];
    const caseDir = join(FIXTURES_ROOT, caseName);
    mkdirSync(caseDir, { recursive: true });

    if (fixture.request) {
      const validated = OrbitalEventRequestSchema.parse(fixture.request);
      writeJson(join(caseDir, 'request.json'), validated);
    }
    if (fixture.response) {
      const validated = OrbitalEventResponseSchema.parse(fixture.response);
      writeJson(join(caseDir, 'response.json'), validated);
    }
    if (fixture.stream) {
      const validated = fixture.stream.map((item) => SSEStreamItemSchema.parse(item));
      writeJson(join(caseDir, 'stream.json'), validated);
    }
    if (fixture.livePush) {
      const validated = LiveBroadcastItemSchema.parse(fixture.livePush);
      writeJson(join(caseDir, 'live-push.json'), validated);
    }
  }

  // Fail loudly if a stray directory exists that isn't a declared case (a
  // deleted case's leftover fixture would otherwise sit silently on disk).
  const onDisk = readdirSync(FIXTURES_ROOT).sort();
  const declared = [...EVENT_WIRE_FIXTURE_CASES].sort();
  if (JSON.stringify(onDisk) !== JSON.stringify(declared)) {
    throw new Error(
      `Fixture directory drift: on-disk cases [${onDisk.join(', ')}] != declared cases [${declared.join(', ')}]`,
    );
  }

  console.log(`✓ Generated ${EVENT_WIRE_FIXTURE_CASES.length} event-wire fixture cases under ${FIXTURES_ROOT}`);
}

// Guarded so `export const SSEStreamItemSchema` above can be imported (by
// `__tests__/event-wire-fixtures.test.ts`, for validating `stream.json`
// against the same union the generator itself uses) without re-running the
// generator as an import side effect.
const isMainModule = process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) main();

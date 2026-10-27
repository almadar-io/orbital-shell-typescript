import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { EVENT_WIRE_FIXTURE_CASES, loadEventWireFixture } from '../src/fixtures.js';
import { OrbitalEventRequestSchema, OrbitalEventResponseSchema, LiveBroadcastItemSchema } from '../src/types/bus.js';
import { SSEStreamItemSchema } from '../src/fixtures.js';

/**
 * A2 (Program A, §156): pins the ONE recorded event-wire fixture set
 * (`fixtures/events-wire/<case>/`) that every server and client test loads.
 * Three invariants: every generated file validates against the canonical
 * zod schemas, every declared case exists on disk, and regenerating the set
 * is byte-identical (the fixture is deterministic, not a moving target).
 */

const PACKAGE_ROOT = join(fileURLToPath(import.meta.url), '..', '..');
const FIXTURES_ROOT = join(PACKAGE_ROOT, 'fixtures', 'events-wire');

describe('EVENT_WIRE_FIXTURE_CASES', () => {
  it('is non-empty and has no duplicate case names', () => {
    expect(EVENT_WIRE_FIXTURE_CASES.length).toBeGreaterThan(0);
    expect(new Set(EVENT_WIRE_FIXTURE_CASES).size).toBe(EVENT_WIRE_FIXTURE_CASES.length);
  });

  it('every declared case has a directory on disk with at least one fixture file', () => {
    for (const caseName of EVENT_WIRE_FIXTURE_CASES) {
      const caseDir = join(FIXTURES_ROOT, caseName);
      const files = readdirSync(caseDir);
      expect(files.length).toBeGreaterThan(0);
    }
  });

  it('has no stray on-disk case directory that is not declared', () => {
    const onDisk = readdirSync(FIXTURES_ROOT).sort();
    const declared = [...EVENT_WIRE_FIXTURE_CASES].sort();
    expect(onDisk).toEqual(declared);
  });
});

describe('every fixture file parses and validates', () => {
  for (const caseName of EVENT_WIRE_FIXTURE_CASES) {
    it(`${caseName}: request/response/stream/live-push all satisfy their schema`, () => {
      const fixture = loadEventWireFixture(caseName);
      // Every case has a request+response pair (the client → server round
      // trip); `stream`/`livePush` are additive per-case extras.
      expect(fixture.request).toBeDefined();
      expect(fixture.response).toBeDefined();

      expect(() => OrbitalEventRequestSchema.parse(fixture.request)).not.toThrow();
      expect(() => OrbitalEventResponseSchema.parse(fixture.response)).not.toThrow();

      if (fixture.stream) {
        expect(fixture.stream.length).toBeGreaterThan(0);
        for (const item of fixture.stream) {
          expect(() => SSEStreamItemSchema.parse(item)).not.toThrow();
        }
        // The stream's terminal 'complete' item carries the same response
        // this case's own response.json records.
        const complete = fixture.stream.at(-1);
        expect(complete?.type).toBe('complete');
        expect(complete?.data).toEqual(fixture.response);
      }

      if (fixture.livePush) {
        expect(() => LiveBroadcastItemSchema.parse(fixture.livePush)).not.toThrow();
      }
    });
  }

  it('guard-rejected matches the runtime\'s current guard-rejection semantics (success, transitioned:false, guardFailed)', () => {
    const { response } = loadEventWireFixture('guard-rejected');
    expect(response?.success).toBe(true);
    expect(response?.transitioned).toBe(false);
    expect(response?.emittedEvents).toEqual([]);
    expect(response?.guardFailed).toBe('NoteCatalog.CREATE_DRAFT');
  });

  it('cascade-emitted-events carries two emittedEvents, each with a source', () => {
    const { response } = loadEventWireFixture('cascade-emitted-events');
    expect(response?.emittedEvents.length).toBe(2);
    for (const emitted of response?.emittedEvents ?? []) {
      expect(emitted.source).toBeDefined();
    }
  });

  it('stateless-traits request carries traits[]/entityByTrait/behavior; response carries entityByTrait', () => {
    const { request, response } = loadEventWireFixture('stateless-traits');
    expect(request?.traits?.length).toBeGreaterThan(0);
    expect(request?.entityByTrait).toBeDefined();
    expect(request?.behavior).toBeDefined();
    expect(response?.entityByTrait).toBeDefined();
  });

  it('client-effects-by-trait attributes each effect to its producing trait, in order', () => {
    const { response } = loadEventWireFixture('client-effects-by-trait');
    expect(response?.clientEffectsByTrait?.map((frame) => frame.traitName)).toEqual(['NoteCatalog', 'InlineButtonRender3']);
  });

  it('render-ui-3 is the one render-ui arity: a slot and a pattern', () => {
    expect(loadEventWireFixture('render-ui-3').response?.clientEffectsByTrait?.[0]?.effect).toHaveLength(3);
  });

  it('render-ui-clear clears a slot with a null pattern config', () => {
    const { response } = loadEventWireFixture('render-ui-clear');
    expect(response?.clientEffectsByTrait?.[0]?.effect).toEqual(['render-ui', 'modal', null]);
  });

  it('navigate-1/2/3 use the navigate tuple arities 2, 3 and 4; navigate-back is a bare tuple', () => {
    expect(loadEventWireFixture('navigate-1').response?.clientEffectsByTrait?.[0]?.effect).toHaveLength(2);
    expect(loadEventWireFixture('navigate-2').response?.clientEffectsByTrait?.[0]?.effect).toHaveLength(3);
    expect(loadEventWireFixture('navigate-3').response?.clientEffectsByTrait?.[0]?.effect).toHaveLength(4);
    expect(loadEventWireFixture('navigate-back').response?.clientEffectsByTrait?.[0]?.effect).toEqual(['navigate-back']);
  });

  it('effect-results carries persist + fetch ServerEffectResults', () => {
    const { response } = loadEventWireFixture('effect-results');
    const kinds = response?.effectResults?.map((result) => result.effect);
    expect(kinds).toEqual(['persist', 'fetch']);
  });

  it('live-push.json mirrors the persist success that produced it, addressed to other clients', () => {
    const { request, livePush } = loadEventWireFixture('live-push');
    expect(livePush?.originClientId).toBe(request?.clientId);
  });
});

describe('regeneration is deterministic', () => {
  it('re-running the generator in place reproduces byte-identical fixture files', () => {
    // Snapshot every committed file's content before regenerating (the
    // generator's `PACKAGE_ROOT` is resolved from its own file location, so
    // it always writes to the real `fixtures/events-wire`; running it here
    // — rather than in an isolated copy — sidesteps re-resolving `zod` from
    // a `node_modules`-less scratch dir while still proving determinism:
    // the regenerated content must equal what was already on disk).
    const before = new Map<string, string>();
    for (const caseName of EVENT_WIRE_FIXTURE_CASES) {
      const caseDir = join(FIXTURES_ROOT, caseName);
      for (const file of readdirSync(caseDir)) {
        before.set(join(caseName, file), readFileSync(join(caseDir, file), 'utf8'));
      }
    }

    execFileSync('npx', ['tsx', 'scripts/generate-event-wire-fixtures.ts'], {
      cwd: PACKAGE_ROOT,
      stdio: 'pipe',
    });

    const after = new Map<string, string>();
    for (const caseName of EVENT_WIRE_FIXTURE_CASES) {
      const caseDir = join(FIXTURES_ROOT, caseName);
      for (const file of readdirSync(caseDir)) {
        after.set(join(caseName, file), readFileSync(join(caseDir, file), 'utf8'));
      }
    }

    expect([...after.keys()].sort()).toEqual([...before.keys()].sort());
    for (const [path, content] of before) {
      expect(after.get(path)).toBe(content);
    }
  }, 30_000);
});

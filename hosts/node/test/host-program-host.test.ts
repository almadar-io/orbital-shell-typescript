import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { isProgramEffect } from '@almadar/shell-runtime';
import { behaviorCatalog, behaviorDescribe, behaviorSource, mountBehaviorValue, mountTraitValue, programCompose, programEval, programPrint, programRead, programValidate, runProgramEffect } from '../src/program/index.js';
import { BehaviorDescriptionSchema, JsonValueSchema, parseProgram, type JsonValue } from '@almadar/core';
import { installWorkspaceHost, installedWorkspaceHost, uninstallWorkspaceHost, workspaceOwnerSegment, type WorkspaceHost } from '../src/program/workspace-host.js';

// The program host runs the real `orb` (no mock of the thing under test). It
// needs an installed binary; ORB_BIN names it explicitly in CI.
const ORB = process.env['ORB_BIN'] ?? join(process.env['HOME'] ?? '', 'bin', 'orb');

// orb resolves behavior packages by walking up from the project directory, so the
// test projects live under this package, where an installed @almadar/std is reachable.
const TMP_ROOT = join(import.meta.dirname, '.tmp-program-host');

/** A program as an effect argument: plain JSON, where an absent field is no key. */
const arg = (value: object): JsonValue => JsonValueSchema.parse(JSON.parse(JSON.stringify(value)));
function stdReachable(from: string): boolean {
  for (let dir = from; ; dir = dirname(dir)) {
    if (existsSync(join(dir, 'node_modules', '@almadar', 'std', 'package.json'))) return true;
    if (dirname(dir) === dir) return false;
  }
}
const hasOrb = existsSync(ORB) && stdReachable(import.meta.dirname);

const VALID = `orbital Hello {
  entity Greeting [runtime] {
    id : string!
  }

  trait Greet -> Greeting {
    initial: idle

    state idle {
      INIT -> idle
        (render-ui main { type: typography, content: "hi" })
    }
  }

  page "/" -> Greet
}
`;

// A control whose event is only offered outward (`-> external`): an importer may wire it,
// so it validates at 0/0, but as a finished app nothing handles it.
const OFFERED_CONTROL = VALID.replace(
  '    initial: idle\n',
  '    initial: idle\n\n    emits {\n      GO -> external\n    }\n',
).replace('{ type: typography, content: "hi" }', '{ type: button, label: "Go", action: GO }');

// A disk host standing in for the runtime's std-workspace host: the program host's own logic (the access
// check, the written path, the snapshot call) is under test here; the real kernel host is tested in @almadar/runtime.
function localWorkspaceHost(projectRoot: string): WorkspaceHost {
  const root = join(projectRoot, 'workspaces');
  const history = new Map<string, Array<{ id: string; timestamp: number; reason: string }>>();
  return {
    root,
    async open(workspace, context) {
      if (context.principal === undefined || context.principal === '') throw new Error('A workspace needs a signed-in caller');
      const workDir = join(root, workspaceOwnerSegment(context.principal), workspaceOwnerSegment(workspace));
      return {
        workDir,
        async writeFile(relPath, content) {
          mkdirSync(dirname(join(workDir, relPath)), { recursive: true });
          writeFileSync(join(workDir, relPath), content);
        },
        async snapshot(reason) {
          const list = history.get(workDir) ?? [];
          list.push({ id: `oid-${list.length}`, timestamp: Date.now(), reason });
          history.set(workDir, list);
          return { oid: `oid-${list.length - 1}` };
        },
        async listSnapshots() {
          return history.get(workDir) ?? [];
        },
      };
    },
  };
}

const dirs: string[] = [];
function project(): string {
  mkdirSync(TMP_ROOT, { recursive: true });
  const d = mkdtempSync(join(TMP_ROOT, 'p-'));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
afterAll(() => rmSync(TMP_ROOT, { recursive: true, force: true }));

describe.skipIf(!hasOrb)('program host (real orb)', () => {
  it('program/read lowers .lolo text to the .orb IR', async () => {
    const program = await programRead(VALID, { cwd: project(), orbBin: ORB });
    expect(program.orbitals.map((o) => o.name)).toEqual(['Hello']);
  });

  it('program/read of text that lowers but does not validate fails with the validator issues as data', async () => {
    const fieldless = VALID.replace('    id : string!\n', '');
    const out = await runProgramEffect('program/read', [fieldless], { cwd: project(), orbBin: ORB });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.errors?.map((e) => e.code)).toContain('ORB_E_NO_FIELDS');
  });

  it('control: a parse error stays a read failure naming the line', async () => {
    const out = await runProgramEffect('program/read', ['app broken [version: "1.0.0"]\norbital {'], { cwd: project(), orbBin: ORB });
    expect(out).toMatchObject({ ok: false });
    if (out.ok) return;
    expect(out.error).toContain('LOLO parse error');
  });

  it('program/eval writes the validated program into orbitals/ and returns its traits as values', async () => {
    const cwd = project();
    const program = await programRead(VALID, { cwd, orbBin: ORB });
    const out = await programEval({ ...program, name: 'HelloApp' }, { cwd, orbBin: ORB });
    expect(out).toEqual({ ok: true, result: { behavior: './orbitals/HelloApp', traits: [{ behavior: './orbitals/HelloApp', trait: 'Greet' }], value: { behavior: './orbitals/HelloApp' } } });
    expect(existsSync(join(cwd, 'orbitals', 'HelloApp.orb'))).toBe(true);
  });

  describe('into a workspace', () => {
    afterEach(() => uninstallWorkspaceHost());
    const owner = { principal: 'user-a' };

    it('writes into the caller\'s workspace, snapshots it, and the value resolves for its owner', async () => {
      const cwd = project();
      installWorkspaceHost(localWorkspaceHost(cwd));
      const program = await programRead(VALID, { cwd, orbBin: ORB });
      const out = await runProgramEffect('program/eval', [arg({ ...program, name: 'HelloApp' }), { workspace: 'app-1' }], { cwd, orbBin: ORB }, owner);
      expect(out.ok).toBe(true);
      if (!out.ok) return;
      const result = out.result as { behavior: string; value: { behavior: string } };
      expect(result.behavior).toMatch(/^\.\/workspaces\/user-a\/[A-Za-z0-9_-]+\/orbitals\/HelloApp$/);
      expect(result.value).toEqual({ behavior: result.behavior });
      expect(existsSync(join(cwd, `${result.behavior}.orb`))).toBe(true);
      expect(existsSync(join(cwd, 'orbitals'))).toBe(false);
      const history = await (await installedWorkspaceHost()!.open('app-1', owner)).listSnapshots();
      expect(JSON.stringify(history)).toContain('HelloApp');
      expect((await runProgramEffect('behavior/source', [result.value], { cwd, orbBin: ORB }, owner)).ok).toBe(true);
    });

    it('another user cannot read a program from someone else\'s workspace', async () => {
      const cwd = project();
      installWorkspaceHost(localWorkspaceHost(cwd));
      const program = await programRead(VALID, { cwd, orbBin: ORB });
      const out = await runProgramEffect('program/eval', [arg({ ...program, name: 'HelloApp' }), { workspace: 'app-1' }], { cwd, orbBin: ORB }, owner);
      if (!out.ok) throw new Error(out.error);
      const value = (out.result as { value: { behavior: string } }).value;
      const other = await runProgramEffect('behavior/source', [value], { cwd, orbBin: ORB }, { principal: 'user-b' });
      expect(other).toMatchObject({ ok: false, error: expect.stringMatching(/another user's workspace/) });
      const anonymous = await runProgramEffect('behavior/source', [value], { cwd, orbBin: ORB });
      expect(anonymous.ok).toBe(false);
      const otherResolve = await runProgramEffect('behavior/resolve', [value], { cwd, orbBin: ORB }, { principal: 'user-b' });
      expect(otherResolve).toMatchObject({ ok: false, error: expect.stringMatching(/another user's workspace/) });
      expect(await runProgramEffect('behavior/resolve', [value], { cwd, orbBin: ORB }, owner)).toMatchObject({ ok: true });
    });

    it('mounting a program from another user\'s workspace is refused; its owner mounts it', async () => {
      const cwd = project();
      installWorkspaceHost(localWorkspaceHost(cwd));
      const program = await programRead(VALID, { cwd, orbBin: ORB });
      const out = await runProgramEffect('program/eval', [arg({ ...program, name: 'HelloApp' }), { workspace: 'app-1' }], { cwd, orbBin: ORB }, owner);
      if (!out.ok) throw new Error(out.error);
      const value = (out.result as { value: { behavior: string } }).value;
      expect(await mountBehaviorValue(value, { cwd, orbBin: ORB }, { principal: 'user-b' })).toMatchObject({ ok: false, error: expect.stringMatching(/another user's workspace/) });
      expect((await mountBehaviorValue(value, { cwd, orbBin: ORB }, owner)).ok).toBe(true);
    });

    it('a principal with spaces (an identity row id) builds into its workspace and reads the program back', async () => {
      const cwd = project();
      installWorkspaceHost(localWorkspaceHost(cwd));
      const spaced = { principal: 'StudioUser Id 1' };
      const program = await programRead(VALID, { cwd, orbBin: ORB });
      const out = await runProgramEffect('program/eval', [arg({ ...program, name: 'HelloApp' }), { workspace: 'app-1' }], { cwd, orbBin: ORB }, spaced);
      if (!out.ok) throw new Error(out.error);
      const value = (out.result as { value: { behavior: string } }).value;
      expect(value.behavior.startsWith('./workspaces/StudioUser_20Id_201/')).toBe(true);
      expect((await runProgramEffect('behavior/source', [value], { cwd, orbBin: ORB }, spaced)).ok).toBe(true);
    });

    it('a workspace eval without a signed-in caller fails and writes nothing', async () => {
      const cwd = project();
      installWorkspaceHost(localWorkspaceHost(cwd));
      const program = await programRead(VALID, { cwd, orbBin: ORB });
      const out = await runProgramEffect('program/eval', [arg({ ...program, name: 'HelloApp' }), { workspace: 'app-1' }], { cwd, orbBin: ORB });
      expect(out).toMatchObject({ ok: false, error: expect.stringMatching(/signed-in/) });
      expect(existsSync(join(cwd, 'workspaces'))).toBe(false);
    });

    it('control: a workspace eval on a host with no workspace host fails, naming it', async () => {
      const cwd = project();
      const program = await programRead(VALID, { cwd, orbBin: ORB });
      const out = await runProgramEffect('program/eval', [arg({ ...program, name: 'HelloApp' }), { workspace: 'app-1' }], { cwd, orbBin: ORB }, owner);
      expect(out).toMatchObject({ ok: false, error: expect.stringMatching(/workspace host/) });
    });

    it('the retired into option is refused', async () => {
      const cwd = project();
      const program = await programRead(VALID, { cwd, orbBin: ORB });
      const out = await runProgramEffect('program/eval', [arg({ ...program, name: 'HelloApp' }), { into: cwd }], { cwd, orbBin: ORB }, owner);
      expect(out).toMatchObject({ ok: false, error: expect.stringMatching(/unsupported option "into"/) });
    });
  });

  it('a prior keeps the stamped ids of a re-evaluation', async () => {
    const cwd = project();
    const program = { ...(await programRead(VALID, { cwd, orbBin: ORB })), name: 'HelloApp' };
    await programEval(program, { cwd, orbBin: ORB });
    const first = readFileSync(join(cwd, 'orbitals', 'HelloApp.orb'), 'utf-8');
    const prior = JSON.parse(first);
    await programEval(program, { cwd, orbBin: ORB, prior });
    expect(readFileSync(join(cwd, 'orbitals', 'HelloApp.orb'), 'utf-8')).toBe(first);
  });

  it('control: an invalid program comes back as errors, writes nothing', async () => {
    const cwd = project();
    const program = { ...(await programRead(VALID, { cwd, orbBin: ORB })), name: 'Broken' };
    const broken = { ...program, orbitals: program.orbitals.map((o) => ({ ...o, pages: [{ name: 'Home', path: '/', traits: [{ ref: 'Missing' }] }] })) };
    const out = await programEval(broken, { cwd, orbBin: ORB });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.errors.length).toBeGreaterThan(0);
    expect(existsSync(join(cwd, 'orbitals'))).toBe(false);
  });

  it('a final eval refuses a control nothing in the app handles, and writes nothing', async () => {
    const cwd = project();
    const program = { ...(await programRead(OFFERED_CONTROL, { cwd, orbBin: ORB })), name: 'Offered' };
    const out = await runProgramEffect('program/eval', [arg(program), { final: true }], { cwd, orbBin: ORB });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.errors?.map((e) => e.code)).toContain('ORB_EMIT_CONTROL_UNHANDLED');
    expect(existsSync(join(cwd, 'orbitals'))).toBe(false);
  });

  it('control: the same program evaluates when the eval is not final (an importer may wire it)', async () => {
    const cwd = project();
    const program = { ...(await programRead(OFFERED_CONTROL, { cwd, orbBin: ORB })), name: 'Offered' };
    expect((await runProgramEffect('program/eval', [arg(program), { final: false }], { cwd, orbBin: ORB })).ok).toBe(true);
    expect((await programEval(program, { cwd, orbBin: ORB })).ok).toBe(true);
  });

  it('program/validate reports a valid program as valid with no findings, and writes nothing', async () => {
    const cwd = project();
    const program = { ...(await programRead(VALID, { cwd, orbBin: ORB })), name: 'HelloApp' };
    const before = readdirSync(cwd);
    const out = await runProgramEffect('program/validate', [arg(program)], { cwd, orbBin: ORB });
    expect(out).toEqual({ ok: true, result: { valid: true, errors: [], warnings: [] } });
    expect(isProgramEffect('program/validate')).toBe(true);
    expect(readdirSync(cwd)).toEqual(before);
    expect(existsSync(join(cwd, 'orbitals'))).toBe(false);
  });

  it('control: program/validate of an invalid program returns the same diagnostics program/eval fails with, and writes nothing', async () => {
    const cwd = project();
    const program = { ...(await programRead(VALID, { cwd, orbBin: ORB })), name: 'Broken' };
    const broken = { ...program, orbitals: program.orbitals.map((o) => ({ ...o, pages: [{ name: 'Home', path: '/', traits: [{ ref: 'Missing' }] }] })) };
    const report = await programValidate(broken, { cwd, orbBin: ORB });
    const evaluated = await programEval(broken, { cwd, orbBin: ORB });
    expect(report.valid).toBe(false);
    expect(report.errors.length).toBeGreaterThan(0);
    expect(evaluated.ok).toBe(false);
    if (!evaluated.ok) expect([...report.errors, ...report.warnings]).toEqual(evaluated.errors);
    expect(existsSync(join(cwd, 'orbitals'))).toBe(false);
  });

  it('program/validate honours final like program/eval, and control: the same program is valid when not final', async () => {
    const cwd = project();
    const program = { ...(await programRead(OFFERED_CONTROL, { cwd, orbBin: ORB })), name: 'Offered' };
    const finalOut = await runProgramEffect('program/validate', [arg(program), { final: true }], { cwd, orbBin: ORB });
    expect(finalOut.ok).toBe(true);
    if (finalOut.ok && typeof finalOut.result === 'object' && 'valid' in finalOut.result) {
      expect(finalOut.result.valid).toBe(false);
      expect([...finalOut.result.errors, ...finalOut.result.warnings].map((e) => e.code)).toContain('ORB_EMIT_CONTROL_UNHANDLED');
    }
    const open = await runProgramEffect('program/validate', [arg(program), { final: false }], { cwd, orbBin: ORB });
    expect(open).toEqual({ ok: true, result: { valid: true, errors: [], warnings: [] } });
  });

  it('control: program/validate refuses a non-program and an unsupported option before orb runs', async () => {
    const cwd = project();
    expect((await runProgramEffect('program/validate', ['not a program'], { cwd, orbBin: ORB })).ok).toBe(false);
    const program = { ...(await programRead(VALID, { cwd, orbBin: ORB })), name: 'HelloApp' };
    const out = await runProgramEffect('program/validate', [arg(program), { workspace: 'x' }], { cwd, orbBin: ORB });
    expect(out).toEqual({ ok: false, error: 'program/validate: unsupported option "workspace"' });
  });

  it('rejects a program name that is not a file name', async () => {
    const cwd = project();
    const program = { ...(await programRead(VALID, { cwd, orbBin: ORB })), name: '../escape' };
    const out = await programEval(program, { cwd, orbBin: ORB });
    expect(out).toEqual({ ok: false, errors: [{ code: 'PROGRAM_NAME_INVALID', message: 'program name "../escape" is not a file name' }] });
  });
});

describe.skipIf(!hasOrb)('reflection + print + mount (real orb)', () => {
  const ACCORDION = { behavior: 'almadar-std/ui-accordion', trait: 'AccordionRender' };

  it('behavior/catalog lists only the behaviors under the scope folder', async () => {
    const opts = { cwd: project(), orbBin: ORB };
    const molecules = await behaviorCatalog({ paths: ['almadar-std/ui/core/molecules'] }, opts);
    expect(molecules.length).toBeGreaterThan(0);
    expect(molecules.every((e) => e.topic === 'ui/core')).toBe(true);
    const accordion = molecules.find((e) => e.behavior === ACCORDION.behavior);
    expect(accordion?.traits).toContainEqual(ACCORDION);
    expect(Object.keys(accordion?.vectors ?? {})).toContain('description');
  });

  it('control: a different folder does not list the molecules', async () => {
    const agents = await behaviorCatalog({ paths: ['almadar-std/agent'] }, { cwd: project(), orbBin: ORB });
    expect(agents.some((e) => e.behavior === ACCORDION.behavior)).toBe(false);
  });

  it('behavior/describe returns the knobs of a trait value', async () => {
    const d = await behaviorDescribe(ACCORDION, { cwd: project(), orbBin: ORB });
    expect(d.value).toEqual(ACCORDION);
    expect(d.knobs.length).toBeGreaterThan(0);
  });

  it('control: describing a trait the behavior does not declare is a host failure', async () => {
    await expect(behaviorDescribe({ ...ACCORDION, trait: 'Nope' }, { cwd: project(), orbBin: ORB })).rejects.toThrow(/no inline trait `Nope` in `ui-accordion`/);
  });

  it('behavior/describe on a whole behavior names each orbital with the entities it borrows', async () => {
    const d = await behaviorDescribe({ behavior: 'almadar-std/std-agent-assistant' }, { cwd: project(), orbBin: ORB });
    expect('orbitals' in d).toBe(true);
    if (!('orbitals' in d)) return;
    const assistant = d.orbitals.find((o) => o.value.orbital === 'AgentAssistantOrbital');
    expect(assistant?.borrows).toEqual(['AgentRun']);
    expect(d.orbitals.find((o) => o.value.orbital === 'AgentRecordsOrbital')?.entity?.name).toBe('AgentRun');
  });

  it('behavior/describe on an orbital value describes only that orbital', async () => {
    const out = await runProgramEffect('behavior/describe', [{ behavior: 'almadar-std/std-agent-assistant', orbital: 'AgentRecordsOrbital' }], { cwd: project(), orbBin: ORB });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(BehaviorDescriptionSchema.parse(out.result).orbitals.map((o) => o.value.orbital)).toEqual(['AgentRecordsOrbital']);
  });

  it('control: an orbital the behavior does not declare is a failure as data', async () => {
    const out = await runProgramEffect('behavior/describe', [{ behavior: 'almadar-std/std-agent-assistant', orbital: 'NoSuchOrbital' }], { cwd: project(), orbBin: ORB });
    expect(out.ok).toBe(false);
  });

  it('behavior/source returns the behavior as a program, and program/print reads back to the same orbitals', async () => {
    const opts = { cwd: project(), orbBin: ORB };
    const program = await behaviorSource(ACCORDION, opts);
    const text = await programPrint(program, opts);
    const reread = await programRead(text, opts);
    expect(reread.orbitals.map((o) => o.name)).toEqual(program.orbitals.map((o) => o.name));
  });

  it('behavior/source takes a whole behavior or an orbital value as well as a trait value', async () => {
    const opts = { cwd: project(), orbBin: ORB };
    const byTrait = await runProgramEffect('behavior/source', [ACCORDION], opts);
    const byBehavior = await runProgramEffect('behavior/source', [{ behavior: ACCORDION.behavior }], opts);
    const byOrbital = await runProgramEffect('behavior/source', [{ behavior: 'almadar-std/std-agent-assistant', orbital: 'AgentRecordsOrbital' }], opts);
    expect(byBehavior).toEqual(byTrait);
    expect(byOrbital).toMatchObject({ ok: true });
  });

  it('behavior/resolve returns the behavior with every composed trait inlined', async () => {
    const opts = { cwd: project(), orbBin: ORB };
    const value = { behavior: 'almadar-std/std-agent-assistant' };
    const resolved = await runProgramEffect('behavior/resolve', [value], opts);
    if (!resolved.ok) throw new Error(`expected a program, got ${JSON.stringify(resolved)}`);
    const traits = parseProgram(resolved.result).orbitals.flatMap((o) => o.traits);
    expect(traits.length).toBeGreaterThan(0);
    expect(traits.every((t) => typeof t === 'object' && 'stateMachine' in t)).toBe(true);
  });

  it('control: behavior/source of the same behavior keeps its composed traits as references', async () => {
    const opts = { cwd: project(), orbBin: ORB };
    const source = await behaviorSource({ behavior: 'almadar-std/std-agent-assistant' }, opts);
    const traits = source.orbitals.flatMap((o) => o.traits);
    expect(traits.some((t) => typeof t === 'object' && 'ref' in t)).toBe(true);
  });

  it('behavior/resolve takes a trait value as well as a whole behavior', async () => {
    const opts = { cwd: project(), orbBin: ORB };
    const byTrait = await runProgramEffect('behavior/resolve', [ACCORDION], opts);
    const byBehavior = await runProgramEffect('behavior/resolve', [{ behavior: ACCORDION.behavior }], opts);
    expect(byTrait).toMatchObject({ ok: true });
    expect(byBehavior).toEqual(byTrait);
  });

  it('behavior/dependencies maps each orbital to its imports and places every reached behavior in its layer', async () => {
    const opts = { cwd: project(), orbBin: ORB };
    const program = {
      name: 'App',
      orbitals: [{ name: 'Shop', entity: { name: 'Item', fields: [{ name: 'id', type: 'string' }] }, uses: [{ as: 'Browse', from: 'almadar-std/std-browse' }], traits: [], pages: [] }],
    };
    const out = await runProgramEffect('behavior/dependencies', [program], opts);
    if (!out.ok || typeof out.result !== 'object' || out.result === null || !('behaviors' in out.result)) throw new Error(`expected a graph, got ${JSON.stringify(out)}`);
    expect(out.result.orbitals).toEqual({ Shop: ['std-browse'] });
    const layers = Object.fromEntries(Object.entries(out.result.behaviors).map(([n, b]) => [n, b.layer]));
    expect(layers['std-browse']).toBe('std');
    expect(Object.values(layers)).toContain('primitive');
  });

  it('control: a program that imports nothing has no dependencies', async () => {
    const program = { name: 'App', orbitals: [{ name: 'Shop', entity: { name: 'Item', fields: [{ name: 'id', type: 'string' }] }, traits: [], pages: [] }] };
    expect(await runProgramEffect('behavior/dependencies', [program], { cwd: project(), orbBin: ORB })).toEqual({ ok: true, result: { orbitals: { Shop: [] }, behaviors: {} } });
  });

  it('edge: an import that is not installed is listed with layer unknown and no imports', async () => {
    const program = { name: 'App', orbitals: [{ name: 'Shop', entity: { name: 'Item', fields: [{ name: 'id', type: 'string' }] }, uses: [{ as: 'Ghost', from: 'almadar-std/std-no-such-behavior' }], traits: [], pages: [] }] };
    const out = await runProgramEffect('behavior/dependencies', [program], { cwd: project(), orbBin: ORB });
    expect(out).toEqual({ ok: true, result: { orbitals: { Shop: ['std-no-such-behavior'] }, behaviors: { 'std-no-such-behavior': { layer: 'unknown', imports: [] } } } });
  });

  it('control: behavior/dependencies without a program is refused', async () => {
    expect(await runProgramEffect('behavior/dependencies', ['not a program'], { cwd: project(), orbBin: ORB })).toMatchObject({ ok: false });
  });

  const MODES = {
    name: 'EditorApp',
    orbitals: [{
      name: 'Editor',
      entity: { name: 'Doc', persistence: 'runtime', fields: [{ name: 'id', type: 'string' }, { name: 'mode', type: 'string', default: 'normal' }] },
      pages: [],
      traits: [{
        name: 'Modes',
        linkedEntity: 'Doc',
        stateMachine: {
          states: [{ name: 'NORMAL', isInitial: true }, { name: 'INSERT' }, { name: 'VISUAL' }],
          events: [{ key: 'KEY', name: 'Key' }],
          transitions: [
            { from: 'NORMAL', to: 'INSERT', event: 'KEY', guard: ['=', '@payload.key', 'i'], effects: [['set', '@entity.mode', 'insert']] },
            { from: 'NORMAL', to: 'VISUAL', event: 'KEY', guard: ['=', '@payload.key', 'v'] },
          ],
        },
      }],
    }],
  };

  it('program/step plays each request from its own state and returns it played, with the circuit it ran', async () => {
    const out = await runProgramEffect('program/step', [arg(MODES), [
      { orbital: 'Editor', trait: 'Modes', from: 'NORMAL', event: 'KEY', payload: { key: 'i' } },
      { orbital: 'Editor', trait: 'Modes', from: 'NORMAL', event: 'KEY', payload: { key: 'v' } },
    ]], { cwd: project(), orbBin: ORB });
    expect(out).toEqual({ ok: true, result: [
      { orbital: 'Editor', trait: 'Modes', from: 'NORMAL', event: 'KEY', payload: { key: 'i' }, result:
        { trait: 'Modes', event: 'KEY', transitionFired: true, guard: 'pass', firedArm: 0, entityAfter: { mode: 'insert' }, state: { before: 'NORMAL', after: 'INSERT' },
          effects: [{ type: 'set', args: ['@entity.mode', 'insert'], status: 'executed' }], emitted: [],
          guards: [{ arm: 0, guard: ['=', '@payload.key', 'i'], passed: true, trace: [] }],
          outcomes: [{ orbital: 'Editor', trait: 'Modes', event: 'KEY', from: 'NORMAL', to: 'INSERT', arm: 0, fired: true, effects: [{ type: 'set', args: ['@entity.mode', 'insert'], status: 'executed' }], emitted: [] }] } },
      { orbital: 'Editor', trait: 'Modes', from: 'NORMAL', event: 'KEY', payload: { key: 'v' }, result:
        { trait: 'Modes', event: 'KEY', transitionFired: true, guard: 'pass', firedArm: 1, entityAfter: { mode: 'insert' }, state: { before: 'NORMAL', after: 'VISUAL' },
          effects: [], emitted: [],
          guards: [{ arm: 0, guard: ['=', '@payload.key', 'i'], passed: false, trace: [] }, { arm: 1, guard: ['=', '@payload.key', 'v'], passed: true, trace: [] }],
          outcomes: [{ orbital: 'Editor', trait: 'Modes', event: 'KEY', from: 'NORMAL', to: 'VISUAL', arm: 1, fired: true, effects: [], emitted: [] }] } },
    ] });
  });

  it('control: a request no guard admits fails its guard and fires nothing', async () => {
    const out = await runProgramEffect('program/step', [arg(MODES), [{ orbital: 'Editor', trait: 'Modes', from: 'NORMAL', event: 'KEY', payload: { key: 'x' } }]], { cwd: project(), orbBin: ORB });
    expect(out).toMatchObject({ ok: true, result: [{ result: { transitionFired: false, guard: 'fail', state: { before: 'NORMAL', after: 'NORMAL' }, effects: [] } }] });
    if (out.ok && Array.isArray(out.result)) expect(out.result[0]).not.toHaveProperty('result.firedArm');
  });

  it('edge: a request for a trait the program does not have is a failure as data', async () => {
    const out = await runProgramEffect('program/step', [arg(MODES), [{ orbital: 'Editor', trait: 'Nope', from: 'NORMAL', event: 'KEY', payload: {} }]], { cwd: project(), orbBin: ORB });
    expect(out).toMatchObject({ ok: false });
  });

  const GATE = {
    name: 'GateApp',
    orbitals: [{
      name: 'Gating',
      entity: { name: 'Gate', persistence: 'runtime', fields: [{ name: 'id', type: 'string' }, { name: 'owner', type: 'string', default: '' }] },
      pages: [],
      traits: [{
        name: 'G',
        linkedEntity: 'Gate',
        stateMachine: {
          states: [{ name: 'ready', isInitial: true }, { name: 'open' }],
          events: [{ key: 'OPEN', name: 'Open' }, { key: 'LATE', name: 'Late' }],
          transitions: [
            { from: 'ready', to: 'open', event: 'OPEN', guard: ['=', '@entity.owner', 'ann'] },
            { from: 'ready', to: 'open', event: 'LATE', guard: ['>', '@now', 1000] },
          ],
        },
      }],
    }],
  };
  const gate = (extra: object) => ({ orbital: 'Gating', trait: 'G', from: 'ready', payload: {}, ...extra });

  it('program/step seeds the entity and pins @now for that request only', async () => {
    const out = await runProgramEffect('program/step', [arg(GATE), arg([
      gate({ event: 'OPEN', entity: { owner: 'ann' } }),
      gate({ event: 'OPEN', entity: { owner: 'bob' } }),
      gate({ event: 'LATE', now: 0 }),
      gate({ event: 'LATE' }),
    ])], { cwd: project(), orbBin: ORB });
    expect(out).toMatchObject({ ok: true, result: [
      { entity: { owner: 'ann' }, result: { guard: 'pass' } },
      { result: { guard: 'fail' } },
      { now: 0, result: { guard: 'fail' } },
      { result: { guard: 'pass' } },
    ] });
  });

  const KNOB = {
    name: 'KnobApp',
    orbitals: [{
      name: 'Knob',
      entity: { name: 'K', persistence: 'runtime', fields: [{ name: 'id', type: 'string' }] },
      pages: [],
      traits: [{
        name: 'T',
        linkedEntity: 'K',
        config: { mode: { type: 'string', default: 'off' } },
        stateMachine: {
          states: [{ name: 'idle', isInitial: true }, { name: 'on' }],
          events: [{ key: 'GO', name: 'Go' }],
          transitions: [{ from: 'idle', to: 'on', event: 'GO', guard: ['=', '@config.mode', 'on'] }],
        },
      }],
    }],
  };

  it('program/step overrides a config knob for the call', async () => {
    const go = { orbital: 'Knob', trait: 'T', from: 'idle', event: 'GO', payload: {} };
    const opts = { cwd: project(), orbBin: ORB };
    const out = await runProgramEffect('program/step', [arg(KNOB), arg([{ ...go, config: { mode: 'on' } }])], opts);
    expect(out).toMatchObject({ ok: true, result: [{ config: { mode: 'on' }, result: { guard: 'pass' } }] });
    expect(await runProgramEffect('program/step', [arg(KNOB), arg([go])], opts)).toMatchObject({ ok: true, result: [{ result: { guard: 'fail' } }] });
    expect(await runProgramEffect('program/step', [arg(KNOB), arg([{ ...go, config: { mode: 'on' } }, { ...go, config: { mode: 'off' } }])], opts)).toMatchObject({ ok: false });
  });

  it('program/step leaves a keyed os ask pending: reported, neither run nor failed', async () => {
    const OS = { name: 'OsApp', osGrants: { env: ['HOME'] }, orbitals: [{ name: 'Os',
      entity: { name: 'O', persistence: 'runtime', fields: [{ name: 'id', type: 'string' }] },
      pages: [],
      traits: [{ name: 'T', linkedEntity: 'O', stateMachine: {
        states: [{ name: 'idle', isInitial: true }, { name: 'asking' }],
        events: [{ key: 'ASK', name: 'Ask' }, { key: 'GOT', name: 'Got' }, { key: 'NOGO', name: 'Nogo' }],
        transitions: [
          { from: 'idle', to: 'asking', event: 'ASK', effects: [['os/getenv', 'HOME', { key: 'home', emit: { success: 'GOT', failure: 'NOGO' } }]] },
          { from: 'asking', to: 'idle', event: 'GOT' },
          { from: 'asking', to: 'idle', event: 'NOGO' },
        ] } }] }] };
    const out = await runProgramEffect('program/step', [arg(OS), [{ orbital: 'Os', trait: 'T', from: 'idle', event: 'ASK', payload: {} }]], { cwd: project(), orbBin: ORB });
    if (!out.ok || !Array.isArray(out.result)) throw new Error(`expected played steps, got ${JSON.stringify(out)}`);
    const [played] = out.result;
    if (played === undefined || !('result' in played)) throw new Error('expected one played step');
    expect(played.result.effects.find((e) => e.type === 'os/getenv')?.status).not.toBe('failed');
    expect(played.result.state.after).toBe('asking');
    expect(played.result.outcomes).toHaveLength(1);
  });

  it('program/step runs an os ask only when the call is live, and settleMs cuts a live wait off', async () => {
    const SLEEP = (seconds: string) => ({ name: 'SleepApp', osGrants: { fs: [], exec: ['sleep'], net: [], env: [], stdio: [], sys: [], desktop: [] }, orbitals: [{ name: 'Sleep',
      entity: { name: 'S', persistence: 'runtime', fields: [{ name: 'id', type: 'string' }, { name: 'done', type: 'boolean', default: false }] },
      pages: [],
      traits: [{ name: 'T', linkedEntity: 'S', stateMachine: {
        states: [{ name: 'idle', isInitial: true }, { name: 'running' }, { name: 'done' }],
        events: [{ key: 'RUN', name: 'Run' }, { key: 'SPAWNED', name: 'Spawned' }, { key: 'WAITED', name: 'Waited' }, { key: 'FAILED', name: 'Failed' }],
        transitions: [
          { from: 'idle', to: 'running', event: 'RUN', effects: [['os/spawn', 'sleep', [seconds], { cwd: null, env: null, stdin: 'null', stdout: 'null', stderr: 'null', detached: false }, { key: 'spawn', emit: { success: 'SPAWNED', failure: 'FAILED' } }]] },
          { from: 'running', to: 'running', event: 'SPAWNED', effects: [['os/wait', '@payload.pid', { key: 'wait', emit: { success: 'WAITED', failure: 'FAILED' } }]] },
          { from: 'running', to: 'done', event: 'WAITED', effects: [['set', '@entity.done', true]] },
          { from: 'running', to: 'idle', event: 'FAILED' },
        ] } }] }] });
    const run = (extra: object) => [{ orbital: 'Sleep', trait: 'T', from: 'idle', event: 'RUN', payload: {}, ...extra }];
    const opts = { cwd: project(), orbBin: ORB };
    const waited = await runProgramEffect('program/step', [arg(SLEEP('0.2')), arg(run({})), arg({ live: true })], opts);
    expect(waited).toMatchObject({ ok: true, result: [{ result: { entityAfter: { done: true } } }] });
    const replay = await runProgramEffect('program/step', [arg(SLEEP('0.2')), arg(run({}))], opts);
    expect(replay).toMatchObject({ ok: true, result: [{ result: { state: { after: 'running' } } }] });
    const started = Date.now();
    const cut = await runProgramEffect('program/step', [arg(SLEEP('5')), arg(run({ settleMs: 300 })), arg({ live: true })], opts);
    expect(Date.now() - started).toBeLessThan(4000);
    expect(cut).toMatchObject({ ok: true });
    if (cut.ok && Array.isArray(cut.result)) expect(cut.result[0]?.result.entityAfter?.['done']).not.toBe(true);
    expect(await runProgramEffect('program/step', [arg(SLEEP('0')), arg(run({})), arg({ live: 'yes' })], opts)).toMatchObject({ ok: false });
  }, 20000);

  it('program/step dispatches as the request viewer', async () => {
    const SEE = { name: 'SeeApp', orbitals: [{ name: 'See',
      entity: { name: 'V', persistence: 'runtime', fields: [{ name: 'id', type: 'string' }] },
      pages: [],
      traits: [{ name: 'T', linkedEntity: 'V', stateMachine: {
        states: [{ name: 'idle', isInitial: true }],
        events: [{ key: 'MINE', name: 'Mine' }],
        transitions: [{ from: 'idle', to: 'idle', event: 'MINE', guard: ['=', '@user.id', 'u1'] }] } }] }] };
    const mine = { orbital: 'See', trait: 'T', from: 'idle', event: 'MINE', payload: {} };
    const out = await runProgramEffect('program/step', [arg(SEE), arg([{ ...mine, viewer: { id: 'u1' } }, mine])], { cwd: project(), orbBin: ORB });
    expect(out).toMatchObject({ ok: true, result: [{ result: { guard: 'pass' } }, { result: { guard: 'fail' } }] });
  });

  it('program/step reports the row the requested trait holds after it', async () => {
    const ROW = { name: 'RowApp', orbitals: [{ name: 'Row',
      entity: { name: 'R', persistence: 'runtime', fields: [{ name: 'id', type: 'string' }, { name: 'n', type: 'number', default: 0 }] },
      pages: [],
      traits: [{ name: 'T', linkedEntity: 'R', stateMachine: {
        states: [{ name: 'idle', isInitial: true }],
        events: [{ key: 'BUMP', name: 'Bump' }, { key: 'NOPE', name: 'Nope' }],
        transitions: [
          { from: 'idle', to: 'idle', event: 'BUMP', effects: [['set', '@entity.n', ['+', '@entity.n', 5]]] },
          { from: 'idle', to: 'idle', event: 'NOPE', guard: ['=', 1, 2], effects: [['set', '@entity.n', 99]] },
        ] } }] }] };
    const req = (event: string) => ({ orbital: 'Row', trait: 'T', from: 'idle', event, payload: {}, entity: { n: 1 } });
    const out = await runProgramEffect('program/step', [arg(ROW), arg([req('BUMP'), req('NOPE')])], { cwd: project(), orbBin: ORB });
    expect(out).toMatchObject({ ok: true, result: [{ result: { entityAfter: { n: 6 } } }, { result: { entityAfter: { n: 1 } } }] });
  });

  it('control: a request entity that is not an object or a now that is not a number is refused', async () => {
    for (const bad of [{ entity: 'ann' }, { now: 'noon' }, { config: 'on' }]) {
      expect(await runProgramEffect('program/step', [arg(GATE), arg([gate({ event: 'OPEN', ...bad })])], { cwd: project(), orbBin: ORB })).toMatchObject({ ok: false });
    }
  });

  const RELAY = {
    name: 'RelayApp',
    orbitals: [{
      name: 'Auth',
      entity: { name: 'Key', persistence: 'runtime', fields: [{ name: 'id', type: 'string' }] },
      pages: [],
      traits: [
        { name: 'ApiKeys', linkedEntity: 'Key', stateMachine: {
          states: [{ name: 'idle', isInitial: true }],
          events: [{ key: 'ISSUE', name: 'Issue' }],
          transitions: [{ from: 'idle', to: 'idle', event: 'ISSUE', effects: [['emit', 'ISSUED', {}]] }],
        } },
        { name: 'ServerBearer', linkedEntity: 'Key',
          listens: [{ event: 'ISSUED', triggers: 'ARM', source: { kind: 'trait', trait: 'ApiKeys' } }],
          stateMachine: {
            states: [{ name: 'idle', isInitial: true }, { name: 'armed' }],
            events: [{ key: 'ARM', name: 'Arm' }],
            transitions: [{ from: 'idle', to: 'armed', event: 'ARM' }],
          } },
      ],
    }],
  };

  it('program/step lists every trait the dispatch cascade moved, in dispatch order', async () => {
    const out = await runProgramEffect('program/step', [arg(RELAY), [{ orbital: 'Auth', trait: 'ApiKeys', from: 'idle', event: 'ISSUE', payload: {} }]], { cwd: project(), orbBin: ORB });
    expect(out).toMatchObject({ ok: true, result: [{ result: { trait: 'ApiKeys', outcomes: [
      { orbital: 'Auth', trait: 'ApiKeys', event: 'ISSUE', from: 'idle', to: 'idle', arm: 0, fired: true, emitted: [{ type: 'ISSUED' }] },
      { orbital: 'Auth', trait: 'ServerBearer', event: 'ARM', from: 'idle', to: 'armed', arm: 0, fired: true, emitted: [] },
    ] } }] });
  });

  it('control: a single-trait step has one outcome equal to its top-level fields', async () => {
    const out = await runProgramEffect('program/step', [arg(MODES), [{ orbital: 'Editor', trait: 'Modes', from: 'NORMAL', event: 'KEY', payload: { key: 'i' } }]], { cwd: project(), orbBin: ORB });
    if (!out.ok || !Array.isArray(out.result)) throw new Error(`expected played steps, got ${JSON.stringify(out)}`);
    const [played] = out.result;
    if (played === undefined || !('result' in played)) throw new Error('expected one played step');
    const { result } = played;
    expect(result.outcomes).toEqual([{ orbital: 'Editor', trait: result.trait, event: result.event, from: result.state.before, to: result.state.after, arm: result.firedArm, fired: result.transitionFired, effects: result.effects, emitted: result.emitted }]);
  });

  it('control: program/step without requests is refused', async () => {
    expect(await runProgramEffect('program/step', [arg(MODES), 'nope'], { cwd: project(), orbBin: ORB })).toMatchObject({ ok: false });
  });

  it('control: resolving a behavior that is not installed is a failure as data', async () => {
    const outcome = await runProgramEffect('behavior/resolve', [{ behavior: 'almadar-std/std-no-such-behavior' }], { cwd: project(), orbBin: ORB });
    expect(outcome).toMatchObject({ ok: false, error: expect.stringMatching(/not installed/) });
  });

  it('control: behavior/resolve without a value is refused before orb runs', async () => {
    expect(await runProgramEffect('behavior/resolve', [], { cwd: project(), orbBin: ORB })).toMatchObject({ ok: false });
  });

  it('mountTraitValue resolves a value with overrides into a runnable wrapper', async () => {
    const out = await mountTraitValue({ ...ACCORDION, config: { ariaBusy: true } }, { cwd: project(), orbBin: ORB });
    expect(out).toMatchObject({ ok: true, mounted: { orbital: 'Mounted', trait: 'MountedAccordionRender' } });
  });

  it('mountTraitValue mounts a trait of a program program/eval just wrote into ./orbitals/', async () => {
    const cwd = project();
    const program = await programRead(VALID, { cwd, orbBin: ORB });
    const written = await programEval({ ...program, name: 'HelloApp' }, { cwd, orbBin: ORB });
    expect(written.ok).toBe(true);
    const out = await mountTraitValue({ behavior: './orbitals/HelloApp', trait: 'Greet' }, { cwd, orbBin: ORB });
    expect(out).toMatchObject({ ok: true, mounted: { orbital: 'Mounted', trait: 'MountedGreet' } });
  });

  it('control: mounting a trait the written program does not declare is refused', async () => {
    const cwd = project();
    const program = await programRead(VALID, { cwd, orbBin: ORB });
    await programEval({ ...program, name: 'HelloApp' }, { cwd, orbBin: ORB });
    const out = await mountTraitValue({ behavior: './orbitals/HelloApp', trait: 'NoSuchTrait' }, { cwd, orbBin: ORB });
    expect(out).toMatchObject({ ok: false, error: expect.stringMatching(/declares no inline trait "NoSuchTrait"/) });
  });

  it('control: a value whose override does not validate where it is bound is refused with issues', async () => {
    const out = await mountTraitValue({ ...ACCORDION, config: { noSuchKnob: true } }, { cwd: project(), orbBin: ORB });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.errors?.length ?? 0).toBeGreaterThan(0);
  });
});

describe.skipIf(!hasOrb)('orbital values + program/compose (real orb)', () => {
  const ACCORDION = { behavior: 'almadar-std/ui-accordion', orbital: 'AccordionOrbital' };

  it('program/eval accepts an orbital value where an orbital goes and writes its import', async () => {
    const cwd = project();
    const out = await runProgramEffect('program/eval', [{ name: 'Faq', orbitals: [{ ...ACCORDION, name: 'Faq', entity: 'Question' }] }], { cwd, orbBin: ORB });
    expect(out).toMatchObject({ ok: true, result: { behavior: './orbitals/Faq' } });
  });

  it('control: an orbital value naming an orbital its behavior lacks comes back as validator errors', async () => {
    const cwd = project();
    const out = await runProgramEffect('program/eval', [{ name: 'Bad', orbitals: [{ ...ACCORDION, orbital: 'NoSuchOrbital' }] }], { cwd, orbBin: ORB });
    expect(out.ok).toBe(false);
  });

  it('program/compose assembles programs in the order given', async () => {
    const opts = { cwd: project(), orbBin: ORB };
    const faq = { name: 'FaqProgram', orbitals: [{ ...ACCORDION, name: 'Faq', entity: 'Question' }] };
    const help = { name: 'HelpProgram', orbitals: [{ ...ACCORDION, name: 'Help', entity: 'Topic', pages: { '/accordion': '/help' } }] };
    const composed = await runProgramEffect('program/compose', [[help, faq], { appName: 'Support' }], opts);
    expect(composed.ok).toBe(true);
    if (!composed.ok) return;
    const app = parseProgram(composed.result);
    expect(app.name).toBe('Support');
    expect(app.orbitals.map((o) => o.name)).toEqual(['Help', 'Faq']);
    expect(app.orbitals.every((o) => (o.pages ?? []).length === 0)).toBe(true);
  });

  it('a composed app of an orbital value evaluates clean', async () => {
    const opts = { cwd: project(), orbBin: ORB };
    const faq = { name: 'FaqProgram', orbitals: [{ ...ACCORDION, name: 'Faq', entity: 'Question' }] };
    const composed = await runProgramEffect('program/compose', [[faq], { appName: 'Support' }], opts);
    if (!composed.ok) throw new Error(JSON.stringify(composed));
    const evaluated = await programEval({ ...parseProgram(composed.result), name: 'Support' }, opts);
    expect(evaluated.ok, JSON.stringify(evaluated)).toBe(true);
  });

  it('control: compose refuses a missing appName, an unknown layout, and a non-list', async () => {
    const opts = { cwd: project(), orbBin: ORB };
    expect(await runProgramEffect('program/compose', [[], {}], opts)).toEqual({ ok: false, error: 'program/compose: options must name the app (appName)' });
    expect(await runProgramEffect('program/compose', [[], { appName: 'X', layout: 'grid' }], opts)).toMatchObject({ ok: false });
    expect(await runProgramEffect('program/compose', [{}, { appName: 'X' }], opts)).toEqual({ ok: false, error: 'program/compose: expected a list of programs' });
  });

  it('programCompose gives the app the hooks, egress and orbital os grants of the behaviors it imports, so the app validates', async () => {
    const cwd = project();
    const importer = `app account-probe [
  version: "1.0.0",
  description: "Imports the shared identity, whose dev persona hooks the app must declare."
]
uses Identity from "almadar-behaviors/std-identity"

orbital AccountPage = Identity.orbitals.IdentityOrbital {
}
`;
    const program = await programRead(importer, { cwd, orbBin: ORB });
    const unanswered = (report: { errors: readonly { code?: string }[] }): string[] =>
      report.errors.map((e) => e.code ?? '').filter((code) => code === 'ORB_INBOUND_UNDECLARED' || code === 'ORB_HTTP_EGRESS_UNDECLARED' || code === 'ORB_OS_GRANT_MISSING');
    expect(unanswered(await programValidate(program, { cwd, orbBin: ORB })).length, 'control: the program as written lacks them').toBeGreaterThan(0);
    const schema = await programCompose([program], { appName: 'AccountProbe' }, { cwd, orbBin: ORB });
    expect(schema.inbound).toEqual(expect.arrayContaining(['personas', 'persona-sign-in']));
    expect(schema.egress).toEqual(expect.arrayContaining(['http://127.0.0.1:9099']));
    expect(unanswered(await programValidate(schema, { cwd, orbBin: ORB }))).toEqual([]);
  }, 120_000);

  it('programCompose is the same entry the effect uses, and sets the app theme', async () => {
    const schema = await programCompose([{ name: 'P', orbitals: [] }], { appName: 'Empty', theme: 'ocean' }, { cwd: project(), orbBin: ORB });
    expect(schema.name).toBe('Empty');
    expect(schema.theme).toBe('ocean');
  });
});

describe('runProgramEffect — argument validation (no orb needed)', () => {
  const opts = { cwd: import.meta.dirname, orbBin: '/nonexistent/orb' };

  it('refuses arguments of the wrong shape as data, never throwing', async () => {
    expect(await runProgramEffect('behavior/catalog', [{ paths: [] }], opts)).toMatchObject({ ok: false });
    expect(await runProgramEffect('behavior/describe', ['std/std-kanban.traits.KanbanBoard'], opts)).toMatchObject({ ok: false });
    expect(await runProgramEffect('behavior/source', [{ trait: 'KanbanBoard' }], opts)).toMatchObject({ ok: false });
    expect(await runProgramEffect('program/read', [42], opts)).toEqual({ ok: false, error: 'program/read: expected .lolo text' });
    expect(await runProgramEffect('program/print', [{ notAProgram: true }], opts)).toMatchObject({ ok: false });
  });

  it('refuses an unknown or malformed eval option', async () => {
    const program = { name: 'X', orbitals: [{ name: 'O', entity: { name: 'E', persistence: 'runtime', fields: [{ name: 'id', type: 'string' }] }, traits: [], pages: [] }] };
    expect(await runProgramEffect('program/eval', [arg(program), { into: '' }], opts)).toEqual({ ok: false, error: 'program/eval: unsupported option "into"' });
    expect(await runProgramEffect('program/eval', [arg(program), { publish: true }], opts)).toEqual({ ok: false, error: 'program/eval: unsupported option "publish"' });
    expect(await runProgramEffect('program/eval', [arg(program), []], opts)).toEqual({ ok: false, error: 'program/eval: options must be an object' });
    expect(await runProgramEffect('program/eval', [arg(program), { final: 'yes' }], opts)).toEqual({ ok: false, error: 'program/eval: final must be a boolean' });
  });

  it('forwards knobVectors: true as --knob-vectors and vectors: false as --no-vectors, nothing otherwise', async () => {
    const dir = project();
    const argvFile = join(dir, 'argv');
    const stub = join(dir, 'orb');
    writeFileSync(stub, `#!/bin/sh\nprintf '%s\\n' "$@" > '${argvFile}'\nexit 1\n`, { mode: 0o755 });
    const stubbed = { cwd: dir, orbBin: stub };
    const argv = (): string[] => readFileSync(argvFile, 'utf8').trim().split('\n');
    const trait = { behavior: 'almadar-std/std-retry', trait: 'Retry' };

    expect((await runProgramEffect('behavior/describe', [trait, { knobVectors: true }], stubbed)).ok).toBe(false);
    expect(argv()).toContain('--knob-vectors');
    await runProgramEffect('behavior/describe', [trait], stubbed);
    expect(argv()).not.toContain('--knob-vectors');
    await runProgramEffect('behavior/describe', [trait, { knobVectors: false }], stubbed);
    expect(argv()).not.toContain('--knob-vectors');

    await runProgramEffect('behavior/catalog', [{ paths: ['almadar-std/ml'] }, { vectors: false }], stubbed);
    expect(argv()).toEqual(['behaviors', 'catalog', '--json', '--no-vectors', 'almadar-std/ml']);
    await runProgramEffect('behavior/catalog', [{ paths: ['almadar-std/ml'] }], stubbed);
    expect(argv()).toEqual(['behaviors', 'catalog', '--json', 'almadar-std/ml']);
    await runProgramEffect('behavior/catalog', [{ paths: ['almadar-std/ml'] }, { vectors: false, traits: false }], stubbed);
    expect(argv()).toEqual(['behaviors', 'catalog', '--json', '--no-vectors', '--no-traits', 'almadar-std/ml']);
    await runProgramEffect('behavior/catalog', [{ paths: ['almadar-std/ml'] }, { traits: true }], stubbed);
    expect(argv()).toEqual(['behaviors', 'catalog', '--json', 'almadar-std/ml']);
    await runProgramEffect('behavior/catalog', [{ paths: ['almadar-std/ml'] }, { topics: true, traits: false }], stubbed);
    expect(argv()).toEqual(['behaviors', 'catalog', '--json', '--topics', 'almadar-std/ml']);

    expect(await runProgramEffect('behavior/describe', [trait, { knobVectors: 'yes' }], stubbed)).toEqual({ ok: false, error: 'behavior/describe: knobVectors must be a boolean' });
    expect(await runProgramEffect('behavior/catalog', [{ paths: ['almadar-std/ml'] }, { vector: false }], stubbed)).toEqual({ ok: false, error: 'behavior/catalog: unsupported option "vector"' });
  });

  it('a host failure (no orb) comes back as data', async () => {
    const out = await runProgramEffect('behavior/catalog', [{ paths: ['almadar-std/ui/core'] }], opts);
    expect(out.ok).toBe(false);
  });

  it('isProgramEffect names exactly the program effects', () => {
    expect(['behavior/catalog', 'behavior/describe', 'behavior/source', 'behavior/resolve', 'program/read', 'program/print', 'program/eval', 'program/compose'].every(isProgramEffect)).toBe(true);
    expect(isProgramEffect('behavior/apply')).toBe(false);
    expect(isProgramEffect('call-service')).toBe(false);
  });
});

describe.skipIf(!hasOrb)('runProgramEffect (real orb)', () => {
  it('program/read then program/eval with no workspace writes into the project', async () => {
    const cwd = project();
    const read = await runProgramEffect('program/read', [VALID], { cwd, orbBin: ORB });
    expect(read.ok).toBe(true);
    if (!read.ok || typeof read.result === 'string' || !('orbitals' in read.result)) return;
    const evald = await runProgramEffect('program/eval', [arg({ ...read.result, name: 'HelloApp' }), {}], { cwd, orbBin: ORB });
    expect(evald).toMatchObject({ ok: true, result: { behavior: './orbitals/HelloApp' } });
    expect(existsSync(join(cwd, 'orbitals', 'HelloApp.orb'))).toBe(true);
  });
});

describe.skipIf(!hasOrb)('behavior values: mounting a whole program (real orb)', () => {
  it('mounts a program program/eval wrote, opening on its first page', async () => {
    const cwd = project();
    const program = await programRead(VALID, { cwd, orbBin: ORB });
    const evaluated = await programEval({ ...program, name: 'HelloApp' }, { cwd, orbBin: ORB });
    if (!evaluated.ok) throw new Error('eval failed');
    const out = await mountBehaviorValue(evaluated.result.value, { cwd, orbBin: ORB });
    expect(out).toMatchObject({ ok: true, mounted: { firstPage: '/' } });
    if (out.ok) expect(out.mounted.schema.orbitals.map((o) => o.name)).toContain('Hello');
  });

  it('mounts an installed package behavior', async () => {
    const out = await mountBehaviorValue({ behavior: 'almadar-std/ui-accordion' }, { cwd: project(), orbBin: ORB });
    expect(out.ok).toBe(true);
  });

  it('control: a workspace program that does not exist is refused, not thrown', async () => {
    const out = await mountBehaviorValue({ behavior: './orbitals/Nope' }, { cwd: project(), orbBin: ORB });
    expect(out.ok).toBe(false);
  });

  it('control: an uninstalled package behavior is refused', async () => {
    const out = await mountBehaviorValue({ behavior: 'almadar-std/no-such-behavior' }, { cwd: project(), orbBin: ORB });
    expect(out.ok).toBe(false);
  });
});

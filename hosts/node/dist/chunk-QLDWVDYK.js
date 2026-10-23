import { installedWorkspaceHost, workspaceOwnerSegment } from './chunk-BWMLDDCL.js';
import { execFile, spawnSync } from 'child_process';
import { mkdtempSync, rmSync, readFileSync, mkdirSync, writeFileSync, existsSync } from 'fs';
import { randomUUID } from 'crypto';
import { tmpdir } from 'os';
import { relative, resolve, isAbsolute, sep, join } from 'path';
import { z } from 'zod';
import { createLogger } from '@almadar/logger';
import { resolveOrbBinary, discoverBehaviorPackages } from '@almadar/core/behavior-package';
import { EventPayloadSchema, SExprSchema, CatalogEntrySchema, formatTraitValueLiteral, BehaviorDescriptionSchema, mergeCallSiteConfigOverrides, defaultPage, importsOf, dependencyGraphOf, DescribeTargetSchema, CatalogScopeSchema, parseProgram, ProgramInspectionSchema, TraitDescriptionSchema } from '@almadar/core';
import { composeAppFromFiles, orbitalImportResolver, atomTraitResolver, organismOrderResolver } from '@almadar/core/builders';

var log = createLogger("almadar:integrations:program");
function runOrb(args, opts) {
  const bin = opts.orbBin ?? resolveOrbBinary(opts.cwd);
  return new Promise((done) => {
    execFile(bin, [...args], { cwd: opts.cwd, maxBuffer: 1024 * 1024 * 512 }, (error, stdout, stderr) => {
      const code = error === null ? 0 : typeof error.code === "number" ? error.code : 1;
      if (code !== 0) log.warn("orb exited non-zero", { args: args.join(" "), code, stderr });
      done({ stdout, stderr, code });
    });
  });
}
function runOrbSync(args, opts) {
  const bin = opts.orbBin ?? resolveOrbBinary(opts.cwd);
  const res = spawnSync(bin, [...args], { cwd: opts.cwd, maxBuffer: 1024 * 1024 * 512, encoding: "utf-8" });
  const code = res.error !== void 0 ? 1 : res.status ?? 1;
  const stderr = res.error !== void 0 ? res.error.message : res.stderr;
  if (code !== 0) log.warn("orb exited non-zero", { args: args.join(" "), code, stderr });
  return { stdout: res.stdout, stderr, code };
}
var ProgramParser = {
  safeParse(value) {
    try {
      return { success: true, data: parseProgram(value) };
    } catch (error) {
      return { success: false, error: { message: error instanceof Error ? error.message : String(error) } };
    }
  }
};
function parseJson(schema, run, what) {
  if (run.code !== 0) throw new Error(`${what}: orb exited ${run.code}: ${run.stderr.trim()}`);
  const parsed = schema.safeParse(JSON.parse(run.stdout));
  if (!parsed.success) throw new Error(`${what}: unexpected orb output: ${parsed.error.message}`);
  return parsed.data;
}
function withTempFile(name, content, use) {
  const dir = mkdtempSync(join(tmpdir(), "almadar-program-"));
  const path = join(dir, name);
  writeFileSync(path, content);
  return use(path).finally(() => rmSync(dir, { recursive: true, force: true }));
}
function withProjectFile(cwd, name, content, use) {
  const path = join(cwd, `.${randomUUID()}-${name}`);
  writeFileSync(path, content);
  return use(path).finally(() => rmSync(path, { force: true }));
}
async function behaviorCatalog(scope, opts, options = {}) {
  const exposure = (scope.exposure ?? []).flatMap((e) => ["--exposure", e]);
  const noVectors = options.vectors === false ? ["--no-vectors"] : [];
  const run = await runOrb(["behaviors", "catalog", "--json", ...noVectors, ...scope.paths, ...exposure], opts);
  return parseJson(CatalogEntrySchema.array(), run, "behavior/catalog");
}
function behaviorCatalogSync(scope, opts) {
  const exposure = (scope.exposure ?? []).flatMap((e) => ["--exposure", e]);
  return parseJson(CatalogEntrySchema.array(), runOrbSync(["behaviors", "catalog", "--json", ...scope.paths, ...exposure], opts), "behavior/catalog");
}
async function behaviorDescribe(value, opts, options = {}) {
  const knobVectors = options.knobVectors === true ? ["--knob-vectors"] : [];
  if ("trait" in value) {
    const run = await runOrb(["behaviors", "describe", "--json", ...knobVectors, formatTraitValueLiteral(value)], opts);
    return parseJson(TraitDescriptionSchema, run, "behavior/describe");
  }
  const spec = "orbital" in value ? `${value.behavior}.orbitals.${value.orbital}` : value.behavior;
  return parseJson(BehaviorDescriptionSchema, await runOrb(["behaviors", "describe", "--json", ...knobVectors, spec], opts), "behavior/describe");
}
function booleanOption(op, raw, key) {
  const options = raw ?? {};
  if (options === null || typeof options !== "object" || Array.isArray(options)) return `${op}: options must be an object`;
  let value;
  for (const [k, v] of Object.entries(options)) {
    if (k !== key) return `${op}: unsupported option "${k}"`;
    if (typeof v !== "boolean") return `${op}: ${key} must be a boolean`;
    value = v;
  }
  return value === void 0 ? {} : { value };
}
async function behaviorSource(value, opts) {
  const run = await runOrb(["behaviors", "source", "--json", value.behavior], opts);
  return parseJson(ProgramParser, run, "behavior/source");
}
function programRead(text, opts) {
  return withTempFile(
    "program.lolo",
    text,
    async (path) => parseJson(ProgramParser, await runOrb(["emit", "orb", path], opts), "program/read")
  );
}
async function programReadOutcome(text, opts) {
  return withTempFile("program.lolo", text, async (path) => {
    const run = await runOrb(["emit", "orb", path], opts);
    if (run.code !== 0) return fail(`program/read: orb exited ${run.code}: ${run.stderr.trim()}`);
    const parsed = ProgramParser.safeParse(JSON.parse(run.stdout));
    if (parsed.success) return { ok: true, result: parsed.data };
    const report = parseJson(ValidateReportSchema, await runOrb(["validate", "--json", "--deny-warnings", path], opts), "program/read");
    const issues = [...report.errors ?? [], ...report.warnings ?? []];
    if (issues.length === 0) return fail(`program/read: not a program: ${parsed.error.message}`);
    return { ok: false, error: `program/read: ${issues.length} validation issue(s): ${issues.map((e) => e.message).join("; ")}`, errors: issues };
  });
}
async function programInspectOutcome(text, raw, opts) {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return fail("program/read inspect: options must be an object");
  if (typeof raw.path !== "string" || !isAbsolute(raw.path)) return fail("program/read inspect: path must be the original absolute .lolo path");
  if (raw.version !== void 0 && raw.version !== null && (typeof raw.version !== "number" || !Number.isSafeInteger(raw.version) || raw.version < 0)) return fail("program/read inspect: version must be a nonnegative integer");
  const originalPath = raw.path;
  const version = raw.version;
  return withTempFile("program.lolo", text, async (path) => {
    const args = ["emit", "orb", path, "--inspect-source", originalPath];
    if (typeof version === "number") args.push("--document-version", String(version));
    const run = await runOrb(args, opts);
    if (run.code !== 0) return fail(`program/read inspect: orb exited ${run.code}: ${run.stderr.trim()}`);
    return { ok: true, result: parseJson(ProgramInspectionSchema, run, "program/read inspect") };
  });
}
function programPrint(program, opts) {
  return withTempFile("program.orb", JSON.stringify(program), async (path) => {
    const run = await runOrb(["emit", "lolo", path], opts);
    if (run.code !== 0) throw new Error(`program/print: orb exited ${run.code}: ${run.stderr.trim()}`);
    return run.stdout;
  });
}
var IssueSchema = z.object({
  code: z.string(),
  message: z.string(),
  path: z.string().optional(),
  line: z.number().optional(),
  column: z.number().optional()
});
var ValidateReportSchema = z.object({
  valid: z.boolean(),
  errors: z.array(IssueSchema).optional(),
  warnings: z.array(IssueSchema).optional()
});
function workspaceAccessError(behavior, opts, context) {
  const host = installedWorkspaceHost();
  if (host === null || !behavior.startsWith("./")) return void 0;
  const under = relative(host.root, resolve(opts.cwd, behavior));
  if (under.startsWith("..") || isAbsolute(under)) return void 0;
  const owner = under.split(sep)[0];
  if (context?.principal !== void 0 && workspaceOwnerSegment(context.principal) === owner) return void 0;
  return `behavior "${behavior}" is in another user's workspace`;
}
var PROGRAM_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
async function stampAndValidate(program, opts, dir, caller) {
  if (!PROGRAM_NAME.test(program.name)) {
    return { ok: false, errors: [{ code: "PROGRAM_NAME_INVALID", message: `program name "${program.name}" is not a file name` }] };
  }
  const input = join(dir, `${program.name}.orb`);
  const stamped = join(dir, `${program.name}.stamped.orb`);
  writeFileSync(input, JSON.stringify(program));
  const stampArgs = ["stamp", input, "-o", stamped];
  if (opts.prior !== void 0) {
    const priorPath = join(dir, "prior.orb");
    writeFileSync(priorPath, JSON.stringify(opts.prior));
    stampArgs.push("--prior", priorPath);
  }
  const stamp = await runOrb(stampArgs, opts);
  if (stamp.code !== 0) {
    return { ok: false, errors: [{ code: "PROGRAM_STAMP_FAILED", message: stamp.stderr.trim() }] };
  }
  const validateArgs = ["validate", "--json", "--deny-warnings", ...opts.final === true ? ["--final"] : [], stamped];
  const report = parseJson(ValidateReportSchema, await runOrb(validateArgs, opts), caller);
  const errors = report.errors ?? [];
  const warnings = report.warnings ?? [];
  return { ok: true, stamped, errors, warnings, valid: report.valid && errors.length === 0 && warnings.length === 0 };
}
async function programValidate(program, opts) {
  const dir = mkdtempSync(join(tmpdir(), "almadar-validate-"));
  try {
    const run = await stampAndValidate(program, opts, dir, "program/validate");
    return run.ok ? { valid: run.valid, errors: run.errors, warnings: run.warnings } : { valid: false, errors: run.errors, warnings: [] };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
async function programEval(program, opts) {
  const dir = mkdtempSync(join(tmpdir(), "almadar-eval-"));
  try {
    const run = await stampAndValidate(program, opts, dir, "program/eval");
    if (!run.ok) return { ok: false, errors: run.errors };
    const stamped = run.stamped;
    const issues = [...run.errors, ...run.warnings];
    if (!run.valid || issues.length > 0) return { ok: false, errors: issues };
    const written = ProgramParser.safeParse(JSON.parse(readFileSync(stamped, "utf-8")));
    if (!written.success) throw new Error(`program/eval: stamped program does not parse: ${written.error.message}`);
    const content = JSON.stringify(written.data, null, 2);
    let behavior;
    if (opts.workspace !== void 0) {
      const host = installedWorkspaceHost();
      if (host === null) return { ok: false, errors: [{ code: "PROGRAM_NO_WORKSPACE_HOST", message: "no workspace host is installed on this host" }] };
      if (opts.workspace.context.principal === void 0) {
        return { ok: false, errors: [{ code: "PROGRAM_WORKSPACE_UNAUTHORIZED", message: "a workspace eval needs a signed-in caller" }] };
      }
      const ws = await host.open(opts.workspace.id, opts.workspace.context);
      const rel = relative(opts.cwd, ws.workDir);
      if (rel.startsWith("..") || isAbsolute(rel)) {
        return { ok: false, errors: [{ code: "PROGRAM_WORKSPACE_OUTSIDE_PROJECT", message: `workspace ${ws.workDir} is outside the project ${opts.cwd}` }] };
      }
      await ws.writeFile(`orbitals/${program.name}.orb`, content);
      await ws.snapshot(`program/eval ${program.name}`);
      behavior = `./${rel.split(sep).join("/")}/orbitals/${program.name}`;
    } else {
      const target = join(opts.cwd, "orbitals");
      mkdirSync(target, { recursive: true });
      writeFileSync(join(target, `${program.name}.orb`), content);
      behavior = `./orbitals/${program.name}`;
    }
    const traits = written.data.orbitals.flatMap(
      (orbital) => orbital.traits.flatMap((t) => typeof t === "object" && "name" in t && typeof t.name === "string" ? [{ behavior, trait: t.name }] : [])
    );
    return { ok: true, result: { behavior, traits, value: { behavior } } };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
var LAYOUT_STRATEGIES = ["sidebar", "tabs", "dashboard", "wizard-flow", "single"];
function importSource(orbital) {
  const ref = orbital.reference?.ref;
  if (ref === void 0) return void 0;
  const [alias, kind, name] = ref.split(".");
  if (kind !== "orbitals" || name === void 0) return void 0;
  const use = (orbital.uses ?? []).find((u) => u.as === alias);
  return use === void 0 ? void 0 : { from: use.from, orbital: name };
}
var behaviorName = (from) => from.split("/").pop() ?? from;
async function programCompose(programs, options, opts) {
  const sources = /* @__PURE__ */ new Set();
  for (const program of programs) {
    for (const orbital of program.orbitals) for (const use of orbital.uses ?? []) sources.add(use.from);
  }
  const loaded = /* @__PURE__ */ new Map();
  for (const from of sources) loaded.set(behaviorName(from), await behaviorSource({ behavior: from }, opts));
  const load = (name) => loaded.get(name) ?? null;
  const byName = /* @__PURE__ */ new Map();
  for (const program of programs) for (const orbital of program.orbitals) byName.set(orbital.name, orbital);
  const catalogOrbitalOf = (name) => {
    const orbital = byName.get(name);
    const source = orbital === void 0 ? void 0 : importSource(orbital);
    return source === void 0 ? void 0 : { organism: behaviorName(source.from), orbital: source.orbital };
  };
  const composed = composeAppFromFiles(programs, {
    appName: options.appName,
    ...options.layout !== void 0 ? { layoutStrategy: options.layout } : {},
    organismOf: (name) => catalogOrbitalOf(name)?.organism,
    organismOrderOf: organismOrderResolver(catalogOrbitalOf, load),
    atomTraitOf: atomTraitResolver(load),
    importedOrbitalOf: orbitalImportResolver(load),
    importedProgramOf: (orbital) => {
      const source = importSource(orbital);
      return source === void 0 ? void 0 : load(behaviorName(source.from)) ?? void 0;
    }
  });
  return options.theme !== void 0 ? { ...composed.schema, theme: options.theme } : composed.schema;
}
async function mountTraitValue(value, opts, context) {
  const denied = workspaceAccessError(value.behavior, opts, context);
  if (denied !== void 0) return { ok: false, error: denied };
  let source;
  try {
    source = await behaviorSource(value, opts);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
  const owner = source.orbitals.find(
    (o) => o.traits.some((t) => typeof t === "object" && !("ref" in t) && t.name === value.trait)
  );
  if (owner === void 0) {
    return { ok: false, error: `behavior "${value.behavior}" declares no inline trait "${value.trait}"` };
  }
  const { behavior, trait, config, ...rest } = value;
  const overrides = config !== void 0 ? { ...rest, config: mergeCallSiteConfigOverrides({}, config) } : rest;
  const projectRelative = behavior.startsWith("./");
  const page = (owner.pages ?? []).find((p) => typeof p === "object" && "path" in p && (p.traits ?? []).some((t) => (typeof t === "string" ? t : "ref" in t ? t.ref : t.name) === trait));
  const wrapper = {
    name: `Mount${trait}`,
    orbitals: [
      {
        name: "Mounted",
        entity: `Bound.orbitals.${owner.name}.entity`,
        reference: {
          ref: `Bound.orbitals.${owner.name}`,
          only: [trait],
          ...Object.keys(overrides).length > 0 ? { traits: { [trait]: overrides } } : {}
        },
        traits: [],
        pages: [],
        uses: [{ as: "Bound", from: behavior }]
      }
    ]
  };
  const check = async (path) => {
    const report = parseJson(ValidateReportSchema, await runOrb(["validate", "--json", "--deny-warnings", path], opts), "mount");
    const issues = [...report.errors ?? [], ...report.warnings ?? []];
    if (!report.valid || issues.length > 0) {
      return { ok: false, error: `trait value ${formatTraitValueLiteral(value)} does not validate where it is bound`, errors: issues };
    }
    const schema = parseJson(ProgramParser, await runOrb(["resolve", path], opts), "mount");
    const pagePath = page !== void 0 && typeof page === "object" && "path" in page ? page.path : void 0;
    return { ok: true, mounted: { schema, orbital: "Mounted", trait: `Mounted${trait}`, ...pagePath !== void 0 ? { pagePath } : {} } };
  };
  const text = JSON.stringify(wrapper);
  return projectRelative ? withProjectFile(opts.cwd, "mount.orb", text, check) : withTempFile("mount.orb", text, check);
}
var WHICH_LINE = /^(\/\S+\.(?:orb|lolo)) \((.+)\)$/;
async function behaviorFile(behavior, opts) {
  if (behavior.startsWith("./")) {
    const path = `${resolve(opts.cwd, behavior)}.orb`;
    return existsSync(path) ? path : { error: `no program at ${behavior}` };
  }
  const run = await runOrb(["behaviors", "which", behavior], opts);
  const line = run.stdout.trim().split("\n").pop() ?? "";
  const match = WHICH_LINE.exec(line);
  if (run.code !== 0 || match === null) return { error: `behavior "${behavior}" is not installed${run.stderr.trim() ? `: ${run.stderr.trim()}` : ""}` };
  return match[1];
}
async function mountBehaviorValue(value, opts, context) {
  const denied = workspaceAccessError(value.behavior, opts, context);
  if (denied !== void 0) return { ok: false, error: denied };
  const file = await behaviorFile(value.behavior, opts);
  if (typeof file !== "string") return { ok: false, error: file.error };
  const report = parseJson(ValidateReportSchema, await runOrb(["validate", "--json", "--deny-warnings", file], opts), "mount");
  const issues = [...report.errors ?? [], ...report.warnings ?? []];
  if (!report.valid || issues.length > 0) {
    return { ok: false, error: `behavior ${value.behavior} does not validate`, errors: issues };
  }
  const schema = parseJson(ProgramParser, await runOrb(["resolve", file], opts), "mount");
  const firstPage = defaultPage(schema)?.page.path;
  if (firstPage === void 0) return { ok: false, error: `behavior ${value.behavior} has no page to open` };
  return { ok: true, mounted: { schema, firstPage } };
}
async function programResolve(path, opts) {
  return parseJson(ProgramParser, await runOrb(["resolve", path], opts), "program/resolve");
}
function programResolveSchema(program, opts) {
  return withProjectFile(opts.cwd, "program.orb", JSON.stringify(program), (path) => programResolve(path, opts));
}
async function behaviorResolve(value, opts) {
  const file = await behaviorFile(value.behavior, opts);
  if (typeof file !== "string") return file;
  return parseJson(ProgramParser, await runOrb(["resolve", file], opts), "behavior/resolve");
}
function installedBehaviorIndex(opts) {
  const out = /* @__PURE__ */ new Map();
  for (const pkg of discoverBehaviorPackages(opts.cwd)) {
    const tier = pkg.name === "@almadar/std" ? "std" : pkg.name === "@almadar-io/behaviors" ? "io" : "unknown";
    const catalog = parseJson(CatalogEntrySchema.array(), runOrbSync(["behaviors", "catalog", "--json", "--no-vectors", pkg.orb.prefix], opts), "behavior/dependencies");
    for (const entry of catalog) {
      const name = entry.behavior.slice(pkg.orb.prefix.length + 1);
      if (!out.has(name)) out.set(name, { tier, prefix: pkg.orb.prefix, ...entry.pattern !== void 0 ? { pattern: entry.pattern } : {} });
    }
  }
  return out;
}
async function behaviorDependencies(program, opts) {
  const index = installedBehaviorIndex(opts);
  const orbs = /* @__PURE__ */ new Map();
  let frontier = [...new Set(importsOf(program, () => "unknown").map((i) => i.behavior))];
  while (frontier.length > 0) {
    const loaded = await Promise.all(
      frontier.map(async (name) => {
        const entry = index.get(name);
        return [name, entry ? await behaviorSource({ behavior: `${entry.prefix}/${name}` }, opts) : null];
      })
    );
    const next = /* @__PURE__ */ new Set();
    for (const [name, orb] of loaded) {
      orbs.set(name, orb);
      for (const i of orb ? importsOf(orb, () => "unknown") : []) if (!orbs.has(i.behavior)) next.add(i.behavior);
    }
    frontier = [...next].filter((n) => !orbs.has(n));
  }
  return dependencyGraphOf(program, {
    tierOf: (n) => index.get(n)?.tier ?? "unknown",
    orbOf: (n) => orbs.get(n) ?? null,
    patternOf: (n) => index.get(n)?.pattern
  });
}
var StepRequestSchema = z.object({
  orbital: z.string(),
  trait: z.string(),
  from: z.string(),
  event: z.string(),
  payload: EventPayloadSchema,
  entity: EventPayloadSchema.optional(),
  config: EventPayloadSchema.optional(),
  now: z.number().optional(),
  settleMs: z.number().optional(),
  viewer: EventPayloadSchema.nullable().optional()
});
var StepOutcomeSchema = z.object({
  orbital: z.string(),
  trait: z.string(),
  event: z.string(),
  executed: z.boolean(),
  previousState: z.string(),
  newState: z.string(),
  emits: z.array(z.object({ event: z.string(), payload: EventPayloadSchema.nullable() })),
  firedArm: z.number().int().nullable(),
  guards: z.array(z.object({ arm: z.number().int(), guard: SExprSchema, passed: z.boolean(), error: z.string().optional() })),
  effects: z.array(z.object({ type: z.string(), args: z.array(SExprSchema), status: z.enum(["executed", "failed", "skipped"]), error: z.string().optional() }))
});
var StepReportSchema = z.union([
  z.object({ success: z.literal(true), steps: z.array(z.object({ outcomes: z.array(StepOutcomeSchema), entityAfter: EventPayloadSchema.nullable() })) }),
  z.object({ success: z.literal(false), error: z.string() })
]);
function effectsOf(effects) {
  return effects.map((e) => ({ type: e.type, args: e.args, status: e.status, ...e.error !== void 0 ? { error: e.error } : {} }));
}
function emittedOf(emits, step) {
  return emits.map((e) => ({ type: e.event, ...e.payload !== null ? { payload: e.payload } : {}, timestamp: step }));
}
async function programStep(program, requests, opts, live = false) {
  const steps = requests.map((r) => ({ trait: r.trait, event: r.event, payload: r.payload, from: r.from, ...r.entity !== void 0 ? { entity: r.entity } : {}, ...r.config !== void 0 ? { config: r.config } : {}, ...r.now !== void 0 ? { now: r.now } : {}, ...r.settleMs !== void 0 ? { settleMs: r.settleMs } : {}, ...r.viewer !== void 0 ? { viewer: r.viewer } : {} }));
  return withTempFile("program.orb", JSON.stringify(program), async (path) => {
    const run = await runOrb(["execute", path, "--steps", JSON.stringify(steps), ...live ? ["--live"] : []], opts);
    const report = parseJson(StepReportSchema, run, "program/step");
    if (!report.success) return { error: report.error };
    const results = [];
    for (const [i, request] of requests.entries()) {
      const moved = report.steps[i]?.outcomes ?? [];
      const outcome = moved.find((o) => o.trait === request.trait);
      if (outcome === void 0) return { error: `trait "${request.trait}" did not run` };
      const firedGuarded = outcome.firedArm !== null && outcome.guards.some((g) => g.arm === outcome.firedArm);
      results.push({ ...request, result: {
        trait: outcome.trait,
        event: request.event,
        transitionFired: outcome.executed,
        guard: firedGuarded ? "pass" : outcome.firedArm === null && outcome.guards.length > 0 ? "fail" : "none",
        ...outcome.firedArm !== null ? { firedArm: outcome.firedArm } : {},
        state: { before: outcome.previousState, after: outcome.newState },
        effects: effectsOf(outcome.effects),
        emitted: emittedOf(outcome.emits, i),
        guards: outcome.guards.map((g) => ({ arm: g.arm, guard: g.guard, passed: g.passed, trace: [], ...g.error !== void 0 ? { error: g.error } : {} })),
        entityAfter: report.steps[i]?.entityAfter ?? null,
        outcomes: moved.map((o) => ({ orbital: o.orbital, trait: o.trait, event: o.event, from: o.previousState, to: o.newState, arm: o.firedArm, fired: o.executed, effects: effectsOf(o.effects), emitted: emittedOf(o.emits, i) }))
      } });
    }
    return results;
  });
}
function fail(error) {
  return { ok: false, error };
}
function issuesOf(error) {
  return error.issues.map((i) => i.path.length > 0 ? `${i.path.join(".")}: ${i.message}` : i.message).join("; ");
}
function programArg(op, value) {
  const parsed = ProgramParser.safeParse(value);
  return parsed.success ? parsed.data : `${op}: not a program: ${parsed.error.message}`;
}
async function runProgramEffect(op, args, opts, context) {
  log.debug("effect", { op, args: JSON.stringify(args) });
  try {
    switch (op) {
      case "behavior/catalog": {
        const scope = CatalogScopeSchema.safeParse(args[0]);
        if (!scope.success) return fail(`behavior/catalog: ${issuesOf(scope.error)}`);
        const vectors = booleanOption(op, args[1], "vectors");
        if (typeof vectors === "string") return fail(vectors);
        return { ok: true, result: await behaviorCatalog(scope.data, opts, vectors.value === void 0 ? {} : { vectors: vectors.value }) };
      }
      case "behavior/describe": {
        const value = DescribeTargetSchema.safeParse(args[0]);
        if (!value.success) return fail(`${op}: ${issuesOf(value.error)}`);
        const knobVectors = booleanOption(op, args[1], "knobVectors");
        if (typeof knobVectors === "string") return fail(knobVectors);
        const denied = workspaceAccessError(value.data.behavior, opts, context);
        if (denied !== void 0) return fail(`${op}: ${denied}`);
        return { ok: true, result: await behaviorDescribe(value.data, opts, knobVectors.value === void 0 ? {} : { knobVectors: knobVectors.value }) };
      }
      case "behavior/source": {
        const value = DescribeTargetSchema.safeParse(args[0]);
        if (!value.success) return fail(`${op}: ${issuesOf(value.error)}`);
        const denied = workspaceAccessError(value.data.behavior, opts, context);
        if (denied !== void 0) return fail(`${op}: ${denied}`);
        return { ok: true, result: await behaviorSource(value.data, opts) };
      }
      case "behavior/resolve": {
        const value = DescribeTargetSchema.safeParse(args[0]);
        if (!value.success) return fail(`${op}: ${issuesOf(value.error)}`);
        const denied = workspaceAccessError(value.data.behavior, opts, context);
        if (denied !== void 0) return fail(`${op}: ${denied}`);
        const resolved = await behaviorResolve(value.data, opts);
        return "error" in resolved ? fail(`${op}: ${resolved.error}`) : { ok: true, result: resolved };
      }
      case "program/step": {
        const program = programArg(op, args[0]);
        if (typeof program === "string") return fail(program);
        const requests = z.array(StepRequestSchema).safeParse(args[1]);
        if (!requests.success) return fail(`${op}: ${issuesOf(requests.error)}`);
        const options = args[2];
        const live = options !== null && typeof options === "object" && !Array.isArray(options) ? options["live"] : void 0;
        if (live !== void 0 && live !== null && typeof live !== "boolean") return fail(`${op}: options.live must be a boolean`);
        const played = await programStep(program, requests.data, opts, live === true);
        return "error" in played ? fail(`${op}: ${played.error}`) : { ok: true, result: played };
      }
      case "behavior/dependencies": {
        const program = programArg(op, args[0]);
        return typeof program === "string" ? fail(program) : { ok: true, result: await behaviorDependencies(program, opts) };
      }
      case "program/read": {
        if (typeof args[0] !== "string") return fail("program/read: expected .lolo text");
        const options = args[1];
        if (options !== null && typeof options === "object" && !Array.isArray(options) && options.inspect === true) return programInspectOutcome(args[0], options, opts);
        return programReadOutcome(args[0], opts);
      }
      case "program/print": {
        const program = programArg(op, args[0]);
        return typeof program === "string" ? fail(program) : { ok: true, result: await programPrint(program, opts) };
      }
      case "program/compose": {
        if (!Array.isArray(args[0])) return fail("program/compose: expected a list of programs");
        const programs = [];
        for (const raw of args[0]) {
          const program = programArg(op, raw);
          if (typeof program === "string") return fail(program);
          programs.push(program);
        }
        const options = args[1];
        if (options === null || options === void 0 || typeof options !== "object" || Array.isArray(options)) {
          return fail("program/compose: options must be an object with an appName");
        }
        let appName;
        let layout;
        let theme;
        for (const [key, value] of Object.entries(options)) {
          if (key === "appName" && typeof value === "string" && value.length > 0) appName = value;
          else if (key === "theme" && typeof value === "string") theme = value.length > 0 ? value : void 0;
          else if (key === "layout") {
            const match = LAYOUT_STRATEGIES.find((l) => l === value);
            if (match === void 0) return fail(`program/compose: layout must be one of ${LAYOUT_STRATEGIES.join(", ")}`);
            layout = match;
          } else return fail(`program/compose: unsupported option "${key}"`);
        }
        if (appName === void 0) return fail("program/compose: options must name the app (appName)");
        return { ok: true, result: await programCompose(programs, { appName, ...layout !== void 0 ? { layout } : {}, ...theme !== void 0 ? { theme } : {} }, opts) };
      }
      case "program/validate": {
        const program = programArg(op, args[0]);
        if (typeof program === "string") return fail(program);
        const options = args[1] ?? {};
        if (options === null || typeof options !== "object" || Array.isArray(options)) return fail("program/validate: options must be an object");
        let prior;
        let final;
        for (const [key, value] of Object.entries(options)) {
          if (key === "final") {
            if (typeof value !== "boolean") return fail("program/validate: final must be a boolean");
            final = value;
          } else if (key === "prior") {
            const p = programArg("program/validate prior", value);
            if (typeof p === "string") return fail(p);
            prior = p;
          } else return fail(`program/validate: unsupported option "${key}"`);
        }
        return { ok: true, result: await programValidate(program, { ...opts, ...prior !== void 0 ? { prior } : {}, ...final !== void 0 ? { final } : {} }) };
      }
      case "program/eval": {
        const program = programArg(op, args[0]);
        if (typeof program === "string") return fail(program);
        const options = args[1] ?? {};
        if (options === null || typeof options !== "object" || Array.isArray(options)) return fail("program/eval: options must be an object");
        let workspace;
        let prior;
        let final;
        for (const [key, value] of Object.entries(options)) {
          if (key === "workspace") {
            if (typeof value !== "string" || value === "") return fail("program/eval: workspace must be a non-empty id");
            workspace = value;
          } else if (key === "final") {
            if (typeof value !== "boolean") return fail("program/eval: final must be a boolean");
            final = value;
          } else if (key === "prior") {
            const p = programArg("program/eval prior", value);
            if (typeof p === "string") return fail(p);
            prior = p;
          } else return fail(`program/eval: unsupported option "${key}"`);
        }
        const outcome = await programEval(program, { ...opts, ...workspace !== void 0 ? { workspace: { id: workspace, context: context ?? {} } } : {}, ...prior !== void 0 ? { prior } : {}, ...final !== void 0 ? { final } : {} });
        if (outcome.ok) return { ok: true, result: outcome.result };
        return { ok: false, error: `program/eval: ${outcome.errors.length} validation issue(s): ${outcome.errors.map((e) => e.message).join("; ")}`, errors: outcome.errors };
      }
    }
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
}

export { behaviorCatalog, behaviorCatalogSync, behaviorDependencies, behaviorDescribe, behaviorResolve, behaviorSource, mountBehaviorValue, mountTraitValue, programCompose, programEval, programPrint, programRead, programResolve, programResolveSchema, programStep, programValidate, runProgramEffect, workspaceAccessError };

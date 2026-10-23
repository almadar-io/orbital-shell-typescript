import { PinnedFetch, CredentialScopeStorage, NetPort, ResolvedHost, OsAnchors, OsGrantPort, OsHostPort, KernelModule, HttpKernel, CredentialSeedKernel, NativeMemoryPersistenceAdapter, ServiceCallContext, StepRequest, PlayedStep, ProgramValidationReport, ProgramEffectName, ProgramEffectOutcome } from '@almadar/shell-runtime';
import { JsonValue, KernelMemoryStoreExports, OrbitalSchema, EvaluatedProgram, ProgramValidationIssue, CatalogScope, CatalogEntry, DependencyGraph, TraitValue, TraitDescription, DescribeTarget, BehaviorDescription, BehaviorRef, BehaviorValueMountResult, TraitValueMountResult } from '@almadar/core';
export { ClientEffectTuple, ClientNavigateBackTuple, ClientNavigateTuple, ClientRenderUITuple, OrbitalEventRequest, OrbitalEventResponse, TransitionRejection } from '@almadar/core';
import * as installedModule from '@almadar/kernel';
import { LayoutStrategy } from '@almadar/core/builders';
export { G as GCS_ENDPOINT, K as KernelProgram, a as KernelProgramOptions, b as KernelWorkspaceBucket, c as KernelWorkspaceHostOptions, P as ProgramRun, W as WORKSPACE_HMAC_KEY_ID, d as WORKSPACE_HMAC_SECRET, e as WorkspaceHost, f as WorkspacePort, g as emitPayload, i as installWorkspaceHost, h as installedWorkspaceHost, k as kernelWorkspaceHost, r as resolveKernelDir, j as resolveProgramFile, u as uninstallWorkspaceHost, w as workspaceBucketFromEnv, l as workspaceOwnerSegment, m as workspacesRoot } from './kernel-workspace-host-DjBiKHU0.js';
export { HostDispatchItem, LiveBroadcastItem, LoaderConfig, OrbitalInfo, OrbitalServerRuntime, OrbitalServerRuntimeConfig, OrbitalSummary, PushItem, RegisterOptions, RegisteredOrbital, RuntimeOrbital, RuntimeOrbitalSchema, RuntimeTrait, RuntimeTraitTick, UnresolvedProgramError, createOrbitalServerRuntime } from './OrbitalServerRuntime.js';
export { ProgramHandlers, ProgramHostConfig, createProgramHandlers } from './createProgramHandlers.js';

declare const pinnedFetchNode: PinnedFetch;

declare function resolveHostNode(host: string): Promise<ResolvedHost>;
declare const nodeNetPort: NetPort;
declare function nodeCredentialScope(): CredentialScopeStorage;
/** Install the Node ports `@almadar/shell-runtime` leaves open: the pinned `http` fetch + resolver and per-tenant credential scopes. Idempotent. */
declare function installNodeHostPorts(): void;

/**
 * A development host's credential-store master key: read from `<dir>/dev-credential-master-key`,
 * generated there (owner-only) on first use. Production must hold its key in the platform secret
 * store, so this refuses under NODE_ENV=production.
 */
declare function loadOrCreateDevMasterKey(dir: string): string;

/** One program instance's `os` host: its own handle tables, closed by `close`. */
interface NodeOsHostOptions {
    /** Where `~/` and `./` and the declared grant anchors are placed; absent, the process's own (`OsAnchors::of_process`). */
    anchors?: OsAnchors;
}
/** The process's home, working directory, executable directory and environment, read once (`OsAnchors::of_process`). */
declare function processAnchors(): OsAnchors;
declare function createNodeOsHost(grants: OsGrantPort, options?: NodeOsHostOptions): OsHostPort;

type KvErrorKind = 'denied' | 'invalid' | 'io' | 'timeout' | 'unsupported' | 'closed';
type KvResult<T> = {
    ok: true;
    value: T;
} | {
    ok: false;
    error: string;
    kind: KvErrorKind;
};
interface KvNamespace {
    app: string;
    locale: string;
    store: string;
}
interface KvScanEntry {
    key: string;
    value: JsonValue;
}
type KvBatchOp = {
    kind: 'put';
    key: string;
    value: JsonValue;
} | {
    kind: 'delete';
    key: string;
};
declare class KvFailure extends Error {
    readonly kind: KvErrorKind;
    constructor(kind: KvErrorKind, message: string);
}
/** A namespace's whole content, key order = UTF-8 byte order. Backends load and commit it whole. */
type KvTable = Map<string, JsonValue>;
interface KvBackend {
    load(ns: KvNamespace): Promise<KvTable>;
    /** Replace the namespace content atomically: a failure leaves the previous content. */
    commit(ns: KvNamespace, table: KvTable): Promise<void>;
}
declare function namespaceId(ns: KvNamespace): string;
declare function memoryKvBackend(): KvBackend;
declare function directoryKvBackend(stateDir: string): KvBackend;
interface KvHost {
    get(ns: KvNamespace, key: string): Promise<KvResult<{
        found: boolean;
        value?: JsonValue;
    }>>;
    put(ns: KvNamespace, key: string, value: JsonValue): Promise<KvResult<{
        storedKey: string;
    }>>;
    delete(ns: KvNamespace, key: string): Promise<KvResult<{
        existed: boolean;
    }>>;
    scan(ns: KvNamespace, prefix: string, limit?: number): Promise<KvResult<{
        entries: KvScanEntry[];
    }>>;
    batch(ns: KvNamespace, ops: readonly KvBatchOp[]): Promise<KvResult<{
        applied: number;
    }>>;
}
declare function createKvHost(backend: KvBackend): KvHost;

/** The whole server kernel as Node loads it: the shared module plus the server-only exports the client build omits. */
interface LoadedKernel extends KernelModule, HttpKernel, CredentialSeedKernel, KernelMemoryStoreExports {
    initSync(input: {
        module: Uint8Array;
    }): object;
}
/** A row store the kernel itself holds (its `MemoryStore`), as a host keeps rows with no database. */
declare function nativeMemoryOf(kernel: KernelModule): NativeMemoryPersistenceAdapter;
interface LoadKernelOptions {
    /** Where the installed `@almadar/core` and `@almadar/std` are found, node-style. Required: the caller names its own root. */
    languageFrom: string;
}
/**
 * Loads the kernel and installs the language data the installed packages declare (the operator table that
 * routes `program/*` and the other host effects), as `orb` reads it. The first install in a process wins.
 */
declare function loadKernelModule(kernelDir: string, options: LoadKernelOptions): Promise<LoadedKernel>;
/**
 * The kernel of the `@almadar/kernel` package this host installs, initialised synchronously with the language data
 * the packages under `languageFrom` declare. `languageFrom` is required; the first call in a process wins.
 */
declare function initKernelSync(languageFrom: string): typeof installedModule;
/**
 * The kernel of the `@almadar/kernel` package this host installs, loaded once per process with the language data
 * the packages under `languageFrom` declare. A host with no package installed rejects, never falls back.
 */
declare function loadInstalledKernel(languageFrom: string): Promise<LoadedKernel>;
/**
 * The `http` effect's builder exports of the same package (`buildHttpRequest`, `isPublicAddress`, …): the
 * interpreter's only way to build a request. A directory that does not hold a built kernel rejects, never falls back.
 */
declare function loadHttpKernel(kernelDir: string, options: LoadKernelOptions): Promise<HttpKernel>;
/**
 * Where the native kernel add-on is: `ALMADAR_KERNEL_NODE`, else `kernel.node` in the `@almadar/orb-<platform>-<arch>`
 * package this platform installs. Rejects when neither exists, so a host can fall back to the wasm kernel by choice.
 */
declare function resolveNativeAddon(from: string): string;
/**
 * Loads the native kernel add-on (the same API as the wasm module, run as machine code) and installs the language data
 * the installed packages declare. The first install in a process wins.
 */
declare function loadNativeKernelModule(addonPath: string, options: LoadKernelOptions): Promise<LoadedKernel>;

/**
 * The host side of the language trio's server effects (`behavior/catalog`,
 * `behavior/describe`, `behavior/source`, `behavior/resolve`, `behavior/dependencies`, `program/read|print|eval`): a thin
 * caller that runs the installed `orb` from the project directory and parses its
 * JSON. All behavior resolution, reflection, printing and validation is `orb`'s;
 * nothing here re-implements it. Both execution paths (the interpreter's effect
 * executor and the compiled server host) call this module.
 *
 * @packageDocumentation
 */

/** Where the host runs `orb`: the project (workspace) root, so installed behavior packages resolve. */
interface ProgramHostOptions {
    readonly cwd: string;
    /** Explicit `orb` binary; defaults to {@link resolveOrbBinary}. */
    readonly orbBin?: string;
}
/** `behavior/catalog`: installed behaviors under registry folders; `vectors: false` omits the vectors (`--no-vectors`). */
declare function behaviorCatalog(scope: CatalogScope, opts: ProgramHostOptions, options?: {
    readonly vectors?: boolean;
}): Promise<CatalogEntry[]>;
/** {@link behaviorCatalog} for a caller that cannot await. */
declare function behaviorCatalogSync(scope: CatalogScope, opts: ProgramHostOptions): CatalogEntry[];
/** `behavior/describe`: a trait value's knobs and events; an orbital value's or a whole behavior's orbitals.
 * `knobVectors: true` attaches a trait's knob vectors (`--knob-vectors`). */
declare function behaviorDescribe(value: TraitValue, opts: ProgramHostOptions, options?: {
    readonly knobVectors?: boolean;
}): Promise<TraitDescription>;
declare function behaviorDescribe(value: DescribeTarget, opts: ProgramHostOptions, options?: {
    readonly knobVectors?: boolean;
}): Promise<TraitDescription | BehaviorDescription>;
/** `behavior/source`: the behavior a value belongs to, as a program (`.orb` IR). */
declare function behaviorSource(value: Pick<TraitValue, 'behavior'>, opts: ProgramHostOptions): Promise<OrbitalSchema>;
/** `program/read`: `.lolo` text → a program (`.orb` IR). */
declare function programRead(text: string, opts: ProgramHostOptions): Promise<OrbitalSchema>;
/** `program/print`: a program (`.orb` IR) → `.lolo` text. */
declare function programPrint(program: OrbitalSchema, opts: ProgramHostOptions): Promise<string>;
/** Who runs a program effect: the signed-in caller, as `call-service` receives it. */
type ProgramCallContext = Pick<ServiceCallContext, 'principal' | 'role'>;
/**
 * A workspace-backed specifier (`./<workspaces root>/<owner>/…`) is readable
 * only by its owner; every other specifier is unaffected. Returns the refusal,
 * or undefined when the caller may read it.
 */
declare function workspaceAccessError(behavior: string, opts: ProgramHostOptions, context: ProgramCallContext | undefined): string | undefined;
/** Options for {@link programEval}. */
interface ProgramEvalOptions extends ProgramHostOptions {
    /** Write into this workspace (opened as `context`'s caller) and snapshot it; without one, into `<cwd>/orbitals`. */
    readonly workspace?: {
        readonly id: string;
        readonly context: ProgramCallContext;
    };
    /** A prior version of the program whose ids the re-evaluation keeps. */
    readonly prior?: OrbitalSchema;
    /** The program is a finished app (a generation concludes here): `orb validate --final`. */
    readonly final?: boolean;
}
type ProgramEvalResult = {
    readonly ok: true;
    readonly result: EvaluatedProgram;
} | {
    readonly ok: false;
    readonly errors: readonly ProgramValidationIssue[];
};
/**
 * `program/validate`: the same stamp-and-validate call as `program/eval`, at the same
 * 0-error / 0-warning bar, in a temp directory that is removed after. Nothing is written
 * to the workspace or the project.
 */
declare function programValidate(program: OrbitalSchema, opts: Pick<ProgramEvalOptions, 'cwd' | 'prior' | 'final'> & ProgramHostOptions): Promise<ProgramValidationReport>;
/**
 * `program/eval`: validate through {@link stampAndValidate}, and on success write the program to `orbitals/<name>.orb` in its workspace (or `cwd`)
 * and return its traits as values. Failures come back as data.
 */
declare function programEval(program: OrbitalSchema, opts: ProgramEvalOptions): Promise<ProgramEvalResult>;
/** Options for {@link programCompose}. */
interface ProgramComposeOptions {
    readonly appName: string;
    readonly layout?: LayoutStrategy;
    /** The app's theme (a built-in theme name), set on the composed program. */
    readonly theme?: string;
}
/**
 * `program/compose`: assemble programs, in the order given, into one app
 * program — core `composeAppFromFiles` (pages, layout, wiring, the app nav).
 * The composer's registry lookups (an import's source orbital, an atom's trait,
 * an organism's orbital order) are served from `orb behaviors source` for every
 * behavior the programs import, loaded once up front.
 */
declare function programCompose(programs: readonly OrbitalSchema[], options: ProgramComposeOptions, opts: ProgramHostOptions): Promise<OrbitalSchema>;
/**
 * Turn a trait value into a program a host can run: a one-orbital wrapper that
 * imports the value's owning orbital with `only { T }` and the value's overrides
 * as `traits { T { … } }` (LOLO §8b), validated at the 0/0 bar (the binding's
 * admission check) and resolved by `orb`. A project-relative behavior
 * (`./orbitals/X`) is imported relatively from a wrapper written at `cwd`, since
 * `orb`'s loader refuses an absolute import.
 */
declare function mountTraitValue(value: TraitValue, opts: ProgramHostOptions, context?: ProgramCallContext): Promise<TraitValueMountResult>;
/**
 * Make a behavior value runnable: the program as written is validated at the
 * 0/0 bar (the embed's admission check) and resolved by `orb`; the frame opens
 * it on its default page (the one marked `initial`, else the first).
 */
declare function mountBehaviorValue(value: BehaviorRef, opts: ProgramHostOptions, context?: ProgramCallContext): Promise<BehaviorValueMountResult>;
/** A program file resolved by `orb` (every import flattened, every composed trait inlined): what a host registers. */
declare function programResolve(path: string, opts: ProgramHostOptions): Promise<OrbitalSchema>;
/** An unresolved program resolved by `orb` from the project root `opts.cwd`, so its relative imports resolve there. */
declare function programResolveSchema(program: OrbitalSchema, opts: ProgramHostOptions): Promise<OrbitalSchema>;
/** `behavior/resolve`: the behavior a value belongs to, resolved by `orb` — every import and composed trait inlined, as the runtime runs it. */
declare function behaviorResolve(value: Pick<TraitValue, 'behavior'>, opts: ProgramHostOptions): Promise<OrbitalSchema | {
    error: string;
}>;
/** `behavior/dependencies`: a program's dependency graph — each orbital's imports, then every installed behavior they reach, with its layer and its own imports. */
declare function behaviorDependencies(program: OrbitalSchema, opts: ProgramHostOptions): Promise<DependencyGraph>;
declare function programStep(program: OrbitalSchema, requests: readonly StepRequest[], opts: ProgramHostOptions, live?: boolean): Promise<PlayedStep[] | {
    error: string;
}>;
type EffectArg = JsonValue;
/**
 * Parse one program effect's positional arguments (the trailing emit config
 * already removed) and run it. Both execution paths call this — the
 * interpreter's effect executor and the compiled server handlers — so argument
 * validation has one owner. Failures come back as data, never thrown.
 */
declare function runProgramEffect(op: ProgramEffectName, args: readonly EffectArg[], opts: ProgramHostOptions, context?: ProgramCallContext): Promise<ProgramEffectOutcome>;

export { type KvBackend, type KvBatchOp, type KvErrorKind, KvFailure, type KvHost, type KvNamespace, type KvResult, type KvScanEntry, type KvTable, type LoadKernelOptions, type LoadedKernel, type NodeOsHostOptions, type ProgramCallContext, type ProgramComposeOptions, type ProgramEvalOptions, type ProgramEvalResult, type ProgramHostOptions, behaviorCatalog, behaviorCatalogSync, behaviorDependencies, behaviorDescribe, behaviorResolve, behaviorSource, createKvHost, createNodeOsHost, directoryKvBackend, initKernelSync, installNodeHostPorts, loadHttpKernel, loadInstalledKernel, loadKernelModule, loadNativeKernelModule, loadOrCreateDevMasterKey, memoryKvBackend, mountBehaviorValue, mountTraitValue, namespaceId, nativeMemoryOf, nodeCredentialScope, nodeNetPort, pinnedFetchNode, processAnchors, programCompose, programEval, programPrint, programRead, programResolve, programResolveSchema, programStep, programValidate, resolveHostNode, resolveNativeAddon, runProgramEffect, workspaceAccessError };

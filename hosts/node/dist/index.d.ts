import { PinnedFetch, OsAnchors, OsGrantPort, OsHostPort, KernelModule, HttpKernel, CredentialSeedKernel, ServiceCallContext, StepRequest, PlayedStep, ProgramValidationReport, ProgramEffectName, ProgramEffectOutcome, HttpPortsOptions, CredentialScopeStorage, NetPort, ResolvedHost } from '@almadar/shell-web';
import { JsonValue, OrbitalSchema, EvaluatedProgram, ProgramValidationIssue, CatalogScope, CatalogEntry, DependencyGraph, TraitValue, TraitDescription, DescribeTarget, BehaviorDescription, BehaviorRef, BehaviorValueMountResult, TraitValueMountResult, EntityRow, EventPayload, UserContext, EmittedEvent, TransitionRejection, InboundDelivery, InboundAnswer } from '@almadar/core';
import * as installedModule from '@almadar/kernel';
import { LayoutStrategy } from '@almadar/core/builders';

declare const pinnedFetchNode: PinnedFetch;

/**
 * A development host's credential-store master key: read from `<dir>/dev-credential-master-key`,
 * generated there (owner-only) on first use. Production must hold its key in the platform secret
 * store, so this refuses under NODE_ENV=production.
 */
declare function loadOrCreateDevMasterKey(dir: string): string;

/** One program instance's `os` host: its own handle tables, closed by `close`. */
interface NodeOsHostOptions {
    /** Where `~/` and `./` are anchored; absent, the user's home and the process's working directory. */
    anchors?: OsAnchors;
}
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
        key: string;
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
interface LoadedKernel extends KernelModule, HttpKernel, CredentialSeedKernel {
    initSync(input: {
        module: Uint8Array;
    }): object;
}
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
 * The slice of a workspace the program host drives: write a file into it and snapshot it.
 * `@almadar/runtime` implements it over `std-workspace` on the kernel.
 */
interface WorkspacePort {
    /** The workspace's absolute directory. */
    readonly workDir: string;
    writeFile(relPath: string, content: string): Promise<void>;
    snapshot(reason: string): Promise<{
        oid: string;
    } | null>;
    listSnapshots(opts?: {
        limit?: number;
    }): Promise<Array<{
        id: string;
        timestamp: number;
        reason: string;
    }>>;
}
/**
 * Where a host keeps its workspaces, and how it opens the one a call names as
 * the calling principal (it owns access). A workspace lives at
 * `<root>/<owner>/<session>` (`owner` = {@link workspaceOwnerSegment} of the principal).
 */
interface WorkspaceHost {
    readonly root: string;
    open(workspace: string, context: ServiceCallContext): Promise<WorkspacePort>;
}
/** Install the host's workspaces; called once at boot. */
declare function installWorkspaceHost(host: WorkspaceHost): void;
/** Testing/reset hook. */
declare function uninstallWorkspaceHost(): void;
/** The installed workspace host, or null on a host that keeps none. */
declare function installedWorkspaceHost(): WorkspaceHost | null;
/**
 * A principal's workspace directory name: letters, digits and `-` kept, every
 * other UTF-8 byte (including `_`) written as `_` plus two hex digits. One
 * path segment per principal, reversible, so no two principals share one.
 * The same encoding `std-workspace` gives its owner and workspace directories.
 */
declare function workspaceOwnerSegment(principal: string): string;

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
/** `behavior/catalog`: installed behaviors under registry folders. */
declare function behaviorCatalog(scope: CatalogScope, opts: ProgramHostOptions): Promise<CatalogEntry[]>;
/** {@link behaviorCatalog} for a caller that cannot await. */
declare function behaviorCatalogSync(scope: CatalogScope, opts: ProgramHostOptions): CatalogEntry[];
/** `behavior/describe`: a trait value's knobs and events; an orbital value's or a whole behavior's orbitals. */
declare function behaviorDescribe(value: TraitValue, opts: ProgramHostOptions): Promise<TraitDescription>;
declare function behaviorDescribe(value: DescribeTarget, opts: ProgramHostOptions): Promise<TraitDescription | BehaviorDescription>;
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
/**
 * `program/step`: play each request against the program in one run of `orb`'s kernel, each from
 * its own `from` state, and report the circuit it ran — the arm that fired, every guard tried
 * (the Rust evaluator records no node-by-node trace yet, so `trace` is empty), each authored
 * effect of the fired arm and the events it emitted. Each request comes back played: as asked, with its `result`.
 */
declare function programStep(program: OrbitalSchema, requests: readonly StepRequest[], opts: ProgramHostOptions): Promise<PlayedStep[] | {
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

interface KernelProgramOptions {
    /** Which kernel runs the program: the WebAssembly module (default; the only one in a browser) or the native add-on. The host's ports are the same for both. */
    engine?: 'wasm' | 'native';
    /** The native kernel add-on (`kernel.node`); absent, `resolveNativeAddon(options.languageFrom)`. Used only by `engine: 'native'`. */
    nativeAddon?: string;
    /**
     * Environment variables selecting the store the native kernel answers its own row asks from (`DATA_BACKEND`,
     * `NODE_ENV`, `DATABASE_URL`, `COUCHDB_URL`, the Firebase variables); the host's in-memory store is then never asked.
     * Needs `engine: 'native'`; absent, the host's in-memory store answers.
     */
    store?: Readonly<Record<string, string>>;
    /** The directory of the built `@almadar/kernel` package (the one holding `pkg/`); absent, `resolveKernelDir()`. */
    kernelDir?: string;
    /** Where the installed `@almadar/core` and `@almadar/std` are found, node-style. */
    languageFrom: string;
    /** Transport overrides of the `http` effect: pinned fetch, address resolver, secret store. */
    http?: Pick<HttpPortsOptions, 'fetch' | 'resolve' | 'secrets' | 'random'>;
    /** Rows the program's in-memory store starts with, by entity name (a catalog the host already holds). */
    seed?: Record<string, EntityRow[]>;
    /** Answer the program's `os` effects with the Node host (its grants are the program's own); absent, every `os` ask is denied. */
    os?: boolean;
}
interface ProgramRun {
    success: boolean;
    /** Every event the dispatch emitted, in order: the program's `-> external` results among them. */
    emits: EmittedEvent[];
    /** Why a transition or one of its effects did not run (an `effect-failed` carries the error); empty when all ran. */
    rejections: TransitionRejection[];
    error?: string;
}
/** `ALMADAR_KERNEL_DIR`, else the `@almadar/kernel` package that `from` (default: the working directory) resolves. */
declare function resolveKernelDir(from?: string): string;
/** The payload of the first emit named `event`, read through `read`; `undefined` when the run emitted none. */
declare function emitPayload<T>(run: ProgramRun, event: string, read: (payload: EventPayload) => T): T | undefined;
/**
 * `orb resolve`: the program with every `uses` flattened, as the kernel engine takes it. `orb` is the binary to run,
 * by default the one `resolveOrbBinary` picks.
 */
declare function resolveProgramFile(path: string, cwd?: string, orb?: string): Promise<OrbitalSchema>;
declare class KernelProgram {
    private readonly engine;
    private readonly os;
    private readonly schema;
    private readonly http;
    private readonly persistence;
    private constructor();
    static open(schema: OrbitalSchema, options: KernelProgramOptions): Promise<KernelProgram>;
    /** Fire `event` at the orbital as `user` (the program's `@user`), wait for its whole cascade (every `http` ask included), and return what it emitted. */
    dispatch(orbital: string, event: string, payload?: EventPayload, targetTrait?: string, user?: UserContext): Promise<ProgramRun>;
    /** Fire `trait`'s tick `name` once, as a host timer would; the kernel evaluates the tick's guard and effects. */
    tick(orbital: string, trait: string, name: string): Promise<ProgramRun>;
    /** Deliver an `/api/hooks/<name>` request to the program and return the answer it gave (EXEC-INBOUND-1). */
    deliverInbound(name: string, delivery: InboundDelivery): Promise<InboundAnswer>;
    /** The rows the host's in-memory store holds for `entity` (empty when the native kernel keeps its own `store`). */
    rows(entity: string): Promise<EntityRow[]>;
    close(): void;
}

declare function resolveHostNode(host: string): Promise<ResolvedHost>;
declare const nodeNetPort: NetPort;
declare function nodeCredentialScope(): CredentialScopeStorage;
/** Install the Node ports `@almadar/shell-web` leaves open: the pinned `http` fetch + resolver and per-tenant credential scopes. Idempotent. */
declare function installNodeHostPorts(): void;

export { KernelProgram, type KernelProgramOptions, type KvBackend, type KvBatchOp, type KvErrorKind, KvFailure, type KvHost, type KvNamespace, type KvResult, type KvScanEntry, type KvTable, type LoadKernelOptions, type LoadedKernel, type NodeOsHostOptions, type ProgramCallContext, type ProgramComposeOptions, type ProgramEvalOptions, type ProgramEvalResult, type ProgramHostOptions, type ProgramRun, type WorkspaceHost, type WorkspacePort, behaviorCatalog, behaviorCatalogSync, behaviorDependencies, behaviorDescribe, behaviorResolve, behaviorSource, createKvHost, createNodeOsHost, directoryKvBackend, emitPayload, initKernelSync, installNodeHostPorts, installWorkspaceHost, installedWorkspaceHost, loadHttpKernel, loadInstalledKernel, loadKernelModule, loadNativeKernelModule, loadOrCreateDevMasterKey, memoryKvBackend, mountBehaviorValue, mountTraitValue, namespaceId, nodeCredentialScope, nodeNetPort, pinnedFetchNode, programCompose, programEval, programPrint, programRead, programResolve, programResolveSchema, programStep, programValidate, resolveHostNode, resolveKernelDir, resolveNativeAddon, resolveProgramFile, runProgramEffect, uninstallWorkspaceHost, workspaceAccessError, workspaceOwnerSegment };

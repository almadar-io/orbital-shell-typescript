import { ServiceCallContext, HttpPortsOptions } from '@almadar/shell-runtime';
import { OrbitalSchema, EntityRow, EventPayload, UserContext, EmittedEvent, TransitionRejection, InboundDelivery, InboundAnswer } from '@almadar/core';

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

/** Workspaces kept in a bucket through `std-storage` over SigV4 (Google Cloud Storage's S3 interoperability endpoint with HMAC keys). */
interface KernelWorkspaceBucket {
    /** The bucket name. */
    name: string;
    /** The S3-compatible origin; `https://storage.googleapis.com` for Google Cloud Storage. */
    endpoint: string;
    /** The signing region; `auto` for Google Cloud Storage. */
    region: string;
    /** The name of the credential (an environment variable) holding the HMAC access key id. */
    accessKeyId: string;
    /** The name of the credential (an environment variable) holding the HMAC secret. */
    secretAccessKey: string;
}
declare const GCS_ENDPOINT = "https://storage.googleapis.com";
declare const WORKSPACE_HMAC_KEY_ID = "ALMADAR_WORKSPACE_HMAC_KEY_ID";
declare const WORKSPACE_HMAC_SECRET = "ALMADAR_WORKSPACE_HMAC_SECRET";
/** The bucket a host's environment names: `ALMADAR_WORKSPACE_BUCKET` on Google Cloud Storage, keyed by the two HMAC credentials; absent, the project's disk. */
declare function workspaceBucketFromEnv(env: Record<string, string | undefined>): KernelWorkspaceBucket | undefined;
interface KernelWorkspaceHostOptions {
    /** Keep the workspaces in this bucket (the project's `workspaces/` directory is then a cache); absent, on the project's disk. */
    bucket?: KernelWorkspaceBucket;
    /** The project the program host runs `orb` in; workspaces live under its `workspaces/` directory. */
    projectRoot: string;
    /** The `orb` binary that resolves the generated program; absent, the host's default resolution. */
    orb?: string;
    /** How the kernel is loaded; the `os` answerer is always on. */
    kernel?: Omit<KernelProgramOptions, 'os' | 'languageFrom'>;
}
/** Where a project keeps its workspaces. */
declare function workspacesRoot(projectRoot: string): string;
/**
 * The workspace host over `std-workspace`: one kernel program for the host, opened on first use, one request at a time.
 * Each call runs as the calling principal (`@user.id`), which the atom turns into the owner directory.
 */
declare function kernelWorkspaceHost(options: KernelWorkspaceHostOptions): WorkspaceHost;

export { GCS_ENDPOINT as G, KernelProgram as K, type ProgramRun as P, WORKSPACE_HMAC_KEY_ID as W, type KernelProgramOptions as a, type KernelWorkspaceBucket as b, type KernelWorkspaceHostOptions as c, WORKSPACE_HMAC_SECRET as d, type WorkspaceHost as e, type WorkspacePort as f, emitPayload as g, installedWorkspaceHost as h, installWorkspaceHost as i, resolveProgramFile as j, kernelWorkspaceHost as k, workspaceOwnerSegment as l, workspacesRoot as m, resolveKernelDir as r, uninstallWorkspaceHost as u, workspaceBucketFromEnv as w };

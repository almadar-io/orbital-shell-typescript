import { JsonValue } from '@almadar/core';
import { OsOp, Settled, OsError, CallSiteWire } from '@almadar/core/kernel-wire';

/**
 * The `os` ports of a kernel host, with no Node builtin in sight so the browser bundle can import them.
 * The Node answerer is `os-node.ts`; the grant check is the Rust `OsGrants` (`allows` below), never TypeScript.
 */

type OsFsMode = 'read' | 'write' | 'create' | 'remove' | 'meta';
type OsNetKind = 'tcp' | 'udp' | 'listen';
type OsStdioKind = 'in' | 'out' | 'err';
type OsSysKind = 'cpu' | 'memory' | 'disk' | 'network' | 'power-state' | 'identity';
type OsDesktopKind = 'notify' | 'speak' | 'brightness' | 'volume' | 'power';
/** One thing an `os/` call needs from the program's grants: the JSON of Rust `OsRequirement`. */
type OsRequirement = {
    need: 'fs';
    path: string;
    mode: OsFsMode;
} | {
    need: 'exec';
    command: string;
} | {
    need: 'net';
    host: string;
    port: number;
    kinds: OsNetKind[];
} | {
    need: 'env';
    name: string;
} | {
    need: 'stdio';
    kind: OsStdioKind;
} | {
    need: 'sys';
    kind: OsSysKind;
} | {
    need: 'desktop';
    kind: OsDesktopKind;
};
/** The grant decisions the wasm kernel owns (`OsGrants::allows`, the one-grant glob matcher, `is_public_address`). */
interface OsGrantPort {
    /** `OsGrants::allows` over the grants every registered program declares. */
    allows(need: OsRequirement): boolean;
    /** Whether the absolute `glob` (`**`, `*`, `?`) matches `path`, as a one-grant `fs_allows` for read. */
    globMatches(glob: string, path: string): boolean;
    /** `is_public_address`: the rule an outbound host name must pass. */
    isPublicAddress(ip: string): boolean;
    /** Place the program's anchored grants and arguments under the host's anchors (`set_os_anchors_json`); answers what grants nothing. */
    anchor(anchors: OsAnchors): OsAnchorProblem[];
    /** An `os/` call's arguments with every anchored part replaced by what it names under the host's anchors (`resolve_anchored_args`). */
    resolveArgs(op: OsOp, args: JsonValue[]): Settled<JsonValue[], OsError>;
}
/** An anchored grant entry that grants nothing under the host's anchors. */
interface OsAnchorProblem {
    path: string;
    message: string;
}
/** What a host answers an `os` ask with; `close` drops every handle it holds, as the native `OsHandles::close_all`. */
interface OsHostPort {
    answer(op: OsOp, args: JsonValue[]): Promise<Settled<JsonValue, OsError>>;
    /**
     * `Completions::run_later`: a keyed ask of a completion-deferring op. A failed check (or a key already pending) is the
     * in-place `error`; `ok` means the work runs in the background and its outcome reaches `deliver` once, unless
     * the key is cancelled first. A host with no `defer` answers every ask in place.
     */
    defer?(op: OsOp, args: JsonValue[], key: string, deliver: (outcome: Settled<JsonValue, OsError>) => void): Settled<null, OsError>;
    /**
     * A keyed stream (`OsOp::is_stream`, EXEC-QUEUE-12): the host binds and answers once in place, then hands each message
     * to `message` until it ends; `message` answers `false` when no one takes it any more. A failure after the answer
     * reaches `fail` once. A host with no `stream` answers every stream ask in place, as unsupported.
     */
    stream?(op: OsOp, args: JsonValue[], key: string, message: (value: JsonValue) => boolean, fail: (error: OsError) => void): Promise<Settled<JsonValue, OsError>>;
    /** `OsHandles::cancel_completion`: drop the pending completion of `key`, or stop its stream; `false` when none is open. */
    cancel?(key: string): boolean;
    close(): void;
}
/** The event a deferred `os` call's outcome fires on its call site, as the kernel shapes it. */
interface OsCompletionEvent {
    event: string;
    payload: JsonValue;
}
/** What the wasm kernel decides about a deferred `os` call: which ops defer, and the event an outcome fires. */
interface OsCompletionPort {
    defers(op: OsOp): boolean;
    streams(op: OsOp): boolean;
    event(site: CallSiteWire, key: string, outcome: Settled<JsonValue, OsError>): OsCompletionEvent | null;
}
/** The kernel exports the completion port is built from. */
interface OsCompletionMatchers {
    osDeferringOps(): string;
    osStreamOps(): string;
    osCompletionEvent(siteJson: string, key: string, outcomeJson: string): string;
}
/** The completion port over the wasm kernel: `OsOp::defers_completion`, `OsOp::is_stream` and `completion_event`, not copied. */
declare function kernelOsCompletions(kernel: OsCompletionMatchers): OsCompletionPort;
/** The kernel pieces a grant port is built from: the `Server` handle holding the program's grants and the module-level matchers. */
interface OsGrantKernel {
    osAllows(requirementJson: string): boolean;
    setOsAnchors(anchorsJson: string): string;
    osResolveArgs(op: string, argsJson: string): string;
}
interface OsGrantMatchers {
    osGlobMatches(glob: string, path: string): boolean;
    isPublicAddress(ip: string): boolean;
}
/** The grant port over the wasm kernel: every decision is `OsGrants::allows` and the exports beside it. */
declare function kernelOsGrants(matchers: OsGrantMatchers, server: () => OsGrantKernel): OsGrantPort;
/**
 * Where a host anchors `~/` and `./` paths and grants (the user's home and the directory it started the program in), and
 * what a grant's declared anchors resolve to: its executable's directory and its boot environment (`orbital-core` `OsAnchors`).
 */
interface OsAnchors {
    readonly home?: string;
    readonly start?: string;
    readonly exeDir?: string;
    readonly env?: Readonly<Record<string, string>>;
}
/** What a written path names under the host's anchors (`OsAnchors::expand`). */
type AnchoredPath = {
    kind: 'plain';
} | {
    kind: 'anchored';
    path: string;
} | {
    kind: 'unknown';
    message: string;
};
declare function expandAnchor(anchors: OsAnchors, text: string): AnchoredPath;
/** The grant port a host checks absolute paths through: an fs need also matches the program's `~/` and `./` grants (`OsGrants::fs_allows_at`). */
declare function anchoredGrants(grants: OsGrantPort, anchors: OsAnchors): OsGrantPort;

export { type AnchoredPath, type OsAnchorProblem, type OsAnchors, type OsCompletionEvent, type OsCompletionMatchers, type OsCompletionPort, type OsDesktopKind, type OsFsMode, type OsGrantKernel, type OsGrantMatchers, type OsGrantPort, type OsHostPort, type OsNetKind, type OsRequirement, type OsStdioKind, type OsSysKind, anchoredGrants, expandAnchor, kernelOsCompletions, kernelOsGrants };

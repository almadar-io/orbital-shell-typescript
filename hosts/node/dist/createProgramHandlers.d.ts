import { EffectHandlers } from '@almadar/shell-runtime';

/**
 * Program host handlers — server-side only.
 *
 * Backs the language trio's effects (behavior/catalog|describe|source,
 * program/read|print|eval) with the one host implementation in
 * `host/program`, which runs the installed `orb` from the
 * project directory. Its workspaces are `std-workspace` run by the kernel
 * (`kernelWorkspaceHost`). Wired by OrbitalServerRuntime
 * (lazy import, merged under user handlers).
 *
 * NOT exported from the main index.ts because it spawns processes.
 *
 * @packageDocumentation
 */

interface ProgramHostConfig {
    /** Project root `orb` resolves behavior packages from. */
    cwd: string;
    /** Explicit `orb` binary; defaults to the host's resolution order. */
    orbBin?: string;
}
type ProgramHandlers = Pick<EffectHandlers, 'programEffect'>;
declare function createProgramHandlers(host: ProgramHostConfig): ProgramHandlers;

export { type ProgramHandlers, type ProgramHostConfig, createProgramHandlers };

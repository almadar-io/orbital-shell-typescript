/**
 * The `orb` binary the language server runs: the editor's configured `orbBin`, else the one rule every host uses
 * (`@almadar/core` `resolveOrbBinary`, G-EXTENSIONS-004). No LSP `connection` dependency, so it's directly
 * unit-testable; server.ts supplies the editor configuration and logger and owns the result cache.
 */

import * as fs from 'fs';
import * as os from 'os';
import { BehaviorPackageError, resolveOrbBinary as resolveHostOrbBinary } from '@almadar/core/behavior-package';

export interface OrbBinaryLogger {
    warn(message: string): void;
}

export interface ResolveOrbBinaryOptions {
    /** The editor's `initializationOptions.orbBin`: used unless `ORB_BIN` is set in the environment. */
    orbBin?: string | null;
    workspaceRoot?: string | null;
    /** More places an installed `@almadar/orb` may live (the process cwd, the bundle's own directory). */
    extraSearchRoots?: string[];
    logger?: OrbBinaryLogger;
    /** Injection point for os.homedir (defaults to the real one) — lets tests control it directly. */
    homedir?: () => string;
}

export interface ResolvedOrbBinary {
    path: string;
    strategy: string;
}

function isExecutableFile(candidate: string): boolean {
    try {
        fs.accessSync(candidate, fs.constants.X_OK);
        return fs.statSync(candidate).isFile();
    } catch {
        return false;
    }
}

/**
 * Resolution order: `ORB_BIN` in the environment, then the editor's `orbBin`, then the `@almadar/orb` installed for the workspace
 * root, then each extra root (with no root given, no installed package is looked for). A configured path
 * that does not exist is refused by name, never skipped.
 */
export function resolveOrbBinary(options: ResolveOrbBinaryOptions = {}): ResolvedOrbBinary | null {
    const logger = options.logger ?? { warn: () => { /* no-op */ } };
    const envConfigured = Boolean(process.env.ORB_BIN);
    if (!envConfigured && options.orbBin) {
        if (isExecutableFile(options.orbBin)) return { path: options.orbBin, strategy: 'editor orbBin' };
        logger.warn(`OrbLSP: orbBin is set to "${options.orbBin}", which does not exist or is not executable — set it to an orb binary or remove it.`);
        return null;
    }

    const home = (options.homedir ?? os.homedir)();
    const given = [options.workspaceRoot, ...(options.extraSearchRoots ?? [])].filter((r): r is string => Boolean(r));
    const roots = given.length > 0 ? given : [home];
    let refusal = '';
    for (const root of roots) {
        try {
            return { path: resolveHostOrbBinary(root), strategy: '@almadar/core resolveOrbBinary' };
        } catch (error) {
            if (!(error instanceof BehaviorPackageError)) throw error;
            refusal = error.message;
        }
    }
    logger.warn(`OrbLSP: ${refusal}`);
    return null;
}

/**
 * The `orb` block a behavior package declares in its `package.json`
 * (`docs/Almadar_Behavior_Packages.md` §3) and the one resolver for the files it
 * declares. Readers resolve sidecars through these declared paths, never through
 * a hardcoded package layout. TS mirror of `orbital_core::behavior_packages`.
 *
 * Node-only (reads `package.json` with `node:fs`): exported from the
 * `@almadar/core/behavior-package` subpath only, never the main entry, so browser
 * bundles never pull in `node:fs` (the `@almadar/core/fixtures` precedent).
 *
 * @packageDocumentation
 */
// Namespace imports: a browser bundle that reaches this Node-only module through a
// dynamic import (the runtime's external loader) can still link it against the
// bundler's empty builtin stubs — named imports would fail to bind.
import * as nodeCrypto from 'node:crypto';
import * as nodeChildProcess from 'node:child_process';
import * as nodeFs from 'node:fs';
import * as nodeModule from 'node:module';
import * as nodeOs from 'node:os';
import * as nodePath from 'node:path';
import { z } from 'zod';

const { createHash } = nodeCrypto;
const { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, utimesSync, writeFileSync } = nodeFs;
const { createRequire } = nodeModule;
const { homedir } = nodeOs;
const { dirname, isAbsolute, join, relative, resolve, sep } = nodePath;

export const BehaviorPackageOrbBlockSchema = z
  .object({
  prefix: z.string().min(1),
  /** A materialized tree of lowered `.orb` programs (a published package). */
  registry: z.string().min(1).optional(),
  /** The `.lolo` sources, lowered on read when no `registry` is declared (a workspace package). */
  source: z.string().min(1).optional(),
  vectors: z.string().min(1).optional(),
  compiler: z.string().min(1),
  })
  .refine((orb) => orb.registry !== undefined || orb.source !== undefined, {
    message: 'declares neither `registry` (materialized) nor `source` (live)',
  });

export type BehaviorPackageOrbBlock = z.infer<typeof BehaviorPackageOrbBlockSchema>;

const PackageManifestSchema = z.object({
  name: z.string().default(''),
  version: z.string().default(''),
  orb: BehaviorPackageOrbBlockSchema.optional(),
});

/** `sidecars.lock.json` — package-relative paths whose content lives in the sidecar store (§13). */
export const SidecarLockSchema = z.object({
  version: z.literal(1),
  files: z.record(
    z.string(),
    z.object({
      sha256: z.string().regex(/^[0-9a-f]{64}$/),
      bytes: z.number().int().nonnegative(),
      url: z.string().url(),
    }),
  ),
});

export type SidecarLock = z.infer<typeof SidecarLockSchema>;
export type SidecarLockEntry = SidecarLock['files'][string];

export type DeclaredFileKey = 'vectors';

export interface BehaviorPackage {
  name: string;
  version: string;
  root: string;
  orb: BehaviorPackageOrbBlock;
  /** The package's `sidecars.lock.json`, or `null` when it ships none. */
  lock: SidecarLock | null;
}

/** Fetches a lock entry's url and returns its (decoded) bytes. Injected in tests. */
export type SidecarFetch = (url: string) => Promise<Uint8Array>;

export interface SidecarOptions {
  /** Default: `ALMADAR_SIDECAR_CACHE`, else `~/.almadar/sidecars`. */
  cacheDir?: string;
  fetch?: SidecarFetch;
}

export class BehaviorPackageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BehaviorPackageError';
  }
}

/** Read the behavior package rooted at `root`; refuses a `package.json` with no `orb` block. */
export function readBehaviorPackage(root: string): BehaviorPackage {
  const manifest = join(root, 'package.json');
  const result = PackageManifestSchema.safeParse(JSON.parse(readFileSync(manifest, 'utf8')));
  if (!result.success) {
    throw new BehaviorPackageError(`${manifest}: malformed \`orb\` block — ${result.error.message}`);
  }
  const { name, version, orb } = result.data;
  if (!orb) {
    throw new BehaviorPackageError(`${manifest} declares no \`orb\` block — not a behavior package`);
  }
  return { name, version, root, orb, lock: readSidecarLock(root) };
}

/** Runtime sidecars: shipped, resolved on demand. */
export const SIDECAR_LOCK_FILE = 'sidecars.lock.json';
/** Build inputs: committed, not shipped; restored into the package before a build. */
export const BUILD_INPUTS_LOCK_FILE = 'build-inputs.lock.json';

/** Read a package lock file (`SIDECAR_LOCK_FILE` or `BUILD_INPUTS_LOCK_FILE`); `null` when the package has none. */
export function readLockFile(root: string, lockFile: string = SIDECAR_LOCK_FILE): SidecarLock | null {
  const lockPath = join(root, lockFile);
  if (!existsSync(lockPath)) return null;
  const result = SidecarLockSchema.safeParse(JSON.parse(readFileSync(lockPath, 'utf8')));
  if (!result.success) {
    throw new BehaviorPackageError(`${lockPath}: malformed ${lockFile} — ${result.error.message}`);
  }
  return result.data;
}

function readSidecarLock(root: string): SidecarLock | null {
  return readLockFile(root, SIDECAR_LOCK_FILE);
}

export function sidecarCacheDir(): string {
  return process.env['ALMADAR_SIDECAR_CACHE'] || join(homedir(), '.almadar', 'sidecars');
}

const defaultFetch: SidecarFetch = async (url) => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
};

function urlHost(url: string): string {
  return new URL(url).host;
}

function hashMismatch(pkg: Pick<BehaviorPackage, 'name' | 'version'>, relPath: string, entry: SidecarLockEntry, detail: string): BehaviorPackageError {
  return new BehaviorPackageError(
    `ORB_SIDECAR_HASH_MISMATCH: ${pkg.name}@${pkg.version} ${relPath} — expected sha256 ${entry.sha256} (${entry.bytes} bytes), ${detail}`,
  );
}

function packageFile(pkg: BehaviorPackage, relPath: string, label: string): string {
  const absolute = resolve(pkg.root, relPath);
  const rel = relative(pkg.root, absolute);
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new BehaviorPackageError(`${pkg.name}: ${label} = "${relPath}" points outside the package`);
  }
  if (!existsSync(absolute)) {
    throw new BehaviorPackageError(`${pkg.name}@${pkg.version}: ${label} declares "${relPath}", which is not in the package`);
  }
  return absolute;
}

/**
 * Sync resolution of a declared path (§13 rule): a lock-declared path resolves to its cache
 * file and fails with ORB_SIDECAR_NOT_CACHED when absent; any other path is read from the package.
 */
export function resolveDeclaredPath(pkg: BehaviorPackage, relPath: string, options: SidecarOptions = {}, label = 'declared path'): string {
  const entry = pkg.lock?.files[relPath];
  if (!entry) return packageFile(pkg, relPath, label);
  const cached = join(options.cacheDir ?? sidecarCacheDir(), entry.sha256);
  if (!existsSync(cached)) {
    throw new BehaviorPackageError(
      `ORB_SIDECAR_NOT_CACHED: ${pkg.name}@${pkg.version} ${relPath} (sha256 ${entry.sha256}) is not in the sidecar cache — resolve it with ensureDeclaredPath or \`npx @almadar/db sidecars pull\``,
    );
  }
  if (statSync(cached).size !== entry.bytes) throw hashMismatch(pkg, relPath, entry, `cached file has ${statSync(cached).size} bytes`);
  return cached;
}

/** Ensures one lock entry is in the cache (downloading and verifying it on a miss) and returns the cache file. */
export async function ensureLockEntry(
  pkg: Pick<BehaviorPackage, 'name' | 'version'>,
  relPath: string,
  entry: SidecarLockEntry,
  options: SidecarOptions = {},
): Promise<string> {
  const cacheDir = options.cacheDir ?? sidecarCacheDir();
  const cached = join(cacheDir, entry.sha256);
  if (existsSync(cached)) {
    if (statSync(cached).size !== entry.bytes) throw hashMismatch(pkg, relPath, entry, `cached file has ${statSync(cached).size} bytes`);
    return cached;
  }
  let bytes: Uint8Array;
  try {
    bytes = await (options.fetch ?? defaultFetch)(entry.url);
  } catch (error) {
    throw new BehaviorPackageError(
      `ORB_SIDECAR_FETCH_FAILED: ${pkg.name}@${pkg.version} ${relPath} (sha256 ${entry.sha256}) from ${urlHost(entry.url)} — ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const actual = createHash('sha256').update(bytes).digest('hex');
  if (actual !== entry.sha256 || bytes.byteLength !== entry.bytes) {
    throw hashMismatch(pkg, relPath, entry, `downloaded ${bytes.byteLength} bytes with sha256 ${actual}`);
  }
  mkdirSync(cacheDir, { recursive: true });
  const temp = `${cached}.${process.pid}.tmp`;
  writeFileSync(temp, bytes);
  renameSync(temp, cached);
  return cached;
}

/** Async resolution of a declared path: a lock-declared path is downloaded and verified into the cache on a miss. */
export async function ensureDeclaredPath(pkg: BehaviorPackage, relPath: string, options: SidecarOptions = {}): Promise<string> {
  const entry = pkg.lock?.files[relPath];
  if (!entry) return packageFile(pkg, relPath, 'declared path');
  return ensureLockEntry(pkg, relPath, entry, options);
}

/** The user store (`~/.orb`): the last rung of discovery, after every ancestor `node_modules`. */
export function userStoreDir(): string {
  return join(homedir(), '.orb');
}

/** The `orb` fields only a behavior package declares (`@almadar/core`'s language block is not one). */
const BEHAVIOR_BLOCK_FIELDS = ['prefix', 'registry', 'source'];

function packageDirs(nodeModules: string): string[] {
  if (!existsSync(nodeModules)) return [];
  const out: Array<[string, string]> = [];
  for (const entry of readdirSync(nodeModules)) {
    const path = join(nodeModules, entry);
    if (entry.startsWith('@')) {
      if (!existsSync(path) || !statSync(path).isDirectory()) continue;
      for (const sub of readdirSync(path)) out.push([`${entry}/${sub}`, join(path, sub)]);
    } else {
      out.push([entry, path]);
    }
  }
  return out.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).map(([, path]) => path);
}

function isBehaviorManifest(manifestPath: string): boolean {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { orb?: Record<string, object> | null };
  const orb = manifest.orb;
  return orb !== undefined && orb !== null && typeof orb === 'object' && BEHAVIOR_BLOCK_FIELDS.some((field) => field in orb);
}

/**
 * Every installed package directory, the node-style rule `orb` uses
 * (`orbital-core` `behavior_packages`): each ancestor `node_modules` of
 * `startDir`, nearest first, then the user store's; scoped and unscoped; only
 * directories holding a `package.json`. Real paths; a package name may repeat
 * across rungs (callers keep the nearest).
 */
export function installedPackageDirs(startDir: string, userStore: string = userStoreDir()): string[] {
  const rungs: string[] = [];
  for (let dir = resolve(startDir); ; dir = dirname(dir)) {
    rungs.push(join(dir, 'node_modules'));
    if (dirname(dir) === dir) break;
  }
  rungs.push(join(userStore, 'node_modules'));
  const out: string[] = [];
  for (const nodeModules of rungs) {
    for (const dir of packageDirs(nodeModules)) {
      if (!existsSync(join(dir, 'package.json')) || !statSync(dir).isDirectory()) continue;
      out.push(realpathSync(dir));
    }
  }
  return out;
}

/**
 * Every installed behavior package, the same rule as `orb`
 * (`orbital-core` `behavior_packages::discover`): every package
 * ({@link installedPackageDirs}) whose `package.json` carries a behavior `orb`
 * block; nearest wins per name; two packages claiming one prefix is an error.
 */
export function discoverBehaviorPackages(startDir: string, userStore: string = userStoreDir()): BehaviorPackage[] {
  const found: BehaviorPackage[] = [];
  const seen = new Set<string>();
  for (const dir of installedPackageDirs(startDir, userStore)) {
    if (!isBehaviorManifest(join(dir, 'package.json'))) continue;
    const pkg = readBehaviorPackage(dir);
    if (seen.has(pkg.name)) continue;
    seen.add(pkg.name);
    found.push(pkg);
  }
  const byPrefix = new Map<string, BehaviorPackage>();
  for (const pkg of found) {
    const other = byPrefix.get(pkg.orb.prefix);
    if (other && other.name !== pkg.name) {
      throw new BehaviorPackageError(`prefix \`${pkg.orb.prefix}\` is claimed by ${other.name} (${other.root}) and ${pkg.name} (${pkg.root})`);
    }
    byPrefix.set(pkg.orb.prefix, pkg);
  }
  return found;
}

/** Resolve an installed behavior package by name, node-style, from `fromDir`. */
export function findInstalledBehaviorPackage(name: string, fromDir: string): BehaviorPackage {
  const req = createRequire(join(resolve(fromDir), 'noop.js'));
  return readBehaviorPackage(dirname(req.resolve(`${name}/package.json`)));
}

/** The absolute path of a file (or the registry directory) the package declares. Fails when it is missing. */
export function resolveDeclaredFile(pkg: BehaviorPackage, key: DeclaredFileKey, options: SidecarOptions = {}): string {
  const declared = pkg.orb[key];
  if (declared === undefined) {
    throw new BehaviorPackageError(`${pkg.name}@${pkg.version}: orb.${key} is not declared`);
  }
  return resolveDeclaredPath(pkg, declared, options, `orb.${key}`);
}

/** The `bin` entry of an installed `@almadar/orb` manifest: a string, or a map whose first entry is the CLI. */
const OrbPackageManifest = z.object({ bin: z.union([z.string(), z.record(z.string(), z.string())]).optional() });

/**
 * The `orb` binary, the one rule every TS host uses (G-CROSS-261; the editor's language server too, G-EXTENSIONS-004),
 * from exactly two explicit sources: `ORB_BIN` (a set path must exist: it is refused by name, never skipped), else the
 * binary the `@almadar/orb` installed for `from` declares. Nothing on PATH, in `~/bin` or elsewhere is consulted.
 */
export function resolveOrbBinary(from: string = process.cwd()): string {
  const configured = process.env['ORB_BIN'];
  if (configured) {
    if (!existsSync(configured)) throw new BehaviorPackageError(`ORB_BIN is set to ${configured}, which does not exist`);
    return configured;
  }
  const installed = installedOrbBin(from);
  if (installed !== undefined) return installed;
  throw new BehaviorPackageError('no `orb` binary: set ORB_BIN or install @almadar/orb');
}

/** The CLI the nearest `node_modules/@almadar/orb` walking up from `from` declares in its manifest `bin`. */
function installedOrbBin(from: string): string | undefined {
  for (let dir = resolve(from); ; dir = dirname(dir)) {
    const manifestPath = join(dir, 'node_modules', '@almadar', 'orb', 'package.json');
    if (existsSync(manifestPath)) {
      const parsed = OrbPackageManifest.safeParse(JSON.parse(readFileSync(manifestPath, 'utf8')));
      const bin = !parsed.success || parsed.data.bin === undefined ? undefined : typeof parsed.data.bin === 'string' ? parsed.data.bin : Object.values(parsed.data.bin)[0];
      const path = bin === undefined ? undefined : resolve(dirname(manifestPath), bin);
      return path !== undefined && existsSync(path) ? path : undefined;
    }
    if (dirname(dir) === dir) return undefined;
  }
}

/** Default: `ALMADAR_DERIVED_CACHE`, else `~/.almadar/derived`. */
export function derivedCacheDir(): string {
  return process.env['ALMADAR_DERIVED_CACHE'] || join(homedir(), '.almadar', 'derived');
}

export interface RegistryDirOptions {
  orbBin?: string;
  cacheDir?: string;
  /** How many files one `orb lower` run takes. */
  batch?: number;
}

const fileHashes = new Map<string, string>();

/** sha256 of a file's bytes, memoized by path, size and mtime. */
function fileHash(path: string): string {
  const stat = statSync(path);
  const memo = `${path}\0${stat.size}\0${stat.mtimeMs}`;
  const known = fileHashes.get(memo);
  if (known) return known;
  const hash = createHash('sha256').update(readFileSync(path)).digest('hex');
  fileHashes.set(memo, hash);
  return hash;
}

/**
 * What a lowering depends on besides the source: the `orb` binary's bytes (a
 * rebuilt binary keeps its version string) and the language data files the
 * `@almadar/core` that `orb` resolves from `pkgRoot` declares (`orbLanguage`,
 * same walk as `orb`: ancestor `node_modules`, then the user store).
 */
function lowererKey(orbBin: string, pkgRoot: string): string {
  const hash = createHash('sha256').update(fileHash(orbBin));
  const rungs: string[] = [];
  for (let dir = resolve(pkgRoot); ; dir = dirname(dir)) {
    rungs.push(join(dir, 'node_modules'));
    if (dirname(dir) === dir) break;
  }
  rungs.push(join(userStoreDir(), 'node_modules'));
  const coreRoot = rungs.map((nm) => join(nm, '@almadar', 'core')).find((dir) => existsSync(join(dir, 'package.json')));
  if (!coreRoot) return hash.update('\0no-core').digest('hex');
  const manifest = JSON.parse(readFileSync(join(coreRoot, 'package.json'), 'utf8')) as { orbLanguage?: Record<string, string> };
  for (const [field, rel] of Object.entries(manifest.orbLanguage ?? {}).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    const path = join(coreRoot, rel);
    if (field === 'compiler' || !existsSync(path) || !statSync(path).isFile()) continue;
    hash.update(`\0${field}\0${fileHash(path)}`);
  }
  return hash.digest('hex');
}

function filesWithExtension(dir: string, extension: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...filesWithExtension(path, extension));
    else if (entry.name.endsWith(extension)) out.push(path);
  }
  return out.sort();
}

/** A source file's path in the mirror: a `.lolo` becomes its lowered `.orb`; a message catalog keeps its path. */
function mirrorPath(rel: string): string {
  return rel.replace(/\.lolo$/, '.orb');
}

interface SourceStamp {
  sha256: string;
  mtimeMs: number;
  size: number;
}

interface LoweredLine {
  path: string;
  orb?: object;
  error?: string;
}

/** Where a live package's mirror lives: keyed by its root and what lowers it ({@link lowererKey}). */
function mirrorDir(pkg: BehaviorPackage, orbBin: string, cacheDir: string | undefined): string {
  const key = createHash('sha256').update(`${resolve(pkg.root)}\0${lowererKey(orbBin, pkg.root)}`).digest('hex').slice(0, 32);
  return join(cacheDir ?? derivedCacheDir(), 'registry', key);
}

/**
 * Delete every live-package mirror under the derived cache except those of
 * `keep` (as the current `orb` keys them) — a new `orb` binary, new language data or a moved
 * checkout leaves the old ones behind. Returns the removed directories.
 * Explicit and total: it removes every mirror not in `keep`. Reading a mirror
 * ({@link behaviorRegistryDir}) separately keeps only the newest
 * {@link REGISTRY_MIRROR_LIMIT}.
 */
export function pruneRegistryMirrors(keep: readonly BehaviorPackage[], options: RegistryDirOptions = {}): string[] {
  const orbBin = options.orbBin ?? resolveOrbBinary();
  const kept = new Set(keep.filter((pkg) => pkg.orb.registry === undefined).map((pkg) => mirrorDir(pkg, orbBin, options.cacheDir)));
  const root = join(options.cacheDir ?? derivedCacheDir(), 'registry');
  if (!existsSync(root)) return [];
  const removed: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const dir = join(root, entry.name);
    if (!entry.isDirectory() || kept.has(dir)) continue;
    rmSync(dir, { recursive: true, force: true });
    removed.push(dir);
  }
  return removed.sort();
}

/**
 * The directory of lowered `.orb` programs for `pkg`. A declared `orb.registry`
 * (a published package) is that directory. A live package (`orb.source`, no
 * `registry`) gets a content-addressed mirror under `derivedCacheDir()`, keyed by
 * the package root, the `orb` binary and the installed language data: each `.lolo` whose content hash changed
 * since the last call is re-lowered with `orb lower`, a removed one is pruned, and
 * an unchanged one is never touched; each behavior's `locales/<locale>/<name>.json`
 * catalog is copied beside its program. Same tree layout as a materialized registry,
 * so every reader of `.orb` files works unchanged. A lowering error fails the call,
 * naming the file.
 */
/**
 * How many live-package mirrors the derived cache keeps. One mirror is a package's full lowered registry
 * (170-360 MB for std), keyed by package root, `orb` binary and language data, so every rebuilt `orb` and every
 * checkout adds one per package. Six holds the current and the previous binary of the two packages a checkout
 * mounts (std, behaviors) plus a second checkout's current pair, and bounds the cache near 2 GB.
 */
export const REGISTRY_MIRROR_LIMIT = 6;

const mirrorsInUse = new Set<string>();

/**
 * Evict the mirrors under `registryRoot` beyond the `limit` most recently used (directory modification time,
 * newest first, ties broken by name), always keeping every directory in `protectedDirs`. Returns the removed
 * directories, sorted.
 */
export function evictOldMirrors(registryRoot: string, protectedDirs: ReadonlySet<string>, limit: number = REGISTRY_MIRROR_LIMIT): string[] {
  if (!existsSync(registryRoot)) return [];
  const mirrors = readdirSync(registryRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const dir = join(registryRoot, entry.name);
      return { dir, name: entry.name, used: statSync(dir).mtimeMs };
    })
    .sort((a, b) => b.used - a.used || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const removed: string[] = [];
  for (const mirror of mirrors.slice(limit)) {
    if (protectedDirs.has(mirror.dir)) continue;
    rmSync(mirror.dir, { recursive: true, force: true });
    removed.push(mirror.dir);
  }
  return removed.sort();
}

/**
 * The files a package authors its behaviors in, without lowering anything: a
 * live package's `.lolo` source tree, or a published package's declared registry
 * of `.orb` programs. For tools that read behavior text (a class scanner, a
 * file watcher); a reader of lowered programs uses {@link behaviorRegistryDir}.
 */
export function behaviorSourceTree(pkg: BehaviorPackage): { dir: string; extension: '.lolo' | '.orb' } {
  if (pkg.orb.registry !== undefined) {
    return { dir: resolveDeclaredPath(pkg, pkg.orb.registry, {}, 'orb.registry'), extension: '.orb' };
  }
  if (pkg.orb.source === undefined) throw new BehaviorPackageError(`${pkg.name}: declares neither \`orb.registry\` nor \`orb.source\``);
  return { dir: packageFile(pkg, pkg.orb.source, 'orb.source'), extension: '.lolo' };
}

export function behaviorRegistryDir(pkg: BehaviorPackage, options: RegistryDirOptions = {}): string {
  if (pkg.orb.registry !== undefined) return resolveDeclaredPath(pkg, pkg.orb.registry, {}, 'orb.registry');
  const sourceRel = pkg.orb.source;
  if (sourceRel === undefined) throw new BehaviorPackageError(`${pkg.name}: declares neither \`orb.registry\` nor \`orb.source\``);
  const source = packageFile(pkg, sourceRel, 'orb.source');
  const orbBin = options.orbBin ?? resolveOrbBinary();
  const out = mirrorDir(pkg, orbBin, options.cacheDir);
  mkdirSync(out, { recursive: true });
  const usedAt = new Date();
  utimesSync(out, usedAt, usedAt);
  mirrorsInUse.add(out);
  evictOldMirrors(dirname(out), mirrorsInUse);
  const hashesPath = join(out, '.hashes.json');
  const previous: Record<string, SourceStamp> = existsSync(hashesPath) ? (JSON.parse(readFileSync(hashesPath, 'utf8')) as Record<string, SourceStamp>) : {};
  const current: Record<string, SourceStamp> = {};
  const stale: string[] = [];
  const staleCatalogs: string[] = [];
  const catalogs = filesWithExtension(source, '.json').filter((file) => relative(source, file).split(sep).includes('locales'));
  for (const file of [...filesWithExtension(source, '.lolo'), ...catalogs]) {
    const rel = relative(source, file);
    const { mtimeMs, size } = statSync(file);
    const before = previous[rel];
    // Hash only a file whose stat moved: an unchanged tree costs one stat per file.
    const sha256 =
      before && before.mtimeMs === mtimeMs && before.size === size ? before.sha256 : createHash('sha256').update(readFileSync(file)).digest('hex');
    current[rel] = { sha256, mtimeMs, size };
    if (before?.sha256 === sha256 && existsSync(join(out, mirrorPath(rel)))) continue;
    if (rel.endsWith('.lolo')) stale.push(file);
    else staleCatalogs.push(file);
  }
  const batch = options.batch ?? 200;
  for (let i = 0; i < stale.length; i += batch) {
    const files = stale.slice(i, i + batch);
    const run = nodeChildProcess.spawnSync(orbBin, ['lower', ...files], { cwd: pkg.root, encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024 });
    if (run.status !== 0) throw new BehaviorPackageError(`${pkg.name}: \`orb lower\` failed: ${run.stderr}`);
    for (const line of run.stdout.split('\n').filter((l) => l.trim() !== '')) {
      const lowered = JSON.parse(line) as LoweredLine;
      if (lowered.error !== undefined || lowered.orb === undefined) {
        throw new BehaviorPackageError(`${pkg.name}: ${lowered.path} does not lower: ${lowered.error ?? 'no program'}`);
      }
      const target = join(out, mirrorPath(relative(source, lowered.path)));
      mkdirSync(dirname(target), { recursive: true });
      const temp = `${target}.${process.pid}.tmp`;
      writeFileSync(temp, JSON.stringify(lowered.orb));
      renameSync(temp, target);
    }
  }
  for (const file of staleCatalogs) {
    const target = join(out, relative(source, file));
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(file, target);
  }
  for (const rel of Object.keys(previous)) {
    if (!(rel in current)) rmSync(join(out, mirrorPath(rel)), { force: true });
  }
  mkdirSync(out, { recursive: true });
  const stamps = JSON.stringify(current);
  if (stale.length > 0 || staleCatalogs.length > 0 || stamps !== JSON.stringify(previous)) writeFileSync(hashesPath, stamps);
  return out;
}

/**
 * Every behavior program in the package's registry, by behavior name: each `.orb` under the
 * registry tree, named by its basename (the rule `orb` indexes by). Two programs with one name
 * are refused.
 */
export function behaviorProgramFiles(pkg: BehaviorPackage, options: RegistryDirOptions = {}): Map<string, string> {
  const root = behaviorRegistryDir(pkg, options);
  const files = new Map<string, string>();
  const walk = (dir: string): void => {
    for (const entry of nodeFs.readdirSync(dir, { withFileTypes: true })) {
      const full = nodePath.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name.endsWith('.orb')) {
        const name = entry.name.slice(0, -'.orb'.length);
        const seen = files.get(name);
        if (seen !== undefined) {
          throw new BehaviorPackageError(`${pkg.name}: two programs named "${name}": ${nodePath.relative(root, seen)} and ${nodePath.relative(root, full)}`);
        }
        files.set(name, full);
      }
    }
  };
  walk(root);
  return files;
}

export interface MaterializeOptions extends RegistryDirOptions {
  /** Package-relative directory the programs are written into. Default `behaviors/registry`. */
  target?: string;
}

function treeFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...treeFiles(path));
    else out.push(path);
  }
  return out.sort();
}

/**
 * Publish-time materialization of a live package (`orb.source`, no
 * `orb.registry`): copies its lowered programs and their catalogs from
 * {@link behaviorRegistryDir} into `target` inside the package, re-emits each
 * program that declares `locales` through `orb emit orb --output` so its merged
 * `<stem>.<locale>.json` catalogs ship beside it, and returns the `orb` block the
 * published manifest declares (`registry` set, `source` kept). Files already in
 * `target` that are not programs are
 * left alone.
 */
export function materializeRegistry(pkg: BehaviorPackage, options: MaterializeOptions = {}): BehaviorPackageOrbBlock {
  if (pkg.orb.registry !== undefined) {
    throw new BehaviorPackageError(`${pkg.name}: already declares \`orb.registry\` (${pkg.orb.registry}) — only a live package is materialized`);
  }
  const sourceRel = pkg.orb.source;
  if (sourceRel === undefined) throw new BehaviorPackageError(`${pkg.name}: declares no \`orb.source\``);
  const orbBin = options.orbBin ?? resolveOrbBinary();
  const mirror = behaviorRegistryDir(pkg, { ...options, orbBin });
  const targetRel = options.target ?? 'behaviors/registry';
  const target = join(pkg.root, targetRel);
  const source = packageFile(pkg, sourceRel, 'orb.source');
  for (const file of treeFiles(mirror)) {
    const rel = relative(mirror, file);
    const dest = join(target, rel);
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(file, dest);
    if (!rel.endsWith('.orb')) continue;
    const program = JSON.parse(readFileSync(file, 'utf8')) as { locales?: string[] };
    if (program.locales === undefined || program.locales.length === 0) continue;
    const lolo = join(source, rel.replace(/\.orb$/, '.lolo'));
    const run = nodeChildProcess.spawnSync(orbBin, ['emit', 'orb', lolo, '--output', dest], { cwd: pkg.root, encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024 });
    if (run.status !== 0) throw new BehaviorPackageError(`${pkg.name}: \`orb emit orb ${rel}\` failed: ${run.stderr}`);
  }
  return { ...pkg.orb, registry: targetRel };
}

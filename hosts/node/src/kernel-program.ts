/**
 * Node-only: run one `.lolo`/`.orb` program on the kernel engine and read what it emits. The program's own atoms
 * (for example `std-llm`) do the work; this host answers the secret, random, credential and `os` asks and nothing else.
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import type { KernelMemoryStoreExports, EmittedEvent, EntityRow, EventPayload, InboundAnswer, InboundDelivery, OrbitalSchema, TransitionRejection, UserContext } from '@almadar/core';
import { dispatchInbound, KernelEngine, NativeMemoryPersistenceAdapter, createSecretPorts, InFlightCalls, kernelOsGrants, type KernelHostPorts, type SecretPorts, type SecretPortsOptions, type KernelModule, type OsHostPort } from '@almadar/shell-runtime';
import { resolveOrbBinary } from '@almadar/core/behavior-package';
import { tickEventKey } from '@almadar/core';
import { installNodeHostPorts } from './host-ports.js';
import { createNodeTokenPost } from './token-post.js';
import { createNodeOsHost } from './os-node.js';
import { loadKernelModule, loadNativeKernelModule, resolveNativeAddon, type LoadedKernel } from './kernel-loader.js';

export interface KernelProgramOptions {
  /** Which kernel runs the program: the WebAssembly module (default; the only one in a browser) or the native add-on. The host's ports are the same for both. */
  engine?: 'wasm' | 'native';
  /** The native kernel add-on (`kernel.node`); absent, `resolveNativeAddon(options.languageFrom)`. Used only by `engine: 'native'`. */
  nativeAddon?: string;
  /** The directory of the built `@almadar/kernel` package (the one holding `pkg/`); absent, `resolveKernelDir()`. */
  kernelDir?: string;
  /** Where the installed `@almadar/core` and `@almadar/std` are found, node-style. */
  languageFrom: string;
  /** Overrides of the secret store and the CSPRNG. */
  secretPorts?: Pick<SecretPortsOptions, 'secrets' | 'random'>;
  /** Rows the program's in-memory store starts with, by entity name (a catalog the host already holds). */
  seed?: Record<string, EntityRow[]>;
  /** Answer the program's `os` effects with the Node host (its grants are the program's own); absent, every `os` ask is denied. */
  os?: boolean;
}

export interface ProgramRun {
  success: boolean;
  /** Every event the dispatch emitted, in order: the program's `-> external` results among them. */
  emits: EmittedEvent[];
  /** Why a transition or one of its effects did not run (an `effect-failed` carries the error); empty when all ran. */
  rejections: TransitionRejection[];
  error?: string;
}

/** `ALMADAR_KERNEL_DIR`, else the `@almadar/kernel` package that `from` (default: the working directory) resolves. */
function resolveKernelDir(from: string = process.cwd()): string {
  const named = process.env.ALMADAR_KERNEL_DIR;
  if (named !== undefined && named !== '') return named;
  const entry = createRequire(join(resolve(from), 'resolve.js')).resolve('@almadar/kernel');
  return dirname(dirname(entry));
}

/** The payload of the first emit named `event`, read through `read`; `undefined` when the run emitted none. */
export function emitPayload<T>(run: ProgramRun, event: string, read: (payload: EventPayload) => T): T | undefined {
  const found = run.emits.find((emit) => emit.event === event);
  return found === undefined ? undefined : read(found.payload ?? {});
}

/**
 * `orb resolve`: the program with every `uses` flattened, as the kernel engine takes it. `orb` is the binary to run,
 * by default the one `resolveOrbBinary` picks.
 */
export async function resolveProgramFile(path: string, cwd: string = dirname(resolve(path)), orb: string = resolveOrbBinary(cwd)): Promise<OrbitalSchema> {
  const absolute = resolve(path);
  return new Promise<OrbitalSchema>((done, fail) => {
    const child = spawn(orb, ['resolve', absolute], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => out.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => err.push(chunk));
    child.on('error', fail);
    child.on('close', (code) => {
      if (code !== 0) {
        fail(new Error(`orb resolve ${absolute} exited ${code}: ${Buffer.concat(err).toString('utf8')}`));
        return;
      }
      const text = Buffer.concat(out).toString('utf8');
      done(JSON.parse(text.slice(text.indexOf('{'))));
    });
  });
}

export class KernelProgram {
  private constructor(
    private readonly engine: KernelEngine,
    private readonly os: OsHostPort | undefined,
    private readonly schema: OrbitalSchema,
    private readonly secretPorts: SecretPorts,
    private readonly persistence: NativeMemoryPersistenceAdapter,
  ) {}

  static async open(schema: OrbitalSchema, options: KernelProgramOptions): Promise<KernelProgram> {
    const languageFrom = { languageFrom: options.languageFrom };
    const native = options.engine === 'native';
    const addon: LoadedKernel | undefined = native ? await loadNativeKernelModule(options.nativeAddon ?? resolveNativeAddon(options.languageFrom), languageFrom) : undefined;
    const kernelDir = addon === undefined ? (options.kernelDir ?? resolveKernelDir()) : '';
    const kernel: KernelModule & KernelMemoryStoreExports = addon ?? (await loadKernelModule(kernelDir, languageFrom));
    installNodeHostPorts();
    let engine: KernelEngine | undefined;
    const requireEngine = (): KernelEngine => {
      if (engine === undefined) throw new Error('KernelProgram: an os ask arrived before the program opened');
      return engine;
    };
    const tokenPost = createNodeTokenPost({ egressAllows: (url) => requireEngine().egressAllows(url), isPublicAddress: (ip) => kernel.isPublicAddress(ip) });
    const secretPorts = createSecretPorts({ tokenPost, ...options.secretPorts });
    const persistence = new NativeMemoryPersistenceAdapter(new kernel.MemoryStore());
    for (const [entityType, rows] of Object.entries(options.seed ?? {})) {
      for (const row of rows) await persistence.writeWhere({ kind: 'upsert', entityType, data: row });
    }
    const os = options.os === true ? createNodeOsHost(kernelOsGrants(kernel, requireEngine)) : undefined;
    const ports: KernelHostPorts = {
      persistence,
      callService: async () => null,
      programEffect: () => undefined,
      inFlightCalls: new InFlightCalls(),
      servicePorts: (caller, _user, message) => ({ caller, message, inputs: () => [], readableEntities: () => [], dispatchInput: async () => { throw new Error('KernelProgram has no input channel'); }, read: async () => [] }),
      deliverLive: () => undefined,
      deferCallOutcome: () => undefined,
      secretPorts,
      ...(os !== undefined ? { os } : {}),
    };
    engine = KernelEngine.open(kernel, schema, ports);
    return new KernelProgram(engine, os, schema, secretPorts, persistence);
  }

  /** Fire `event` at the orbital as `user` (the program's `@user`), wait for its whole cascade (every secret ask included), and return what it emitted. */
  async dispatch(orbital: string, event: string, payload: EventPayload = {}, targetTrait?: string, user?: UserContext): Promise<ProgramRun> {
    const response = await this.engine.evaluate(
      orbital,
      { event, payload, ...(targetTrait !== undefined ? { targetTrait } : {}), ...(user !== undefined ? { user } : {}) },
      { orbital, ...(user !== undefined ? { user } : {}) },
    );
    return {
      success: response.success,
      emits: response.emittedEvents,
      rejections: response.rejections ?? [],
      ...(response.error !== undefined ? { error: response.error } : {}),
    };
  }

  /** Fire `trait`'s tick `name` once, as a host timer would; the kernel evaluates the tick's guard and effects. */
  async tick(orbital: string, trait: string, name: string): Promise<ProgramRun> {
    const response = await this.engine.evaluate(orbital, { event: tickEventKey(name), runTick: { trait, tick: name }, targetTrait: trait }, { orbital });
    return {
      success: response.success,
      emits: response.emittedEvents,
      rejections: response.rejections ?? [],
      ...(response.error !== undefined ? { error: response.error } : {}),
    };
  }

  /** Deliver an `/api/hooks/<name>` request to the program and return the answer it gave (EXEC-INBOUND-1). */
  async deliverInbound(name: string, delivery: InboundDelivery): Promise<InboundAnswer> {
    return dispatchInbound(this.engine, name, delivery, (orbital, request) => this.engine.evaluate(orbital, request, { orbital }), (credential) => this.secretPorts.secrets.get(credential, undefined));
  }

  /** The rows the host's in-memory store holds for `entity` (empty when the native kernel keeps its own `store`). */
  async rows(entity: string): Promise<EntityRow[]> {
    return this.persistence.list(entity);
  }

  close(): void {
    this.os?.close();
    this.engine.dispose();
  }
}

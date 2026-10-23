/**
 * The host side of the native `std-mock-seed` program. Sampling, owner provenance and persona restamp are decided by
 * that program on the kernel (`DATASET_INPUT`, `RESTAMP_INPUT`), which also writes the rows and owner changes through
 * the kernel's `persist batch`; this module only forwards its inputs and reads its typed answers.
 *
 * @packageDocumentation
 */
import {
  EntityRowSchema,
  JsonValueSchema,
  eventPayloadOf,
  isJsonObject,
  isInlineTrait,
  normalizeCallSiteConfigToValues,
  orbitalInlineEntities,
  type EntityRow,
  type TraitConfig,
  type TraitConfigValue,
  type JsonValue,
  type OrbitalSchema,
  type PersistenceAdapter,
  type UserContext,
} from '@almadar/core';
import { ownerFieldsFromSchema } from '@almadar/core/mock';
import type { KernelEngine } from '../../kernel/engine.js';

const SEED_ORBITAL = 'MockSeedOrbital';
const SEED_TRAIT = 'MockSeed';

/** The kernel running the std seed program (`app.forkProgram(seedProgram)`); only dispatch is used. */
export type MockSeedEngine = Pick<KernelEngine, 'evaluate'>;

export interface SeedOwnerCell {
  store: string;
  id: string;
  column: string;
}

export interface SeedOwnerJournal {
  viewerId: string;
  stamped: SeedOwnerCell[];
  deferred: SeedOwnerCell[];
}

export interface SeedOwnerChange extends SeedOwnerCell {
  kind: 'set' | 'rekey';
  ownerId: string;
}

export interface SeededDataset {
  /** Rows by declared collection. */
  stores: Record<string, EntityRow[]>;
  journal: SeedOwnerJournal;
}

export interface SeedRestamp {
  journal: SeedOwnerJournal;
  changes: SeedOwnerChange[];
}

/** The seeding values a program declares: the std-mock-seed config knobs, as the app's composition sets them, else the atom's defaults. */
export interface SeedConfig {
  count: number;
  seed: number;
  /** The identity row id the viewer is when the host names none; empty means anonymous. */
  defaultPersona: string;
  restampOnPersona: boolean;
}

export interface MockSeedRun {
  /** The clock relative mock dates and seed stamps resolve against, in epoch milliseconds. */
  nowMs: number;
  /** The viewer the dataset's owner columns are stamped for; absent, the rows seed unstamped. */
  viewerId?: string;
  locale?: string;
}

function asJson(value: object): JsonValue {
  return JsonValueSchema.parse(JSON.parse(JSON.stringify(value)));
}

function fieldOf(value: JsonValue | undefined, name: string, what: string): JsonValue {
  if (value === undefined || !isJsonObject(value)) throw new Error(`std-mock-seed: ${what} is not an object`);
  const found = value[name];
  if (found === undefined) throw new Error(`std-mock-seed: ${what} has no ${name}`);
  return found;
}

function textOf(value: JsonValue, what: string): string {
  if (typeof value !== 'string') throw new Error(`std-mock-seed: ${what} is not a string`);
  return value;
}

function cellOf(value: JsonValue): SeedOwnerCell {
  return {
    store: textOf(fieldOf(value, 'store', 'owner cell'), 'cell store'),
    id: textOf(fieldOf(value, 'id', 'owner cell'), 'cell id'),
    column: textOf(fieldOf(value, 'column', 'owner cell'), 'cell column'),
  };
}

function cellsOf(value: JsonValue, what: string): SeedOwnerCell[] {
  if (!Array.isArray(value)) throw new Error(`std-mock-seed: ${what} is not an array`);
  return value.map(cellOf);
}

function journalOf(value: JsonValue): SeedOwnerJournal {
  return {
    viewerId: textOf(fieldOf(value, 'viewerId', 'journal'), 'journal viewerId'),
    stamped: cellsOf(fieldOf(value, 'stamped', 'journal'), 'journal stamped'),
    deferred: cellsOf(fieldOf(value, 'deferred', 'journal'), 'journal deferred'),
  };
}

function changeOf(value: JsonValue): SeedOwnerChange {
  const kind = fieldOf(value, 'kind', 'owner change');
  if (kind !== 'set' && kind !== 'rekey') throw new Error('std-mock-seed: owner change kind is neither set nor rekey');
  return { ...cellOf(value), kind, ownerId: textOf(fieldOf(value, 'ownerId', 'owner change'), 'change ownerId') };
}

function storesOf(value: JsonValue): Record<string, EntityRow[]> {
  if (!isJsonObject(value)) throw new Error('std-mock-seed: dataset stores is not an object');
  return Object.fromEntries(Object.entries(value).map(([store, rows]) => [store, EntityRowSchema.array().parse(rows)]));
}

/** `ALMADAR_PERSONA_OWNS`-shaped `Entity.column` strings as the typed pairs the program takes. */
function ownerPairsOf(schema: OrbitalSchema): Record<'entity' | 'column', string>[] {
  return ownerFieldsFromSchema(schema).map((field) => {
    const dot = field.indexOf('.');
    if (dot <= 0 || dot === field.length - 1) throw new Error(`std-mock-seed: owner field ${field} is not Entity.column`);
    return { entity: field.slice(0, dot), column: field.slice(dot + 1) };
  });
}

export class StdMockSeed {
  constructor(private readonly engine: MockSeedEngine, readonly config: SeedConfig, private readonly user?: UserContext) {}

  private async ask(event: string, payload: object, done: string): Promise<JsonValue> {
    const response = await this.engine.evaluate(
      SEED_ORBITAL,
      { event, targetTrait: SEED_TRAIT, payload: eventPayloadOf(asJson(payload)) },
      { orbital: SEED_ORBITAL, ...(this.user !== undefined ? { user: this.user } : {}) },
    );
    const failed = response.emittedEvents.find((emitted) => emitted.event === 'DATASET_FAILED');
    if (failed !== undefined) throw new Error(`std-mock-seed: ${event} refused: ${JSON.stringify(failed.payload ?? {})}`);
    const answer = response.emittedEvents.find((emitted) => emitted.event === done);
    if (answer === undefined) throw new Error(`std-mock-seed: ${event} did not answer ${done}`);
    return asJson(answer.payload ?? {});
  }

  /** Sample the program's dataset (`DATASET_INPUT`). */
  async dataset(program: OrbitalSchema, run: MockSeedRun): Promise<SeededDataset> {
    const done = await this.ask('DATASET_INPUT', {
      program,
      count: this.config.count,
      seed: this.config.seed,
      nowMs: run.nowMs,
      viewerId: run.viewerId ?? '',
      ownerPairs: ownerPairsOf(program),
      ...(run.locale !== undefined ? { locale: run.locale } : {}),
    }, 'DATASET_DONE');
    return { stores: storesOf(fieldOf(done, 'stores', 'DATASET_DONE')), journal: journalOf(fieldOf(done, 'journal', 'DATASET_DONE')) };
  }

  /**
   * Re-point the dataset's tracked owner cells at `viewer` (`RESTAMP_INPUT`); `stores` are the current authoritative rows.
   * `firstOwner` marks the stamp right after seeding; a persona switch restamps only when the program's
   * `restampOnPersona` config says so, otherwise it answers no changes.
   */
  async restamp(program: OrbitalSchema, stores: Record<string, EntityRow[]>, journal: SeedOwnerJournal, viewer: UserContext, firstOwner: boolean): Promise<SeedRestamp> {
    const done = await this.ask('RESTAMP_INPUT', { program, stores, journal, viewer, firstOwner, restampOnPersona: this.config.restampOnPersona }, 'RESTAMP_DONE');
    const changes = fieldOf(done, 'changes', 'RESTAMP_DONE');
    if (!Array.isArray(changes)) throw new Error('std-mock-seed: RESTAMP_DONE changes is not an array');
    return { journal: journalOf(fieldOf(done, 'journal', 'RESTAMP_DONE')), changes: changes.map(changeOf) };
  }
}

const STD_MOCK_SEED_SOURCE = 'std/behaviors/std-mock-seed';
const SEED_TRAIT_REF = 'traits.MockSeed';

function declaredValue<T extends TraitConfigValue>(values: TraitConfig, key: string, is: (v: TraitConfigValue) => v is T): T {
  const value = values[key];
  if (value === undefined || !is(value)) throw new Error(`std-mock-seed: config ${key} is not declared as expected`);
  return value;
}

/**
 * The seeding values as `.lolo` declares them: the std-mock-seed program's own config defaults, overlaid by the
 * config an app's composition of it sets (an orbital that `uses` std-mock-seed and references its MockSeed trait).
 */
export function declaredSeedConfig(seedProgram: OrbitalSchema, app?: OrbitalSchema): SeedConfig {
  const seedTrait = seedProgram.orbitals.flatMap((orbital) => orbital.traits ?? []).find((t) => isInlineTrait(t) && t.name === SEED_TRAIT);
  if (seedTrait === undefined || !isInlineTrait(seedTrait)) throw new Error(`std-mock-seed: the seed program has no ${SEED_TRAIT} trait`);
  const composed = (app?.orbitals ?? []).flatMap((orbital) => {
    const aliases = (orbital.uses ?? []).filter((u) => u.from === STD_MOCK_SEED_SOURCE).map((u) => u.as);
    return (orbital.traits ?? []).flatMap((t) => (typeof t !== 'string' && !isInlineTrait(t) && aliases.some((alias) => t.ref === `${alias}.${SEED_TRAIT_REF}`) ? [normalizeCallSiteConfigToValues(t.config) ?? {}] : []));
  });
  const values: TraitConfig = Object.assign({}, normalizeCallSiteConfigToValues(seedTrait.config) ?? {}, ...composed);
  return {
    count: declaredValue(values, 'count', (v): v is number => typeof v === 'number'),
    seed: declaredValue(values, 'seed', (v): v is number => typeof v === 'number'),
    defaultPersona: declaredValue(values, 'defaultPersona', (v): v is string => typeof v === 'string'),
    restampOnPersona: declaredValue(values, 'restampOnPersona', (v): v is boolean => typeof v === 'boolean'),
  };
}

function entityByStore(program: OrbitalSchema): Map<string, string> {
  const byStore = new Map<string, string>();
  for (const entity of program.orbitals.flatMap(orbitalInlineEntities)) {
    if (entity.collection !== undefined && entity.collection !== '') byStore.set(entity.collection, entity.name);
  }
  return byStore;
}

/** The current rows of every collection the program declares, as the restamp takes them. */
export async function readSeededStores(persistence: PersistenceAdapter, program: OrbitalSchema): Promise<Record<string, EntityRow[]>> {
  const stores: Record<string, EntityRow[]> = {};
  for (const [store, entityType] of entityByStore(program)) stores[store] = await persistence.list(entityType);
  return stores;
}

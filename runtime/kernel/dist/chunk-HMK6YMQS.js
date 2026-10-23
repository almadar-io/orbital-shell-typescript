import { eventPayloadOf, isInlineTrait, normalizeCallSiteConfigToValues, JsonValueSchema, isJsonObject, EntityRowSchema, orbitalInlineEntities } from '@almadar/core';
import { ownerFieldsFromSchema } from '@almadar/core/mock';

// src/runtime/entities/std-mock-seed.ts
var SEED_ORBITAL = "MockSeedOrbital";
var SEED_TRAIT = "MockSeed";
function asJson(value) {
  return JsonValueSchema.parse(JSON.parse(JSON.stringify(value)));
}
function fieldOf(value, name, what) {
  if (value === void 0 || !isJsonObject(value)) throw new Error(`std-mock-seed: ${what} is not an object`);
  const found = value[name];
  if (found === void 0) throw new Error(`std-mock-seed: ${what} has no ${name}`);
  return found;
}
function textOf(value, what) {
  if (typeof value !== "string") throw new Error(`std-mock-seed: ${what} is not a string`);
  return value;
}
function cellOf(value) {
  return {
    store: textOf(fieldOf(value, "store", "owner cell"), "cell store"),
    id: textOf(fieldOf(value, "id", "owner cell"), "cell id"),
    column: textOf(fieldOf(value, "column", "owner cell"), "cell column")
  };
}
function cellsOf(value, what) {
  if (!Array.isArray(value)) throw new Error(`std-mock-seed: ${what} is not an array`);
  return value.map(cellOf);
}
function journalOf(value) {
  return {
    viewerId: textOf(fieldOf(value, "viewerId", "journal"), "journal viewerId"),
    stamped: cellsOf(fieldOf(value, "stamped", "journal"), "journal stamped"),
    deferred: cellsOf(fieldOf(value, "deferred", "journal"), "journal deferred")
  };
}
function changeOf(value) {
  const kind = fieldOf(value, "kind", "owner change");
  if (kind !== "set" && kind !== "rekey") throw new Error("std-mock-seed: owner change kind is neither set nor rekey");
  return { ...cellOf(value), kind, ownerId: textOf(fieldOf(value, "ownerId", "owner change"), "change ownerId") };
}
function storesOf(value) {
  if (!isJsonObject(value)) throw new Error("std-mock-seed: dataset stores is not an object");
  return Object.fromEntries(Object.entries(value).map(([store, rows]) => [store, EntityRowSchema.array().parse(rows)]));
}
function ownerPairsOf(schema) {
  return ownerFieldsFromSchema(schema).map((field) => {
    const dot = field.indexOf(".");
    if (dot <= 0 || dot === field.length - 1) throw new Error(`std-mock-seed: owner field ${field} is not Entity.column`);
    return { entity: field.slice(0, dot), column: field.slice(dot + 1) };
  });
}
var StdMockSeed = class {
  constructor(engine, config, user) {
    this.engine = engine;
    this.config = config;
    this.user = user;
  }
  engine;
  config;
  user;
  async ask(event, payload, done) {
    const response = await this.engine.evaluate(
      SEED_ORBITAL,
      { event, targetTrait: SEED_TRAIT, payload: eventPayloadOf(asJson(payload)) },
      { orbital: SEED_ORBITAL, ...this.user !== void 0 ? { user: this.user } : {} }
    );
    const failed = response.emittedEvents.find((emitted) => emitted.event === "DATASET_FAILED");
    if (failed !== void 0) throw new Error(`std-mock-seed: ${event} refused: ${JSON.stringify(failed.payload ?? {})}`);
    const answer = response.emittedEvents.find((emitted) => emitted.event === done);
    if (answer === void 0) throw new Error(`std-mock-seed: ${event} did not answer ${done}`);
    return asJson(answer.payload ?? {});
  }
  /** Sample the program's dataset (`DATASET_INPUT`). */
  async dataset(program, run) {
    const done = await this.ask("DATASET_INPUT", {
      program,
      count: this.config.count,
      seed: this.config.seed,
      nowMs: run.nowMs,
      viewerId: run.viewerId ?? "",
      ownerPairs: ownerPairsOf(program),
      ...run.locale !== void 0 ? { locale: run.locale } : {}
    }, "DATASET_DONE");
    return { stores: storesOf(fieldOf(done, "stores", "DATASET_DONE")), journal: journalOf(fieldOf(done, "journal", "DATASET_DONE")) };
  }
  /**
   * Re-point the dataset's tracked owner cells at `viewer` (`RESTAMP_INPUT`); `stores` are the current authoritative rows.
   * `firstOwner` marks the stamp right after seeding; a persona switch restamps only when the program's
   * `restampOnPersona` config says so, otherwise it answers no changes.
   */
  async restamp(program, stores, journal, viewer, firstOwner) {
    const done = await this.ask("RESTAMP_INPUT", { program, stores, journal, viewer, firstOwner, restampOnPersona: this.config.restampOnPersona }, "RESTAMP_DONE");
    const changes = fieldOf(done, "changes", "RESTAMP_DONE");
    if (!Array.isArray(changes)) throw new Error("std-mock-seed: RESTAMP_DONE changes is not an array");
    return { journal: journalOf(fieldOf(done, "journal", "RESTAMP_DONE")), changes: changes.map(changeOf) };
  }
};
var STD_MOCK_SEED_SOURCE = "std/behaviors/std-mock-seed";
var SEED_TRAIT_REF = "traits.MockSeed";
function declaredValue(values, key, is) {
  const value = values[key];
  if (value === void 0 || !is(value)) throw new Error(`std-mock-seed: config ${key} is not declared as expected`);
  return value;
}
function declaredSeedConfig(seedProgram, app) {
  const seedTrait = seedProgram.orbitals.flatMap((orbital) => orbital.traits ?? []).find((t) => isInlineTrait(t) && t.name === SEED_TRAIT);
  if (seedTrait === void 0 || !isInlineTrait(seedTrait)) throw new Error(`std-mock-seed: the seed program has no ${SEED_TRAIT} trait`);
  const composed = (app?.orbitals ?? []).flatMap((orbital) => {
    const aliases = (orbital.uses ?? []).filter((u) => u.from === STD_MOCK_SEED_SOURCE).map((u) => u.as);
    return (orbital.traits ?? []).flatMap((t) => typeof t !== "string" && !isInlineTrait(t) && aliases.some((alias) => t.ref === `${alias}.${SEED_TRAIT_REF}`) ? [normalizeCallSiteConfigToValues(t.config) ?? {}] : []);
  });
  const values = Object.assign({}, normalizeCallSiteConfigToValues(seedTrait.config) ?? {}, ...composed);
  return {
    count: declaredValue(values, "count", (v) => typeof v === "number"),
    seed: declaredValue(values, "seed", (v) => typeof v === "number"),
    defaultPersona: declaredValue(values, "defaultPersona", (v) => typeof v === "string"),
    restampOnPersona: declaredValue(values, "restampOnPersona", (v) => typeof v === "boolean")
  };
}
function entityByStore(program) {
  const byStore = /* @__PURE__ */ new Map();
  for (const entity of program.orbitals.flatMap(orbitalInlineEntities)) {
    if (entity.collection !== void 0 && entity.collection !== "") byStore.set(entity.collection, entity.name);
  }
  return byStore;
}
async function readSeededStores(persistence, program) {
  const stores = {};
  for (const [store, entityType] of entityByStore(program)) stores[store] = await persistence.list(entityType);
  return stores;
}

export { StdMockSeed, declaredSeedConfig, readSeededStores };

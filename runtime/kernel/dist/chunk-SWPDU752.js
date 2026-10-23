import { isJsonObject } from '@almadar/core';

// src/credentials/seed.ts
function planRows(json) {
  const rows = JSON.parse(json);
  if (!Array.isArray(rows)) throw new Error("the kernel seed plan is not a list");
  return rows.map((row) => {
    if (!isJsonObject(row) || typeof row.service !== "string" || typeof row.envVar !== "string") {
      throw new Error("the kernel seed plan holds a row that is not { service, envVar }");
    }
    return { service: row.service, envVar: row.envVar };
  });
}
async function seedCredentialStore(store, declared, env, kernel) {
  if (!store.enabled) return 0;
  const names = [...new Set(declared.map((d) => d.envVar))];
  const held = names.filter((name) => store.resolve(name) !== void 0);
  const present = names.filter((name) => (env[name] ?? "") !== "");
  const plan = planRows(kernel.credentialSeedPlan(JSON.stringify(declared), JSON.stringify(held), JSON.stringify(present)));
  for (const { service, envVar } of plan) {
    const value = env[envVar];
    if (value === void 0) throw new Error(`the kernel seeded ${envVar}, which the env does not hold`);
    await store.set(service, envVar, value);
  }
  return plan.length;
}

export { seedCredentialStore };

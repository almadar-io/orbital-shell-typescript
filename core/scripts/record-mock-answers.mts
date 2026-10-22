// Records the TS mock answer for every service action in the services registry.
// Usage (from packages/almadar-core): npx tsx scripts/record-mock-answers.mts ../../orbital-rust/crates/orbital-core/tests/fixtures/mock-answers/mock-answers.json
import { writeFileSync } from 'node:fs';
import { mockServiceAnswer, registryActionNames, registryServiceNames } from '../src/mock/serviceAnswer';

const cases = registryServiceNames().flatMap((service) =>
  registryActionNames(service).map((action) => {
    const answer = mockServiceAnswer(service, action);
    if (!answer.ok) throw new Error(`${service}.${action}: ${answer.message}`);
    return { service, action, params: {}, success: true, data: answer.value };
  }),
);
writeFileSync(process.argv[2], JSON.stringify({ cases }, null, 2) + '\n');
console.log(`recorded ${cases.length} cases`);

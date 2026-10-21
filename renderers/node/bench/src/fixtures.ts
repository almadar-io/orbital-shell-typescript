import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { OrbitalSchema } from '@almadar/core';
import type { JsonValue, Scenario, ScenarioFixture, ScenarioStep, StepExpectation } from './types.js';

interface RawStep {
  trait?: string;
  event?: string;
  payload?: JsonValue;
  expect?: StepExpectation;
}

interface RawScenario extends RawStep {
  name?: string;
  orbital?: string;
  steps?: RawStep[];
}

interface RawFixture {
  name?: string;
  description?: string;
  schema?: OrbitalSchema;
  clockFields?: string[];
  mintedIdFields?: string[];
  dispatchModes?: Record<string, string>;
  scenarios?: RawScenario[];
}

function toStep(raw: RawStep, where: string): ScenarioStep {
  if (typeof raw.trait !== 'string' || typeof raw.event !== 'string') {
    throw new Error(`${where}: a step needs string "trait" and "event"`);
  }
  const step: ScenarioStep = { trait: raw.trait, event: raw.event, payload: raw.payload };
  if (raw.expect !== undefined) step.expect = raw.expect;
  return step;
}

function toScenario(raw: RawScenario, where: string): Scenario {
  if (typeof raw.orbital !== 'string') throw new Error(`${where}: "orbital" must be a string`);
  const steps = raw.steps !== undefined ? raw.steps.map((s, i) => toStep(s, `${where}.steps[${i}]`)) : [toStep(raw, where)];
  const scenario: Scenario = { orbital: raw.orbital, steps };
  if (raw.name !== undefined) scenario.name = raw.name;
  return scenario;
}

function toFixture(raw: RawFixture, file: string): ScenarioFixture {
  if (typeof raw.name !== 'string') throw new Error(`${file}: "name" must be a string`);
  if (raw.schema === undefined || raw.schema === null || typeof raw.schema !== 'object') {
    throw new Error(`${file}: "schema" must be an object`);
  }
  if (!Array.isArray(raw.scenarios)) throw new Error(`${file}: "scenarios" must be an array`);
  const fixture: ScenarioFixture = {
    name: raw.name,
    schema: raw.schema,
    clockFields: raw.clockFields ?? [],
    mintedIdFields: raw.mintedIdFields ?? [],
    scenarios: raw.scenarios.map((s, i) => toScenario(s, `${file}: scenarios[${i}]`)),
  };
  if (raw.description !== undefined) fixture.description = raw.description;
  if (raw.dispatchModes !== undefined) fixture.dispatchModes = raw.dispatchModes;
  return fixture;
}

/** Loads every `*.json` fixture in exactly the directory given; the caller names it, nothing is searched for. */
export async function loadScenarioFixtures(dir: string): Promise<ScenarioFixture[]> {
  const entries = await readdir(dir);
  const files = entries.filter((f) => f.endsWith('.json')).sort();
  const fixtures: ScenarioFixture[] = [];
  for (const file of files) {
    const raw: RawFixture = JSON.parse(await readFile(join(dir, file), 'utf8'));
    fixtures.push(toFixture(raw, file));
  }
  return fixtures;
}

export function scenarioKey(fixture: ScenarioFixture, index: number): string {
  return `${fixture.name}#${index}`;
}

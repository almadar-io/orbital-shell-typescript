import type { EmitRecord, JsonValue, Scenario, ScenarioFixture, ScenarioStep, TraceStep } from './types.js';

export const DEFAULT_VIEWER = '{"id":"viewer-1","name":"Dev Viewer","email":"viewer@example.com","role":""}';
export const SINGLETON_ENTITY = 'singleton';
export const KERNEL_CLIENT_ID = 'bench';

/** The `Kernel` surface a row drives: JSON strings in and out, exactly as `@almadar/kernel` exports it. */
export interface KernelHandle {
  dispatch(traitName: string, entityId: string | undefined, event: string, payloadJson: string): string;
  getState(traitName: string, entityId: string): string;
  setCurrentUser(userJson: string): void;
  free(): void;
}

interface WireResponse {
  emittedEvents?: { event: string; payload?: JsonValue }[];
  clientEffectsByTrait?: { effect: JsonValue }[];
}

interface DispatchWire {
  error?: string;
  response?: WireResponse;
}

/** The traits of the scenario's orbital: `states` reads one `getState` per trait, omitting traits with none. */
export function orbitalTraitNames(fixture: ScenarioFixture, scenario: Scenario): string[] {
  const orbital = fixture.schema.orbitals.find((o) => o.name === scenario.orbital);
  if (orbital === undefined) throw new Error(`${fixture.name}: no orbital "${scenario.orbital}"`);
  const traits = orbital.traits ?? [];
  const names: string[] = [];
  for (const t of traits) if (typeof t === 'object' && t !== null && 'name' in t && typeof t.name === 'string') names.push(t.name);
  return names;
}

export function dispatchTraceStep(handle: KernelHandle, traitNames: readonly string[], step: ScenarioStep): TraceStep {
  const text = handle.dispatch(step.trait, undefined, step.event, JSON.stringify(step.payload ?? {}));
  const wire: DispatchWire = JSON.parse(text);
  if (wire.error !== undefined) throw new Error(`${step.trait}.${step.event}: ${wire.error}`);
  const states: Record<string, string> = {};
  for (const name of traitNames) {
    const state = handle.getState(name, SINGLETON_ENTITY);
    if (state !== '') states[name] = state;
  }
  if (!(step.trait in states)) throw new Error(`trait "${step.trait}" has no state after the dispatch`);
  const response = wire.response;
  const emits: EmitRecord[] = (response?.emittedEvents ?? []).map((e) => ({ event: e.event, payload: e.payload ?? null }));
  return { trait: step.trait, event: step.event, states, effects: (response?.clientEffectsByTrait ?? []).map((frame) => frame.effect), emits };
}

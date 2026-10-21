import type {
  BehaviorDescription,
  CatalogEntry,
  CircuitStepResult,
  DependencyGraph,
  EvaluatedProgram,
  EventPayload,
  OrbitalSchema,
  ProgramValidationIssue,
  TraitDescription,
} from '@almadar/core';

/** The effects the language trio routes to this host. */
export const PROGRAM_EFFECTS = [
  'behavior/catalog',
  'behavior/describe',
  'behavior/source',
  'behavior/resolve',
  'behavior/dependencies',
  'program/read',
  'program/print',
  'program/eval',
  'program/validate',
  'program/compose',
  'program/step',
] as const;
export type ProgramEffectName = (typeof PROGRAM_EFFECTS)[number];

/** Narrow an effect head to one this host runs. */
export function isProgramEffect(name: string): name is ProgramEffectName {
  return (PROGRAM_EFFECTS as readonly string[]).includes(name);
}

/** What `program/validate` returns. */
export interface ProgramValidationReport {
  readonly valid: boolean;
  readonly errors: readonly ProgramValidationIssue[];
  readonly warnings: readonly ProgramValidationIssue[];
}

/** One transition a host asks to play: the trait, the state it plays from, and the event with its payload. */
export interface StepRequest {
  orbital: string;
  trait: string;
  from: string;
  event: string;
  payload: EventPayload;
}

/** A played request: the request as asked, and the circuit it ran. */
export type PlayedStep = StepRequest & { result: CircuitStepResult };

/** The outcome of one program effect: the value for `{ result }`, or the failure (`errors` for eval's validator issues). */
export type ProgramEffectOutcome =
  | { readonly ok: true; readonly result: CatalogEntry[] | TraitDescription | BehaviorDescription | OrbitalSchema | string | EvaluatedProgram | ProgramValidationReport | DependencyGraph | PlayedStep[] }
  | { readonly ok: false; readonly error: string; readonly errors?: readonly ProgramValidationIssue[] };

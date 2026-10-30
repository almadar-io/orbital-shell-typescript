import type {
  BehaviorDescription,
  CatalogEntry,
  DependencyGraph,
  EvaluatedProgram,
  EventPayload,
  OrbitalSchema,
  ProgramValidationIssue,
  ProgramInspection,
  TraitDescription,
} from '@almadar/core';
import type { OsGrantsReport, PlayedStep, ProveReport } from '@almadar/core/kernel-wire';

export type { PlayedStep };

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
  'program/prove',
  'program/os-grants',
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
  /** Fields merged into the trait's entity row before the event. */
  entity?: EventPayload;
  /** Knob values over the trait's declared config defaults, for this request's trait only. */
  config?: EventPayload;
  /** The ms-epoch `@now` the step's dispatch reads, in place of the wall clock. */
  now?: number;
  /** A live call's cutoff: an open call still running after this many ms is cancelled. */
  settleMs?: number;
  /** The user the request dispatches as (`@user`); null or absent is nobody. */
  viewer?: EventPayload | null;
}

/** The outcome of one program effect: the value for `{ result }`, or the failure (`errors` for eval's validator issues). */
export type ProgramEffectOutcome =
  | { readonly ok: true; readonly result: ProgramInspection | CatalogEntry[] | TraitDescription | BehaviorDescription | OrbitalSchema | string | EvaluatedProgram | ProgramValidationReport | ProveReport | OsGrantsReport | DependencyGraph | PlayedStep[] }
  | { readonly ok: false; readonly error: string; readonly errors?: readonly ProgramValidationIssue[] };

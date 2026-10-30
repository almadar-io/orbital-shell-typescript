/**
 * The circuit a client mounts, as the kernel answers it: the page's traits with what the kernel holds of each
 * (`pageCircuit` names them, `programSurface` describes them), the traits of the whole app, and its browser-stored
 * entities. Nothing here reads the program; every field is the kernel's.
 *
 * @packageDocumentation
 */
import type { PageCircuit, ProgramSurface, TraitSurface } from '@almadar/core/kernel-wire';
import type { TraitDefinition } from '@almadar/core';
import type { KernelInstance } from './kernel-wire';

/** The page's traits (its mounts and the traits they embed), by name. */
export interface CircuitSurface {
  readonly byName: ReadonlyMap<string, TraitSurface>;
}

export const NO_CIRCUIT: CircuitSurface = { byName: new Map() };

export interface ResolvedCircuit {
  /** The kernel's answer for the page. */
  page: PageCircuit;
  /** The page's traits with their surfaces. */
  surface: CircuitSurface;
  /** Every trait of the app, on any page. */
  appTraitNames: ReadonlySet<string>;
  /** The entities whose rows live in the browser store. */
  browserEntities: ReadonlySet<string>;
}

function parse<T>(text: string): T {
  return JSON.parse(text);
}

/** Ask the kernel which traits `page` (or `route`; neither: the initial page) mounts and what it holds of each. */
export function resolveCircuit(kernel: Pick<KernelInstance, 'pageCircuit' | 'contractQuery'>, page?: string, route?: string): ResolvedCircuit {
  const circuit = parse<PageCircuit>(kernel.pageCircuit(page, route));
  const program = parse<ProgramSurface>(kernel.contractQuery(JSON.stringify({ kind: 'programSurface' })));
  const byName = new Map<string, TraitSurface>();
  for (const trait of program.traits) {
    if (trait.name in circuit.orbitalByTrait) byName.set(trait.name, trait);
  }
  return {
    page: circuit,
    surface: { byName },
    appTraitNames: new Set(program.traits.map((trait) => trait.name)),
    browserEntities: new Set(program.browserEntities),
  };
}

/** Every trait of the program with what the kernel holds of it: a host that mounts every page runs on this. */
export function programCircuit(kernel: Pick<KernelInstance, 'contractQuery'>): CircuitSurface {
  const program = parse<ProgramSurface>(kernel.contractQuery(JSON.stringify({ kind: 'programSurface' })));
  return { byName: new Map(program.traits.map((trait) => [trait.name, trait])) };
}

/** The state-machine shape a circuit store keeps a trait's initial state from. */
export function memoryTraitDefinitions(surface: CircuitSurface): TraitDefinition[] {
  return Array.from(surface.byName, ([name, trait]) => ({
    name,
    states: trait.states.map((state) => ({ name: state, ...(state === trait.initial ? { isInitial: true } : {}) })),
    transitions: [],
  }));
}

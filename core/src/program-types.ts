/**
 * The program-level value types the `.lolo` language names (`orbital`, `trait`, `behavior`, the `Viewer`, a program's `MachineRow`s and `PlayedStep`s) as records, projected
 * from the `@almadar/core` zod schemas that define them. `tsup` writes the result to
 * `dist/language/program-types.json` (`orbLanguage.programTypes`); `orb` reads it to type a field read out of
 * such a value. Nothing here is hand-copied from a schema: a member is its schema's own type, and a schema this
 * projection cannot express as a language type fails the build naming its path.
 *
 * The output is the `.orb` field-definition shape (`FieldDefinition` in `orbital-core`): one representation for a
 * language type, whether a program declares it or the language does.
 *
 * @packageDocumentation
 */
import { z } from 'zod';

import { PageMetaSchema } from './types/page.js';
import { EventPayloadSchema, SExprSchema } from './types/expression.js';
import { EntityFieldSchema } from './types/field.js';
import { BehaviorRefSchema, OrbitalValueSchema, TraitValueSchema } from './types/behavior-value.js';
import { ConfigFieldDeclarationSchema, TraitConfigValueSchema } from './types/trait.js';
import { ViewerSchema } from './types/user.js';
import { JsonValueSchema } from './types/json.js';
import { EvalPathSchema, MachineRowSchema, PlayedStepSchema } from './types/program-machine.js';

/** One member or type in the `.orb` field-definition shape. */
export interface ProgramTypeField {
  type: string;
  required?: true;
  nullable?: boolean;
  additionalProperties?: ProgramTypeField;
  values?: string[];
  items?: ProgramTypeField;
  properties?: Record<string, ProgramTypeField>;
}

export type ProgramTypes = Record<string, ProgramTypeField>;

export class ProgramTypeError extends Error {
  constructor(path: string, reason: string) {
    super(`program type ${path}: ${reason}`);
    this.name = 'ProgramTypeError';
  }
}

/**
 * Schemas whose value is program data the language holds as `SExpr` and never reads member by member: an
 * expression, a JSON-shaped config value, a declaration of a config knob or an entity field, a page title that is
 * a literal or an `i18n/t` call, a JSON value or event payload, a trace path. Matched by schema identity, so the list is the only place a type is named.
 */
const PROGRAM_DATA: readonly z.ZodType[] = [
  SExprSchema,
  TraitConfigValueSchema,
  ConfigFieldDeclarationSchema,
  EntityFieldSchema,
  PageMetaSchema,
  JsonValueSchema,
  EventPayloadSchema,
  EvalPathSchema,
];

const SEXPR: ProgramTypeField = { type: 'SExpr' };

function sameShape(a: ProgramTypeField, b: ProgramTypeField): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function literalOf(schema: z.ZodType): string | undefined {
  const inner = unwrap(schema);
  if (inner instanceof z.ZodLiteral && typeof inner.value === 'string') return inner.value;
  if (inner instanceof z.ZodEnum && inner.options.length === 1) return inner.options[0] as string;
  return undefined;
}

function classic(schema: z.core.$ZodType, path: string): z.ZodType {
  if (schema instanceof z.ZodType) return schema;
  throw new ProgramTypeError(path, 'is not a zod classic schema');
}

/** The schema under optional / nullable / default / transform wrappers. */
function unwrap(schema: z.ZodType): z.ZodType {
  let current = schema;
  for (;;) {
    if (PROGRAM_DATA.includes(current)) return current;
    if (current instanceof z.ZodOptional || current instanceof z.ZodNullable || current instanceof z.ZodDefault) current = classic(current.unwrap(), 'unwrap');
    else if (current instanceof z.ZodPipe) current = classic(current.out instanceof z.ZodTransform ? current.in : current.out, 'unwrap');
    else return current;
  }
}

type Getter = () => z.core.$ZodType;

function project(schema: z.core.$ZodType, path: string, trail: readonly Getter[]): ProgramTypeField {
  const own = classic(schema, path);
  const field = projectBase(own, path, trail);
  return own.isNullable() && !PROGRAM_DATA.includes(unwrap(own)) ? { ...field, nullable: true } : field;
}

function projectBase(schema: z.ZodType, path: string, trail: readonly Getter[]): ProgramTypeField {
  const here = unwrap(schema);
  if (PROGRAM_DATA.includes(here)) return SEXPR;
  if (here instanceof z.ZodLazy) {
    const getter: Getter = here.def.getter;
    if (trail.includes(getter)) throw new ProgramTypeError(path, 'is recursive and names no type to refer back to');
    return project(getter(), path, [...trail, getter]);
  }
  if (here instanceof z.ZodString) return { type: 'string' };
  if (here instanceof z.ZodNumber) return { type: 'number' };
  if (here instanceof z.ZodBoolean) return { type: 'boolean' };
  if (here instanceof z.ZodLiteral) {
    if (typeof here.value !== 'string') throw new ProgramTypeError(path, `a ${typeof here.value} literal has no language type`);
    return { type: 'enum', values: [here.value] };
  }
  if (here instanceof z.ZodEnum) return { type: 'enum', values: [...(here.options as string[])] };
  if (here instanceof z.ZodArray) return { type: 'array', items: project(here.element, `${path}[]`, trail) };
  if (here instanceof z.ZodTuple) {
    const properties: Record<string, ProgramTypeField> = {};
    here.def.items.forEach((item, i) => {
      properties[String(i)] = project(item, `${path}.${i}`, trail);
    });
    return { type: 'tuple', properties };
  }
  if (here instanceof z.ZodRecord) return { type: 'object', items: project(here.valueType, `${path}{}`, trail) };
  if (here instanceof z.ZodObject) {
    const properties: Record<string, ProgramTypeField> = {};
    for (const [key, member] of Object.entries(here.shape)) {
      const field = project(member, `${path}.${key}`, trail);
      properties[key] = classic(member, `${path}.${key}`).isOptional() ? field : { ...field, required: true };
    }
    const catchall = here.def.catchall;
    return { type: 'object', properties, ...(catchall === undefined || catchall instanceof z.ZodNever ? {} : { additionalProperties: project(catchall, `${path}{additional}`, trail) }) };
  }
  if (here instanceof z.ZodUnion) return projectUnion(here.options.map((option, i) => classic(option, `${path}|${i}`)), path, trail);
  throw new ProgramTypeError(path, `${here.constructor.name} has no language type`);
}

function projectUnion(options: z.ZodType[], path: string, trail: readonly Getter[]): ProgramTypeField {
  const members = options.filter((option) => !(unwrap(option) instanceof z.ZodNull));
  const projected = members.map((option, i) => project(option, `${path}|${i}`, trail));
  const [first] = projected;
  if (first === undefined) throw new ProgramTypeError(path, 'is an empty union');
  if (projected.every((p) => sameShape(p, first))) return first;
  const names = members.map((option) => literalOf(option));
  if (names.every((n): n is string => n !== undefined)) return { type: 'enum', values: names };
  const tag = taggedBy(members);
  if (tag !== undefined) {
    const variants: Record<string, ProgramTypeField> = {};
    members.forEach((option, i) => {
      variants[tag.names[i]] = projected[i];
    });
    return { type: 'union', values: tag.names, properties: variants };
  }
  throw new ProgramTypeError(path, 'is a union of unlike kinds with no tag field to tell them apart');
}

/** The one key every object member declares as a single-valued literal, when the members differ by it. */
function taggedBy(members: z.ZodType[]): { key: string; names: string[] } | undefined {
  const shapes = members.map((m) => {
    const inner = unwrap(m);
    return inner instanceof z.ZodObject ? inner.shape : undefined;
  });
  if (shapes.some((s) => s === undefined)) return undefined;
  const [firstShape] = shapes as z.core.$ZodShape[];
  for (const key of Object.keys(firstShape)) {
    const names = (shapes as z.core.$ZodShape[]).map((s) => (s[key] === undefined ? undefined : literalOf(classic(s[key], key))));
    if (names.every((n): n is string => n !== undefined) && new Set(names).size === names.length) return { key, names };
  }
  return undefined;
}

/** Projects one schema (exported for the build and its tests). */
export function projectProgramType(name: string, schema: z.ZodType): ProgramTypeField {
  return project(schema, name, []);
}

/** The language's program value types, by name. */
export function buildProgramTypes(): ProgramTypes {
  return {
    BehaviorRef: projectProgramType('BehaviorRef', BehaviorRefSchema),
    OrbitalValue: projectProgramType('OrbitalValue', OrbitalValueSchema),
    TraitValue: projectProgramType('TraitValue', TraitValueSchema),
    Viewer: projectProgramType('Viewer', ViewerSchema),
    MachineRow: projectProgramType('MachineRow', MachineRowSchema),
    PlayedStep: projectProgramType('PlayedStep', PlayedStepSchema),
  };
}

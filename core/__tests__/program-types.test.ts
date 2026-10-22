import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { buildProgramTypes, projectProgramType, ProgramTypeError, type ProgramTypeField } from '../src/program-types.js';

function member(type: ProgramTypeField, name: string): ProgramTypeField {
  const found = type.properties?.[name];
  if (found === undefined) throw new Error(`no member ${name}`);
  return found;
}

describe('program types', () => {
  const types = buildProgramTypes();

  it('names the value types the language has', () => {
    expect(Object.keys(types).sort()).toEqual(['BehaviorRef', 'MachineRow', 'OrbitalValue', 'PlayedStep', 'TraitValue', 'Viewer']);
  });

  it('a machine row is a typed transition with its declared payload slots', () => {
    const row = types.MachineRow;
    for (const key of ['orbital', 'trait', 'from', 'event', 'to']) expect(member(row, key)).toEqual({ type: 'string', required: true });
    expect(member(row, 'guarded')).toEqual({ type: 'boolean', required: true });
    const slot = member(row, 'payload').items!;
    expect(member(slot, 'required')).toEqual({ type: 'boolean', required: true });
    expect(member(slot, 'values')).toEqual({ type: 'array', items: { type: 'string' } });
    expect(member(slot, 'entity')).toEqual({ type: 'string' });
  });

  it('a played step reads its fired flag, arm, guards and effects; payloads and guard expressions stay data', () => {
    const result = member(types.PlayedStep, 'result');
    expect(member(result, 'transitionFired')).toEqual({ type: 'boolean', required: true });
    expect(member(result, 'guard')).toEqual({ type: 'enum', values: ['pass', 'fail', 'none'], required: true });
    expect(member(result, 'firedArm')).toEqual({ type: 'number' });
    expect(member(member(result, 'state'), 'before')).toEqual({ type: 'string', nullable: true, required: true });
    const guard = member(result, 'guards').items!;
    expect(member(guard, 'passed')).toEqual({ type: 'boolean', required: true });
    expect(member(guard, 'guard')).toEqual({ type: 'SExpr', required: true });
    expect(member(member(guard, 'trace').items!, 'path')).toEqual({ type: 'SExpr', required: true });
    expect(member(member(result, 'effects').items!, 'status').values).toEqual(['executed', 'failed', 'skipped']);
    expect(member(types.PlayedStep, 'payload')).toEqual({ type: 'SExpr', required: true });
    expect(member(member(result, 'emitted').items!, 'payload')).toEqual({ type: 'SExpr' });
  });

  it('a viewer requires its id and claims, whose values retain the canonical JSON data contract', () => {
    const claim = member(types.Viewer, 'claims').items!;
    expect(member(claim, 'name')).toEqual({ type: 'string', required: true });
    expect(member(claim, 'value')).toEqual({ type: 'SExpr', required: true });
  });

  it('an orbital value requires the behavior and orbital it names', () => {
    const value = types.OrbitalValue;
    expect(member(value, 'behavior')).toEqual({ type: 'string', required: true });
    expect(member(value, 'orbital')).toEqual({ type: 'string', required: true });
    expect(member(value, 'name').required).toBeUndefined();
  });

  it('an orbital value carries its import body typed member by member', () => {
    const value = types.OrbitalValue;
    expect(member(value, 'pages')).toEqual({ type: 'object', items: { type: 'string' } });
    expect(member(value, 'entity')).toEqual({ type: 'string' });
    expect(member(value, 'persistence').type).toBe('enum');
    expect(member(value, 'shared')).toEqual({ type: 'boolean' });
    expect(member(value, 'omit')).toEqual({ type: 'array', items: { type: 'string' } });
  });

  it('program data members are held as SExpr', () => {
    const value = types.OrbitalValue;
    expect(member(value, 'app')).toEqual({ type: 'object', items: { type: 'SExpr' } });
    expect(member(value, 'extend')).toEqual({ type: 'array', items: { type: 'SExpr' } });
    expect(member(member(value, 'pageModifiers').items!, 'title')).toEqual({ type: 'SExpr' });
  });

  it('listen sources are a union told apart by their kind', () => {
    const listens = member(types.TraitValue, 'listens');
    const source = member(listens.items!, 'source');
    expect(source.type).toBe('union');
    expect(source.values).toEqual(['any', 'trait', 'orbital']);
    expect(member(source.properties!.orbital, 'kind')).toEqual({ type: 'enum', values: ['orbital'], required: true });
  });

  it('a trait value requires its behavior and trait, a behavior reference only its behavior', () => {
    expect(member(types.TraitValue, 'trait').required).toBe(true);
    expect(member(types.TraitValue, 'behavior').required).toBe(true);
    expect(member(types.BehaviorRef, 'behavior').required).toBe(true);
    expect(member(types.BehaviorRef, 'bridge').required).toBeUndefined();
  });

  it('uses only field types the language has', () => {
    const known = new Set(['string', 'number', 'boolean', 'enum', 'array', 'tuple', 'object', 'union', 'SExpr']);
    const seen: string[] = [];
    const walk = (field: ProgramTypeField): void => {
      seen.push(field.type);
      if (field.items) walk(field.items);
      Object.values(field.properties ?? {}).forEach(walk);
    };
    Object.values(types).forEach(walk);
    expect(seen.filter((t) => !known.has(t))).toEqual([]);
  });
});

describe('the projection refuses what the language cannot type', () => {
  it('projects a plain object', () => {
    expect(projectProgramType('X', z.object({ a: z.string(), b: z.number().optional() }))).toEqual({
      type: 'object',
      properties: { a: { type: 'string', required: true }, b: { type: 'number' } },
    });
  });

  it('a union of unlike kinds with no tag fails naming its path', () => {
    const untagged = z.object({ a: z.object({ x: z.union([z.string(), z.object({ y: z.string() })]) }) });
    expect(() => projectProgramType('X', untagged)).toThrow(ProgramTypeError);
    expect(() => projectProgramType('X', untagged)).toThrow('X.a.x');
  });

  it('control: unlike kinds with a tag field are a tagged union', () => {
    const tagged = z.union([z.object({ kind: z.literal('a'), x: z.string() }), z.object({ kind: z.literal('b'), y: z.number() })]);
    const projected = projectProgramType('X', tagged);
    expect(projected.type).toBe('union');
    expect(projected.values).toEqual(['a', 'b']);
  });

  it('an unrepresentable schema and a recursive one fail', () => {
    expect(() => projectProgramType('X', z.object({ a: z.date() }))).toThrow('X.a');
    type Chain = { next?: Chain };
    const node: z.ZodType<Chain> = z.lazy(() => z.object({ next: node.optional() }));
    expect(() => projectProgramType('X', z.object({ n: node }))).toThrow('recursive');
  });
});


describe('native metadata projection', () => {
  it('keeps field presence independent from nullability and retains typed catchalls', () => {
    const schema = z.object({ id: z.string().optional(), maybe: z.string().nullable(), optionalNullable: z.number().nullable().optional() }).catchall(z.boolean().nullable());
    expect(projectProgramType('OpenRecord', schema)).toEqual({ type: 'object', properties: {
      id: { type: 'string' }, maybe: { type: 'string', nullable: true, required: true }, optionalNullable: { type: 'number', nullable: true },
    }, additionalProperties: { type: 'boolean', nullable: true } });
    expect(projectProgramType('ClosedControl', z.object({ id: z.string() }))).toEqual({ type: 'object', properties: { id: { type: 'string', required: true } } });
  });
});

/**
 * A generator eval as data: the turns a user types, the structural checks each turn's built program
 * must pass, and what the build must adopt. `orb eval` runs it; mirrored by orbital-core `eval_spec`.
 */
import { z } from 'zod';
import type { JsonValue } from './json.js';
import { JsonValueSchema } from './json.js';

/** A regular expression carried as data (`new RegExp(pattern, flags)`). */
export interface EvalPattern {
  pattern: string;
  flags?: string;
}

export type EvalPredicate =
  /** a persistent entity named by the nouns */
  | { kind: 'entity' }
  /** a field named by the nouns on a persistent entity; `required`: declared required or read by a create guard/policy */
  | { kind: 'field'; required?: boolean }
  /** an enum value named by `value` on a persistent entity named by the nouns */
  | { kind: 'enumValue'; value: EvalPattern }
  /** a policy or transition guard on the nouns entity compares `@user.role` */
  | { kind: 'roleGated' }
  /** the nouns entity's read policy compares a row value to `@user.id`; with `by`, through a field the request names */
  | { kind: 'ownerScoped'; by?: EvalPattern }
  /** one transition's effects read a nouns field and a field named by `with` */
  | { kind: 'feeds'; with: EvalPattern }
  /** a transition that notifies reads a nouns field in its guard or effects */
  | { kind: 'notifies' }
  /** an external input whose event key or payload field is named by the nouns */
  | { kind: 'input' }
  /** an in-app agent (std-agent-tool-loop) runs in the program */
  | { kind: 'agent' }
  /** a page is declared at `path` */
  | { kind: 'route'; path: string }
  /** text named by the nouns is visible on `route`, else on every route of the entity named by `on` (default: the nouns) */
  | { kind: 'rendered'; route?: string; on?: EvalPattern }
  /** visible text on every concrete route must not show these words */
  | { kind: 'absentText'; words: string[] }
  /** no persistent entity is named by the nouns */
  | { kind: 'absentEntity' }
  /** an orbital named by the nouns is declared; with `absent`, none is */
  | { kind: 'orbital'; absent?: boolean }
  /** a trait named by the nouns sets config `key` to `value` */
  | { kind: 'knob'; key: string; value: JsonValue };

export interface EvalCheck {
  id: string;
  /** the turn (0-based) from which this check must hold, and keep holding */
  introducedTurn: number;
  /** the request's own words for the thing it asks for */
  nouns: EvalPattern;
  require: EvalPredicate[];
  /** routes framed for the rubric; default: every route a predicate bound */
  frameRoutes?: string[];
  coversDeclines?: string[];
}

export const EVAL_TIERS = ['none', 'organism', 'subset', 'compose', 'substrate', 'free'] as const;
export type EvalTier = (typeof EVAL_TIERS)[number];

export interface EvalExpectations {
  /** the build must take one of these tiers */
  tiers?: EvalTier[];
  /** behaviors (exact ids) the build must adopt */
  adopts?: string[];
  /** orbitals (exact names) the built program must declare */
  orbitals?: string[];
  /** the built program passes `orb validate --final` */
  validates?: boolean;
}

export type EvalClass = 'plain' | 'specific' | 'complex';

export interface EvalSpec {
  id: string;
  class: EvalClass;
  description?: string;
  turns: [string, ...string[]];
  checks: EvalCheck[];
  expect?: EvalExpectations;
  /** behaviors (exact ids) the build must not adopt */
  forbidSources?: string[];
}

function validPattern(p: { pattern: string; flags?: string }): boolean {
  try {
    new RegExp(p.pattern, p.flags);
    return true;
  } catch {
    return false;
  }
}

const EvalPatternSchema: z.ZodType<EvalPattern> = z
  .object({ pattern: z.string(), flags: z.string().optional() })
  .strict()
  .refine(validPattern, { message: 'pattern is not a valid regular expression' });

const EvalPredicateSchema: z.ZodType<EvalPredicate> = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('entity') }).strict(),
  z.object({ kind: z.literal('field'), required: z.boolean().optional() }).strict(),
  z.object({ kind: z.literal('enumValue'), value: EvalPatternSchema }).strict(),
  z.object({ kind: z.literal('roleGated') }).strict(),
  z.object({ kind: z.literal('ownerScoped'), by: EvalPatternSchema.optional() }).strict(),
  z.object({ kind: z.literal('feeds'), with: EvalPatternSchema }).strict(),
  z.object({ kind: z.literal('notifies') }).strict(),
  z.object({ kind: z.literal('input') }).strict(),
  z.object({ kind: z.literal('agent') }).strict(),
  z.object({ kind: z.literal('route'), path: z.string() }).strict(),
  z.object({ kind: z.literal('rendered'), route: z.string().optional(), on: EvalPatternSchema.optional() }).strict(),
  z.object({ kind: z.literal('absentText'), words: z.array(z.string()) }).strict(),
  z.object({ kind: z.literal('absentEntity') }).strict(),
  z.object({ kind: z.literal('orbital'), absent: z.boolean().optional() }).strict(),
  z.object({ kind: z.literal('knob'), key: z.string().min(1), value: JsonValueSchema }).strict(),
]);

const EvalCheckSchema: z.ZodType<EvalCheck> = z
  .object({
    id: z.string().min(1),
    introducedTurn: z.number().int().min(0),
    nouns: EvalPatternSchema,
    require: z.array(EvalPredicateSchema),
    frameRoutes: z.array(z.string()).optional(),
    coversDeclines: z.array(z.string()).optional(),
  })
  .strict();

export const EvalSpecSchema: z.ZodType<EvalSpec> = z
  .object({
    id: z.string().min(1),
    class: z.enum(['plain', 'specific', 'complex']),
    description: z.string().optional(),
    turns: z.tuple([z.string()]).rest(z.string()),
    checks: z.array(EvalCheckSchema),
    expect: z
      .object({
        tiers: z.array(z.enum(EVAL_TIERS)).optional(),
        adopts: z.array(z.string()).optional(),
        orbitals: z.array(z.string()).optional(),
        validates: z.boolean().optional(),
      })
      .strict()
      .optional(),
    forbidSources: z.array(z.string()).optional(),
  })
  .strict()
  .superRefine((spec, ctx) => {
    for (const [i, check] of spec.checks.entries()) {
      if (check.introducedTurn >= spec.turns.length) {
        ctx.addIssue({ code: 'custom', path: ['checks', i, 'introducedTurn'], message: `introducedTurn ${check.introducedTurn} is past the spec's ${spec.turns.length} turns` });
      }
    }
  });

/** Parse an eval spec, throwing with every issue (path + message) when it does not conform. */
export function parseEvalSpec(input: JsonValue): EvalSpec {
  const parsed = EvalSpecSchema.safeParse(input);
  if (parsed.success) return parsed.data;
  throw new Error(`invalid eval spec: ${parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')}`);
}

export function evalPatternMatches(p: EvalPattern, text: string): boolean {
  return new RegExp(p.pattern, p.flags).test(text);
}

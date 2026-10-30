/**
 * The declared contract a program carries for the outside: the inputs a client may send a trait, the inbound
 * hooks a provider may deliver to, and the answers the kernel gives. The kernel owns the rules
 * (`orbital-core` `contract/external_inputs.rs`, `contract/inbound.rs`; `KernelEngine.contract*` asks them): these are
 * the shapes of its answers, parsed at the boundary.
 *
 * @packageDocumentation
 */

import { z } from 'zod';
import type { JsonSchema } from '../factory/types.js';
import { InboundVerificationSchema, PayloadFieldSchema } from '../types/state-machine.js';

export type { InboundDeclaration, InboundVerification } from '../types/state-machine.js';

export const ExternalInputSchema = z.object({
  orbital: z.string(),
  trait: z.string(),
  event: z.string(),
  payloadSchema: z.array(PayloadFieldSchema),
  description: z.string().optional(),
  synonyms: z.string().optional(),
  tier: z.string().optional(),
});

/** A declared input: what an outside client may send which trait. */
export type ExternalInput = z.infer<typeof ExternalInputSchema>;

/** One declared handler: the trait and event a hook name is delivered to, and the event that answers. */
export const InboundRouteSchema = z.object({
  name: z.string(),
  orbital: z.string(),
  trait: z.string(),
  event: z.string(),
  answer: z.string(),
  verifies: InboundVerificationSchema.optional(),
});

export type InboundRoute = z.infer<typeof InboundRouteSchema>;

/** What a host carries of one request: its headers and its body text exactly as received. */
export interface InboundDelivery {
  headers: Readonly<Record<string, string | undefined>>;
  rawBody: string;
}

/** The HTTP answer the host writes: the status and the JSON text of the body. */
export const InboundAnswerSchema = z.object({
  status: z.number(),
  body: z.string(),
  stderr: z.string().optional(),
  /** Response headers the answer declares; a terminal host reads `orb-run`. */
  headers: z.record(z.string(), z.string()).optional(),
});

export type InboundAnswer = z.infer<typeof InboundAnswerSchema>;

/** The kernel's answer to "which handler does this hook name": the route, or the answer to write for a hook it does not serve. */
export const InboundFoundSchema = z.union([z.object({ route: InboundRouteSchema }), z.object({ answer: InboundAnswerSchema })]);

/** An inbound hook event named on a client-facing route: the trait that handles it and the refusal message. */
export const InboundOnlySchema = z.object({ trait: z.string(), message: z.string() }).nullable();

/** A list of names (the readable entities). */
export const NameListSchema = z.array(z.string());

/** A name, or null when the program has none (the `[identity]` entity, the owner of an entity). */
export const OptionalNameSchema = z.string().nullable();

/** One way a value misses its declared payload (the kernel's `payloadIssues`). */
export const PayloadIssueSchema = z.object({
  path: z.string(),
  reason: z.enum(['missing', 'unknown', 'wrong-type', 'not-one-of']),
  expected: z.string().optional(),
});

export type PayloadIssue = z.infer<typeof PayloadIssueSchema>;

/** The JSON Schema of a declared payload (the kernel's `payloadSchemaToJsonSchema`). */
export const PayloadJsonSchemaSchema: z.ZodType<JsonSchema> = z.lazy(() =>
  z.strictObject({
    type: z.enum(['string', 'number', 'integer', 'boolean', 'array', 'object']).optional(),
    properties: z.record(z.string(), PayloadJsonSchemaSchema).optional(),
    required: z.array(z.string()).optional(),
    additionalProperties: z.boolean().optional(),
    items: PayloadJsonSchemaSchema.optional(),
    enum: z.array(z.string()).optional(),
  }),
);

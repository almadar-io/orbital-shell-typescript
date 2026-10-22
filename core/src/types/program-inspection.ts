import { z } from 'zod';
import { JsonValueSchema } from './json.js';
import { OrbitalSchemaSchema } from './schema.js';
import { SourceDeclarationMetadataSchema } from './trait.js';

// Positions are 1-based Unicode scalars with an exclusive end; length counts original UTF-8 bytes.
export const ProgramSourceLocationSchema = z.object({
    path: z.string(),
    line: z.number().int().positive(),
    column: z.number().int().positive(),
    length: z.number().int().nonnegative(),
    endLine: z.number().int().positive(),
    endColumn: z.number().int().positive(),
    exact: z.boolean(),
    scopeEndLine: z.number().int().positive().optional(),
    scopeEndColumn: z.number().int().positive().optional(),
    scopeLength: z.number().int().nonnegative().optional(),
});

export const ProgramSourceAnchorSchema = ProgramSourceLocationSchema.extend({
    pointer: z.string(),
    orbitalId: z.string().nullable(),
    traitId: z.string().nullable(),
    originTraitId: z.string(),
});

export const ProgramInspectionSchema = z.object({
    program: OrbitalSchemaSchema,
    authoredProgram: OrbitalSchemaSchema,
    definitions: z.array(z.object({
        traitId: z.string(),
        definitionFingerprint: z.string(),
        sourceDeclaration: SourceDeclarationMetadataSchema.extend({ path: z.string().nullable() }).nullable(),
        sourceCandidates: z.array(z.string()),
    })),
    composition: z.array(z.object({ traitId: z.string(), kind: z.enum(['trait-declaration', 'orbital-reference']), authoredPointer: z.string(), traitOverrideKey: z.string().nullable(), binding: JsonValueSchema, source: ProgramSourceLocationSchema.nullable() })),
    sourceMap: z.array(ProgramSourceAnchorSchema),
    imports: z.array(z.object({ path: z.string(), specifier: z.string(), program: z.string(), authoredProgram: OrbitalSchemaSchema })),
    lazy: z.array(JsonValueSchema),
    path: z.string(),
    version: z.number().int().nonnegative().nullable(),
    columnEncoding: z.literal('unicode-scalar'),
    lengthEncoding: z.literal('utf-8-bytes'),
    lineBase: z.literal(1),
    columnBase: z.literal(1),
});

export type ProgramSourceLocation = z.infer<typeof ProgramSourceLocationSchema>;
export type ProgramSourceAnchor = z.infer<typeof ProgramSourceAnchorSchema>;
export type ProgramInspection = z.infer<typeof ProgramInspectionSchema>;

import { describe, expect, it } from 'vitest';
import { EntityFieldSchema, FIELD_TYPES, FieldTypeSchema } from '../src/types/field';
import { inferTsType } from '../src/types/ir';

describe('node field type', () => {
    it('is a member of the FieldType vocabulary', () => {
        expect(FIELD_TYPES).toContain('node');
        expect(FieldTypeSchema.safeParse('node').success).toBe(true);
    });

    it('parses through EntityFieldSchema (the .orb zod gate)', () => {
        const parsed = EntityFieldSchema.safeParse({ name: 'view', type: 'node' });
        expect(parsed.success).toBe(true);
        if (parsed.success) {
            expect(parsed.data.type).toBe('node');
        }
    });

    it('parses as an array item type ([node] fields)', () => {
        const parsed = EntityFieldSchema.safeParse({
            name: 'view',
            type: 'array',
            items: { type: 'node' },
        });
        expect(parsed.success).toBe(true);
    });

    it('infers the canonical PatternNode TS type', () => {
        expect(inferTsType('node')).toBe('PatternNode | PatternNode[]');
    });
});

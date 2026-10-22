import { describe, expect, it } from 'vitest';

import { EntitySchema } from '../src/types/entity.js';

/**
 * `z.object()` STRIPS unknown keys rather than rejecting them, so a field that
 * exists only on the Rust side (`EntityDefinition.identity`,
 * orbital-core/src/schema/types.rs) would work on the compiled path and
 * silently vanish on the interpreter path. These tests are the guard for that
 * class — the same hazard already documented for `schemaVersion`/`ledger`.
 */
describe('the [identity] entity tag survives the zod parse', () => {
    const person = {
        name: 'Person',
        fields: [{ name: 'id', type: 'string', required: true }],
    };

    it('preserves identity: true', () => {
        const parsed = EntitySchema.parse({ ...person, identity: true });
        expect(parsed.identity).toBe(true);
    });

    it('leaves identity absent when not declared (no key invented)', () => {
        const parsed = EntitySchema.parse(person);
        expect('identity' in parsed).toBe(false);
    });

    it('keeps identity orthogonal to shared and to persistence', () => {
        const directory = EntitySchema.parse({
            ...person,
            persistence: 'persistent',
            collection: 'people',
            identity: true,
        });
        expect(directory.identity).toBe(true);
        expect(directory.shared).toBeUndefined();

        const viewer = EntitySchema.parse({ ...person, persistence: 'runtime', identity: true });
        expect(viewer.identity).toBe(true);
        expect(viewer.persistence).toBe('runtime');

        const both = EntitySchema.parse({ ...person, identity: true, shared: true });
        expect(both.identity).toBe(true);
        expect(both.shared).toBe(true);
    });
});

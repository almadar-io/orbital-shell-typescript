import { describe, expect, it } from 'vitest';

import { mergeEntityFrame, omitFrameFields, resolveEntityView } from '../src/shared-entity/merge.js';
import type { EntityFieldWrite, EntityFrameState } from '../src/shared-entity/merge.js';

describe('mergeEntityFrame', () => {
    it('preserves fields untouched by the writes (field-level, not whole-object replace)', () => {
        const current: EntityFrameState = { x: 1 };

        const next = mergeEntityFrame(current, [
            { field: 'y', value: 2 },
            { field: 'fx', value: 0.5 },
        ]);

        expect(next).toEqual({ x: 1, y: 2, fx: 0.5 });
    });

    it('lets a later write to the same field win over an earlier one', () => {
        const next = mergeEntityFrame({}, [
            { field: 'x', value: 1 },
            { field: 'x', value: 2 },
        ]);

        expect(next.x).toBe(2);
    });

    it('returns the same reference when there are no writes', () => {
        const current: EntityFrameState = { x: 1 };

        expect(mergeEntityFrame(current, [])).toBe(current);
    });
});

describe('resolveEntityView', () => {
    it('lets the row win over the frame for a shared key', () => {
        const view = resolveEntityView({
            frame: { name: 'from-frame' },
            row: { name: 'from-row' },
            allowedFrameKeys: ['name'],
        });

        expect(view.name).toBe('from-row');
    });

    it('never honours an id from the frame, even when id is allow-listed', () => {
        const view = resolveEntityView({
            frame: { id: 'frame-id', name: 'Ada' },
            row: { name: 'Ada' },
            allowedFrameKeys: ['id', 'name'],
        });

        expect(view.id).toBeUndefined();
    });

    it('drops frame keys outside the allow-list', () => {
        const view = resolveEntityView({
            frame: { allowed: 'yes', secret: 'no' },
            row: {},
            allowedFrameKeys: ['allowed'],
        });

        expect(view).toEqual({ allowed: 'yes' });
    });

    it('resolves to the allowed frame subset when the row is empty', () => {
        const view = resolveEntityView({
            frame: { draftTitle: 'Untitled', otherField: 'x' },
            row: {},
            allowedFrameKeys: ['draftTitle'],
        });

        expect(view).toEqual({ draftTitle: 'Untitled' });
    });

    it('lets the id argument win over the row id', () => {
        const view = resolveEntityView({
            row: { id: 'row-id', name: 'Ada' },
            id: 'explicit-id',
            allowedFrameKeys: [],
        });

        expect(view).toEqual({ id: 'explicit-id', name: 'Ada' });
    });
});

describe('omitFrameFields', () => {
    it('removes exactly the listed keys without mutating the input', () => {
        const row: EntityFrameState = { id: 'r1', name: 'Ada', draftTitle: 'x', otherField: 'y' };

        const result = omitFrameFields(row, ['draftTitle', 'otherField']);

        expect(result).toEqual({ id: 'r1', name: 'Ada' });
        expect(row).toEqual({ id: 'r1', name: 'Ada', draftTitle: 'x', otherField: 'y' });
    });
});

/**
 * A write carries the frame's own value type (`EntityRow`'s `FieldValue | undefined`):
 * a compiled `[shared]` tick writer copies a frame read straight back
 * (`value: lost ? lives - 1 : scratch.lives`), and `scratch.lives` may be absent.
 * Pinned at the type level (core's typecheck covers this file) and at runtime.
 */
describe('EntityFieldWrite value type', () => {
  it('accepts a value read back from the frame, absent included', () => {
    const frame: EntityFrameState = { lives: 3 };
    const writes: EntityFieldWrite[] = [{ field: 'lives', value: frame.score }, { field: 'score', value: 1 }];
    const next = mergeEntityFrame(frame, writes);
    expect(next.lives).toBeUndefined();
    expect(next.score).toBe(1);
  });
});

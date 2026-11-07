import { describe, it, expect } from 'vitest';
import { callHeadAt, hoverFor, parseSignatures } from './hover.js';

const SIGNATURES = parseSignatures(JSON.stringify({
    operators: {
        'array/groupBy': {
            description: 'Group elements by a field',
            minArity: 2,
            maxArity: 2,
            params: [
                { name: 'arr', description: 'The array', type: { kind: 'array', of: { kind: 'var', name: 'T' } } },
                { name: 'key', type: { kind: 'union', of: [{ kind: 'keyOf', of: 'T', value: 'string' }, { kind: 'fn', params: [{ kind: 'var', name: 'T' }], returns: 'string' }] } },
            ],
            returnType: { kind: 'object' },
            examples: ['(array/groupBy xs "k")'],
        },
    },
}));

describe('G-SYNTAX-003 hover on an operator head', () => {
    const text = '(set @entity.x (array/groupBy xs "k"))';

    it('describes the operator the cursor is on', () => {
        const offset = text.indexOf('groupBy') + 2;
        const hover = hoverFor(SIGNATURES, text, offset, { line: 0, character: offset });
        expect(hover?.contents).toMatchObject({ kind: 'markdown' });
        const value = typeof hover?.contents === 'object' && 'value' in hover.contents ? hover.contents.value : '';
        expect(value).toContain('**array/groupBy** (2 args)');
        expect(value).toContain('`arr`: T[] — The array');
        expect(value).toContain('`key`: keyOf T | (fn T -> string)');
        expect(hover?.range).toEqual({ start: { line: 0, character: text.indexOf('array/groupBy') }, end: { line: 0, character: text.indexOf('array/groupBy') + 'array/groupBy'.length } });
    });

    it('control: an argument that happens to be a name is not a call head', () => {
        const offset = text.indexOf('xs') + 1;
        expect(callHeadAt(text, offset)).toBeUndefined();
        expect(hoverFor(SIGNATURES, text, offset, { line: 0, character: offset })).toBeUndefined();
    });

    it('control: a head naming no operator shows nothing', () => {
        const offset = 3;
        expect(hoverFor(SIGNATURES, text, offset, { line: 0, character: offset })).toBeUndefined();
    });

    it('a signatures answer without operators is refused', () => {
        expect(() => parseSignatures('{"codes":[]}')).toThrow();
    });
});

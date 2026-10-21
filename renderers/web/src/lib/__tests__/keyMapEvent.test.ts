import { describe, it, expect } from 'vitest';
import { isEditableTarget, keyMapCode, resolveKeyMapEvent } from '../keyMapEvent';

function keyEvent(init: KeyboardEventInit & { code: string }, target: EventTarget | null = null): KeyboardEvent {
    const e = new KeyboardEvent('keydown', init);
    Object.defineProperty(e, 'target', { value: target, configurable: true });
    return e;
}

describe('isEditableTarget', () => {
    it('is true for an input', () => {
        expect(isEditableTarget(document.createElement('input'))).toBe(true);
    });

    it('is true for a textarea', () => {
        expect(isEditableTarget(document.createElement('textarea'))).toBe(true);
    });

    it('is true for a select', () => {
        expect(isEditableTarget(document.createElement('select'))).toBe(true);
    });

    it('is true for a contenteditable element', () => {
        const div = document.createElement('div');
        div.contentEditable = 'true';
        document.body.appendChild(div);
        expect(isEditableTarget(div)).toBe(true);
        document.body.removeChild(div);
    });

    it('is true for the contenteditable attribute, and false when it is "false"', () => {
        const div = document.createElement('div');
        div.setAttribute('contenteditable', 'true');
        expect(isEditableTarget(div)).toBe(true);
        div.setAttribute('contenteditable', '');
        expect(isEditableTarget(div)).toBe(true);
        div.setAttribute('contenteditable', 'false');
        expect(isEditableTarget(div)).toBe(false);
    });

    it('is false for a plain element', () => {
        expect(isEditableTarget(document.createElement('canvas'))).toBe(false);
    });

    it('is false for null', () => {
        expect(isEditableTarget(null)).toBe(false);
    });
});

describe('keyMapCode', () => {
    it('is the bare code with no modifiers', () => {
        expect(keyMapCode(keyEvent({ code: 'KeyZ' }))).toBe('KeyZ');
    });

    it('prefixes Mod+ for metaKey', () => {
        expect(keyMapCode(keyEvent({ code: 'KeyZ', metaKey: true }))).toBe('Mod+KeyZ');
    });

    it('prefixes Mod+ for ctrlKey', () => {
        expect(keyMapCode(keyEvent({ code: 'KeyZ', ctrlKey: true }))).toBe('Mod+KeyZ');
    });

    it('orders Mod+ before Shift+ before Alt+', () => {
        expect(keyMapCode(keyEvent({ code: 'KeyZ', metaKey: true, shiftKey: true, altKey: true }))).toBe('Mod+Shift+Alt+KeyZ');
    });
});

describe('resolveKeyMapEvent', () => {
    it('returns undefined with no map', () => {
        expect(resolveKeyMapEvent(undefined, keyEvent({ code: 'KeyZ' }))).toBeUndefined();
    });

    it('returns undefined when the target is editable', () => {
        const input = document.createElement('input');
        expect(resolveKeyMapEvent({ KeyZ: 'UNDO' }, keyEvent({ code: 'KeyZ' }, input))).toBeUndefined();
    });

    it('resolves a Mod+ entry under metaKey', () => {
        expect(resolveKeyMapEvent({ 'Mod+KeyZ': 'UNDO' }, keyEvent({ code: 'KeyZ', metaKey: true }))).toBe('UNDO');
    });

    it('resolves a Mod+ entry under ctrlKey', () => {
        expect(resolveKeyMapEvent({ 'Mod+KeyZ': 'UNDO' }, keyEvent({ code: 'KeyZ', ctrlKey: true }))).toBe('UNDO');
    });

    it('resolves the canonical Mod+Shift+ order', () => {
        expect(resolveKeyMapEvent({ 'Mod+Shift+KeyZ': 'REDO' }, keyEvent({ code: 'KeyZ', metaKey: true, shiftKey: true }))).toBe('REDO');
    });

    it('a bare entry still fires under an undeclared modifier', () => {
        expect(resolveKeyMapEvent({ KeyZ: 'OTHER' }, keyEvent({ code: 'KeyZ', shiftKey: true }))).toBe('OTHER');
    });

    it('a prefixed entry wins over a bare entry for the same key', () => {
        const map = { 'Mod+KeyZ': 'UNDO', KeyZ: 'OTHER' };
        expect(resolveKeyMapEvent(map, keyEvent({ code: 'KeyZ', metaKey: true }))).toBe('UNDO');
        expect(resolveKeyMapEvent(map, keyEvent({ code: 'KeyZ' }))).toBe('OTHER');
    });

    it('returns undefined when nothing matches', () => {
        expect(resolveKeyMapEvent({ KeyA: 'MOVE' }, keyEvent({ code: 'KeyZ' }))).toBeUndefined();
    });
});

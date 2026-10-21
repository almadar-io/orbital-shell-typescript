import type { EventKey } from '@almadar/core';

export type KeyMap = Record<string, EventKey>;

export function isEditableTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false;
    const tag = target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (target.isContentEditable || target.contentEditable === 'true') return true;
    // jsdom implements neither getter, so the attribute is checked too.
    const attr = target.getAttribute('contenteditable');
    return attr === '' || attr === 'true' || attr === 'plaintext-only';
}

export function keyMapCode(e: KeyboardEvent): string {
    let code = e.code;
    if (e.altKey) code = `Alt+${code}`;
    if (e.shiftKey) code = `Shift+${code}`;
    if (e.metaKey || e.ctrlKey) code = `Mod+${code}`;
    return code;
}

/** A modified entry (`Mod+`/`Shift+`/`Alt+` prefixed) wins over the bare code; a bare
 *  entry still fires under modifiers it never declared (existing boards keep their
 *  bindings); keystrokes in editable elements never route. */
export function resolveKeyMapEvent(map: KeyMap | undefined, e: KeyboardEvent): EventKey | undefined {
    if (!map || isEditableTarget(e.target)) return undefined;
    return map[keyMapCode(e)] ?? map[e.code];
}

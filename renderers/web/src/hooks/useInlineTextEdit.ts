/**
 * Inline text editing: double-click text a component marked as one of its
 * text props (`data-inline-text`) to edit it in place — Enter or click-away
 * saves it as a local `UI:PROP_CHANGE` on that prop of that element, Esc
 * cancels. The element's address comes from the rendered DOM
 * (`deriveEditFocusFromElement`), so the same editor serves canvas cards and
 * a running live preview. Only literal text is editable: a value bound to
 * data (`@entity.x`, an expression) is left alone, with a notice.
 */
import { useCallback, useContext } from 'react';
import type { OrbitalSchema } from '@almadar/core';
import { useEventBus } from '../core';
import { useTranslate } from '../core';
import { INLINE_TEXT_ATTR } from '../core';
import { deriveEditFocusFromElement, withNodeTransition } from '../lib/derive-edit-focus';
import { resolvePatternConfig } from '../lib/resolve-pattern-config';
import { ElementEditAccessContext, propAccessAt } from '../lib/element-edit-access';

export interface InlineTextEditOptions {
  /** The schema being rendered — the literal-or-bound check reads the prop from it. */
  schema: OrbitalSchema | null | undefined;
  enabled: boolean;
  /** The card's own trait + transition, when the host knows them better than the DOM (a canvas card). */
  node?: { traitName?: string; transitionEvent?: string };
}

/** A `onDoubleClickCapture` handler for the element that contains the rendered content. */
export function useInlineTextEdit({ schema, enabled, node }: InlineTextEditOptions): (e: React.MouseEvent) => void {
  const { emit } = useEventBus();
  const { t } = useTranslate();
  const access = useContext(ElementEditAccessContext);
  const nodeTrait = node?.traitName;
  const nodeTransition = node?.transitionEvent;

  return useCallback((e: React.MouseEvent) => {
    if (!enabled || !schema || !(e.target instanceof Element)) return;
    const text = e.target.closest(`[${INLINE_TEXT_ATTR}]`);
    const propName = text?.getAttribute(INLINE_TEXT_ATTR);
    const patternEl = text?.closest('[data-pattern-path],[data-orb-path]');
    if (!(text instanceof HTMLElement) || !propName || !(patternEl instanceof HTMLElement)) return;
    const derived = deriveEditFocusFromElement(patternEl);
    const focus = derived ? withNodeTransition(derived, { traitName: nodeTrait, transitionEvent: nodeTransition }) : null;
    if (!focus?.trait || !focus.transition || !focus.path) return;

    e.preventDefault();
    e.stopPropagation();
    const allowed = propAccessAt(access, focus, propName);
    if (!allowed.editable) {
      const message = allowed.reason === 'fixed'
        ? t('inlineText.fixedValue', { behavior: allowed.detail })
        : allowed.reason === 'loading' ? t('inlineText.loading') : t('inlineText.boundValue');
      emit('UI:NOTIFY', { severity: 'info', message });
      return;
    }
    const node = resolvePatternConfig(schema, {
      orbitalName: focus.orbital,
      traitName: focus.trait,
      transitionEvent: focus.transition,
      patternId: focus.path,
    });
    const current = node?.[propName];
    if (typeof current !== 'string' || current.startsWith('@')) {
      emit('UI:NOTIFY', { severity: 'info', message: t('inlineText.boundValue') });
      return;
    }

    const original = text.textContent ?? '';
    const selection = { patternPath: focus.path, orbitalName: focus.orbital, traitName: focus.trait, transitionEvent: focus.transition, ...(focus.slot ? { slot: focus.slot } : {}) };
    let done = false;
    const finish = (save: boolean) => {
      if (done) return;
      done = true;
      text.removeEventListener('keydown', onKey);
      text.removeEventListener('blur', onBlur);
      text.removeAttribute('contenteditable');
      const value = text.textContent ?? '';
      if (!save) text.textContent = original;
      else if (value !== original) emit('UI:PROP_CHANGE', { scope: 'local', propName, value, selection });
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Enter' && !ev.shiftKey) {
        ev.preventDefault();
        finish(true);
      } else if (ev.key === 'Escape') {
        ev.preventDefault();
        finish(false);
      }
      ev.stopPropagation();
    };
    const onBlur = () => finish(true);

    text.setAttribute('contenteditable', 'true');
    text.addEventListener('keydown', onKey);
    text.addEventListener('blur', onBlur);
    text.focus();
    const range = document.createRange();
    range.selectNodeContents(text);
    const selected = window.getSelection();
    selected?.removeAllRanges();
    selected?.addRange(range);
  }, [enabled, schema, access, nodeTrait, nodeTransition, emit, t]);
}

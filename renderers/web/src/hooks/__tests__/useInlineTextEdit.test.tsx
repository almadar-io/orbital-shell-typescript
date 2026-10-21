/**
 * Double-click a component's text (`data-inline-text`) to edit it in place;
 * Enter or click-away saves it as a local PROP_CHANGE on that prop, Esc
 * cancels. Only literal text is editable — a bound value comes from data.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { OrbitalSchema } from '@almadar/core';
import { EventBusProvider } from '../../core';
import { useEventBus } from '../../core';
import { useInlineTextEdit } from '../useInlineTextEdit';
import { Typography } from '../../core';
import { ElementEditAccessContext, EDITABLE, type ElementEditAccessResolver } from '../../lib/element-edit-access';

function schema(content: string): OrbitalSchema {
  return JSON.parse(JSON.stringify({
    name: 'App',
    orbitals: [{
      name: 'Widgets',
      entity: { name: 'Widget', fields: [] },
      traits: [{
        name: 'WidgetInteraction',
        stateMachine: {
          states: [{ name: 'Browsing', isInitial: true }],
          events: [{ key: 'INIT', name: 'INIT' }],
          transitions: [{ from: 'Browsing', to: 'Browsing', event: 'INIT', effects: [['render-ui', 'main', { type: 'stack', children: [{ type: 'typography', content }] }]] }],
        },
      }],
      pages: [],
    }],
  }));
}

function Spy({ event, onEvent }: { event: string; onEvent: (payload: unknown) => void }): null {
  const { on } = useEventBus();
  React.useEffect(() => on(event, (e) => onEvent(e.payload)), [on, event, onEvent]);
  return null;
}

function Harness({ content, enabled = true }: { content: string; enabled?: boolean }) {
  const onDoubleClick = useInlineTextEdit({ schema: schema(content), enabled });
  return (
    <div onDoubleClickCapture={onDoubleClick} data-orb-orbital="Widgets" data-orb-trait="WidgetInteraction" data-orb-transition="INIT" data-orb-slot="main" data-orb-path="root">
      <div data-pattern-path="root.children.0" data-pattern="typography">
        <Typography content={content.startsWith('@') ? 'Rendered from data' : content} />
      </div>
      <button type="button">elsewhere</button>
    </div>
  );
}

function mount(content: string, enabled?: boolean, access: ElementEditAccessResolver | null = null) {
  const changed = vi.fn();
  const notified = vi.fn();
  render(
    <EventBusProvider debug={false}>
      <ElementEditAccessContext.Provider value={access}>
        <Spy event="UI:PROP_CHANGE" onEvent={changed} />
        <Spy event="UI:NOTIFY" onEvent={notified} />
        <Harness content={content} enabled={enabled} />
      </ElementEditAccessContext.Provider>
    </EventBusProvider>,
  );
  return { changed, notified };
}

describe('useInlineTextEdit', () => {
  it('double-click makes the text editable in place', () => {
    mount('Hello');
    const text = screen.getByText('Hello');
    fireEvent.doubleClick(text);
    expect(text.getAttribute('contenteditable')).toBe('true');
    expect(document.activeElement).toBe(text);
  });

  it('Enter saves the new text as a local change to that prop', () => {
    const { changed } = mount('Hello');
    const text = screen.getByText('Hello');
    fireEvent.doubleClick(text);
    text.textContent = 'Hi there';
    fireEvent.keyDown(text, { key: 'Enter' });
    expect(changed).toHaveBeenCalledWith({
      scope: 'local',
      propName: 'content',
      value: 'Hi there',
      selection: { patternPath: 'root.children.0', orbitalName: 'Widgets', traitName: 'WidgetInteraction', transitionEvent: 'INIT', slot: 'main' },
    });
    expect(text.getAttribute('contenteditable')).toBeNull();
  });

  it('Esc cancels and restores the text', () => {
    const { changed } = mount('Hello');
    const text = screen.getByText('Hello');
    fireEvent.doubleClick(text);
    text.textContent = 'oops';
    fireEvent.keyDown(text, { key: 'Escape' });
    expect(text.textContent).toBe('Hello');
    expect(changed).not.toHaveBeenCalled();
  });

  it('clicking away saves', () => {
    const { changed } = mount('Hello');
    const text = screen.getByText('Hello');
    fireEvent.doubleClick(text);
    text.textContent = 'Changed';
    fireEvent.blur(text);
    expect(changed).toHaveBeenCalledWith(expect.objectContaining({ propName: 'content', value: 'Changed' }));
  });

  it('unchanged text saves nothing', () => {
    const { changed } = mount('Hello');
    const text = screen.getByText('Hello');
    fireEvent.doubleClick(text);
    fireEvent.keyDown(text, { key: 'Enter' });
    expect(changed).not.toHaveBeenCalled();
  });

  it('a value bound to data is not edited; the user is told why', () => {
    const { changed, notified } = mount('@entity.title');
    const text = screen.getByText('Rendered from data');
    fireEvent.doubleClick(text);
    expect(text.getAttribute('contenteditable')).toBeNull();
    expect(notified).toHaveBeenCalled();
    expect(changed).not.toHaveBeenCalled();
  });

  it('turned off, double-click does nothing', () => {
    mount('Hello', false);
    const text = screen.getByText('Hello');
    fireEvent.doubleClick(text);
    expect(text.getAttribute('contenteditable')).toBeNull();
  });

  it('text a behavior fixes is not edited; the user is told which behavior sets it', () => {
    const fixed: ElementEditAccessResolver = () => ({ prop: () => ({ editable: false, reason: 'fixed', detail: 'std-browse' }), partOf: 'std-browse' });
    const { changed, notified } = mount('Hello', true, fixed);
    const text = screen.getByText('Hello');
    fireEvent.doubleClick(text);
    expect(text.getAttribute('contenteditable')).toBeNull();
    expect(notified).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('std-browse') }));
    expect(changed).not.toHaveBeenCalled();
  });

  it('the host is asked about the prop at the element that was clicked', () => {
    const asked: Array<[string | undefined, string | undefined, string]> = [];
    const access: ElementEditAccessResolver = (focus) => ({ prop: (name) => { asked.push([focus.trait, focus.slot, name]); return EDITABLE; } });
    mount('Hello', true, access);
    fireEvent.doubleClick(screen.getByText('Hello'));
    expect(asked).toEqual([['WidgetInteraction', 'main', 'content']]);
  });
});

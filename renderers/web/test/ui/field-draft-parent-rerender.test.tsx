// @vitest-environment jsdom
/**
 * A declarative field inside a render tree keeps what the viewer types when
 * its slot re-renders without a new paint (any circuit commit re-renders the
 * tree); only a new paint of the tree puts the painted value back (G-CROSS-699).
 */
import React from 'react';
import { afterEach, describe, it, expect } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { SlotContentRenderer } from '../../src/components/core/organisms/UISlotRenderer';
import { EventBusProvider } from '../../src/core';

afterEach(cleanup);

type Content = React.ComponentProps<typeof SlotContentRenderer>['content'];

function dialog(): Content {
  return {
    id: 'modal-id',
    pattern: 'stack',
    props: {
      direction: 'vertical',
      children: [{ type: 'input', onChange: 'SET_NAME', label: 'Template name', value: '' }],
    },
    priority: 0,
  };
}

function Harness({ content, tick }: { content: Content; tick: number }) {
  return (
    <EventBusProvider>
      <span data-tick={tick} />
      <SlotContentRenderer content={content} onDismiss={() => {}} />
    </EventBusProvider>
  );
}

describe('a field keeps its typed text across a re-render that is not a new paint', () => {
  it('typing survives re-renders of the same painted tree', () => {
    const content = dialog();
    const view = render(<Harness content={content} tick={0} />);
    fireEvent.change(screen.getByLabelText('Template name'), { target: { value: 'W' } });
    view.rerender(<Harness content={content} tick={1} />);
    fireEvent.change(screen.getByLabelText('Template name'), { target: { value: 'We' } });
    view.rerender(<Harness content={content} tick={2} />);
    expect((screen.getByLabelText('Template name') as HTMLInputElement).value).toBe('We');
  });

  it('control: a new paint of the tree puts the painted value back', () => {
    const view = render(<Harness content={dialog()} tick={0} />);
    fireEvent.change(screen.getByLabelText('Template name'), { target: { value: 'W' } });
    view.rerender(<Harness content={dialog()} tick={1} />);
    expect((screen.getByLabelText('Template name') as HTMLInputElement).value).toBe('');
  });
});

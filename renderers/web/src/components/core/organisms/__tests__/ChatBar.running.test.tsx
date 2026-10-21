// @vitest-environment jsdom
/**
 * A follow-up agent turn can run for minutes; while it runs the chat bar must
 * show that it's working, not just a small muted caption.
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EventBusProvider } from '../../../../core';
import { ChatBar } from '../ChatBar';

function mount(props: React.ComponentProps<typeof ChatBar>) {
  return render(
    <EventBusProvider debug={false}>
      <ChatBar {...props} />
    </EventBusProvider>,
  );
}

describe('ChatBar — running state', () => {
  it('while running, shows a working indicator beside the gate', () => {
    mount({ status: 'running', activeGate: 'Building Tasks' });
    expect(screen.getByTestId('chat-bar-running')).toBeTruthy();
    expect(screen.getByText('Building Tasks')).toBeTruthy();
  });

  it('a host can supply its own indicator', () => {
    mount({ status: 'running', activeGate: 'Building', runningIndicator: <span data-testid="brand-mark" /> });
    expect(screen.getByTestId('brand-mark')).toBeTruthy();
  });

  it('when not running there is no indicator', () => {
    mount({ status: 'complete', activeGate: 'Done' });
    expect(screen.queryByTestId('chat-bar-running')).toBeNull();
  });
});

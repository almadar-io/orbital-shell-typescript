// @vitest-environment jsdom
/**
 * A `fill` drawer (the assistant dock on phones) is the viewport tall and its
 * body owns no scroll: the message history scrolls on its own and the input
 * stays pinned below it.
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { TraceActivity } from '@almadar/core';
import { Drawer } from '../Drawer';
import { AgentChatFeed } from '../AgentChatFeed';
import { ChatBar } from '../../organisms/ChatBar';
import { EventBusProvider } from '../../../../core';

const history: TraceActivity[] = [
  { type: 'message', role: 'user', content: 'first question', timestamp: 1 },
  { type: 'message', role: 'assistant', content: 'first answer', timestamp: 2 },
];

describe('Drawer — fill', () => {
  it('is the dynamic viewport tall and its body is a bounded column, not a scroller', () => {
    render(<Drawer isOpen fill modal={false} onClose={() => undefined}><div data-testid="content" /></Drawer>);
    const panel = screen.getByRole('dialog');
    expect(panel.className).toContain('top-0');
    expect(panel.className).toContain('bottom-0');
    expect(panel.className).not.toContain('h-[100dvh]');
    const body = screen.getByTestId('content').parentElement as HTMLElement;
    expect(body.className).toContain('overflow-hidden');
    expect(body.className).toContain('min-h-0');
    expect(body.className).not.toContain('overflow-y-auto');
    expect(body.className).not.toContain('p-6');
  });

  it('chat panel: the messages live in the scroll container, the input sits outside it', () => {
    render(
      <EventBusProvider debug={false}>
        <Drawer isOpen fill modal={false} onClose={() => undefined}>
          <div className="flex min-h-0 flex-1 flex-col">
            <AgentChatFeed activities={history} emptyTitle="Ask" rawLlmPreferenceKey="k" idPrefix="chat" className="flex-1" />
            <ChatBar />
          </div>
        </Drawer>
      </EventBusProvider>,
    );
    const scroller = screen.getByTestId('chat-scroller');
    expect(scroller.className).toContain('overflow-y-auto');
    expect(scroller.className).toContain('min-h-0');
    expect(scroller.textContent).toContain('first answer');
    const input = document.querySelector('textarea') as HTMLTextAreaElement;
    expect(input).not.toBeNull();
    expect(scroller.contains(input)).toBe(false);
  });

  it('control: without fill the drawer body scrolls and pads as before', () => {
    render(<Drawer isOpen modal={false} onClose={() => undefined}><div data-testid="content" /></Drawer>);
    const body = screen.getByTestId('content').parentElement as HTMLElement;
    expect(body.className).toContain('overflow-y-auto');
    expect(screen.getByRole('dialog').className).not.toContain('h-[100dvh]');
  });
});

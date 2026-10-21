// @vitest-environment jsdom
/**
 * The in-app assistant's chat feed (Almadar_UX §3.6): bubbles by sender, each
 * turn's tool and model steps folded under the reply ("Worked through N steps",
 * open while the assistant is still working), a copy action on replies, day
 * separators, and a "New messages" cue when the reader has scrolled up.
 */
import React from 'react';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { TraceActivity } from '@almadar/core';
import { AgentChatFeed } from '../../src/components/core/molecules/AgentChatFeed';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.UTC(2026, 9, 3, 10, 0, 0);

function turn(at: number, reply?: string): TraceActivity[] {
  const out: TraceActivity[] = [
    { type: 'message', role: 'user', content: 'Create a task called test AI', timestamp: at },
    { type: 'tool_call', tool: 'TaskPersistor.DO_CREATE', kind: 'input', argsText: '{"title":"test AI"}', timestamp: at + 1 },
    { type: 'tool_result', tool: 'TaskPersistor.DO_CREATE', kind: 'input', success: true, resultText: '{"success":true}', timestamp: at + 2 },
  ];
  if (reply !== undefined) out.push({ type: 'message', role: 'assistant', content: reply, timestamp: at + 3 });
  return out;
}

function feed(activities: TraceActivity[], working = false) {
  return render(<AgentChatFeed activities={activities} emptyTitle="Ask me anything" rawLlmPreferenceKey="test-raw" idPrefix="t" working={working} />);
}

describe('AgentChatFeed', () => {
  it("folds a finished turn's steps under the reply, behind one disclosure", () => {
    feed(turn(T0, 'Created **test AI**.'));
    expect(screen.getByTestId('agent-activity-user-message')).toBeTruthy();
    expect(screen.getByTestId('agent-activity-assistant-message')).toBeTruthy();
    const steps = screen.getByTestId('agent-chat-steps');
    expect(steps.textContent).toContain('2');
    expect(screen.queryByTestId('agent-activity-tool_call')).toBeNull();
    fireEvent.click(screen.getByTestId('agent-chat-steps-toggle'));
    expect(screen.getByTestId('agent-activity-tool_call')).toBeTruthy();
  });

  it('control: while the assistant is working, the steps of the open turn stay visible with the thinking row', () => {
    feed(turn(T0), true);
    expect(screen.getByTestId('agent-activity-tool_call')).toBeTruthy();
    expect(screen.getByTestId('agent-activity-thinking')).toBeTruthy();
  });

  it('copies a reply', async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    feed(turn(T0, 'Created test AI.'));
    fireEvent.click(screen.getByTestId('agent-chat-copy'));
    expect(writeText).toHaveBeenCalledWith('Created test AI.');
  });

  it('separates days, and keeps one separator for a single day', () => {
    feed([...turn(T0, 'one'), ...turn(T0 + 2 * DAY, 'two')]);
    expect(screen.getAllByTestId('agent-chat-day')).toHaveLength(2);
    cleanup();
    feed([...turn(T0, 'one'), ...turn(T0 + 60_000, 'two')]);
    expect(screen.getAllByTestId('agent-chat-day')).toHaveLength(1);
  });

  it('shows a "New messages" cue instead of jumping when the reader scrolled up', () => {
    const view = feed(turn(T0, 'first'));
    const scroller = screen.getByTestId('t-scroller');
    Object.defineProperty(scroller, 'scrollHeight', { configurable: true, value: 2000 });
    Object.defineProperty(scroller, 'clientHeight', { configurable: true, value: 400 });
    scroller.scrollTop = 0;
    fireEvent.scroll(scroller);
    view.rerender(<AgentChatFeed activities={[...turn(T0, 'first'), ...turn(T0 + 60_000, 'second')]} emptyTitle="Ask me anything" rawLlmPreferenceKey="test-raw" idPrefix="t" />);
    expect(screen.getByTestId('agent-chat-new-messages')).toBeTruthy();
  });

  it('edge: an empty conversation shows the empty state', () => {
    feed([]);
    expect(screen.getByText('Ask me anything')).toBeTruthy();
  });
});

// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { TraceActivity } from '@almadar/core';
import { AgentActivityFeed, AgentActivityRow, groupIntoConversations, type RowFacts } from '../AgentActivityFeed';

const NO_FACTS: RowFacts = { settled: false, readyCount: 0 };

const wrap = (ui: React.ReactElement) => render(ui);

const change: TraceActivity = {
  type: 'schema_change',
  changeKind: 'trait-config-changed',
  orbitalName: 'FlagOrbital',
  traitName: 'ListingFlag',
  timestamp: 12,
};

const ALL: TraceActivity[] = [
  { type: 'message', role: 'system', content: 'Coordinator state: planning', timestamp: 0 },
  { type: 'tool_call', tool: 'set_roster', argsText: '{"appName":"M"}', timestamp: 3 },
  { type: 'tool_result', tool: 'persist.create', success: true, resultText: '{"ok":true}', timestamp: 4 },
  { type: 'file_operation', operation: 'write_file', path: 'orbitals/Flag.orb', success: true, timestamp: 5 },
  { type: 'schema_diff', filePath: 'schema.orb', hunks: [], timestamp: 5.5 },
  { type: 'coordinator_decision', organism: 'std-marketplace', reason: 'listings + vendors', priorOrganism: null, timestamp: 5.8 },
  { type: 'pending_question', questionId: 'q', question: 'Continue?', timestamp: 5.9 },
  { type: 'analysis', organism: 'std-marketplace', renames: [{ from: 'A', to: 'B' }], deletes: ['C'], timestamp: 6 },
  { type: 'plan_committed', orbitals: ['FlagOrbital', 'ListingOrbital'], timestamp: 7 },
  { type: 'orbital_started', orbitalName: 'FlagOrbital', timestamp: 8 },
  { type: 'orbital_done', orbitalName: 'FlagOrbital', traitCount: 12, transitionCount: 5, timestamp: 9 },
  change,
  {
    type: 'clarification_question', level: 'molecule', scope: {}, question: 'Which list?', skipDefault: 'a',
    candidates: [{ id: 'a', label: 'Listings', description: '', whyThisFits: 'matches' }], timestamp: 14,
  },
  { type: 'done', orbitalCount: 5, timestamp: 15 },
  { type: 'error', message: 'boom', timestamp: 16 },
  { type: 'cancelled', message: '', timestamp: 17 },
];

describe('AgentActivityFeed', () => {
  it('renders one row per activity type', () => {
    wrap(<AgentActivityFeed activities={ALL} />);
    for (const activity of ALL) expect(screen.getByTestId(`agent-activity-${activity.type}`)).toBeTruthy();
  });

  it('renders user and assistant messages as chat bubbles with their text verbatim', () => {
    wrap(<AgentActivityFeed activities={[
      { type: 'message', role: 'user', content: 'change the title', timestamp: 1 },
      { type: 'message', role: 'assistant', content: 'On it.', timestamp: 2 },
    ]} />);
    expect(screen.getByTestId('agent-activity-user-message').textContent).toBe('change the title');
    expect(screen.getByTestId('agent-activity-assistant-message').textContent).toBe('On it.');
  });

  it('an assistant reply renders its markdown; a user message stays plain text', () => {
    wrap(<AgentActivityFeed activities={[
      { type: 'message', role: 'user', content: 'list **all** tasks', timestamp: 1 },
      { type: 'message', role: 'assistant', content: 'The task is:\n\n- **Title:** Ember Drift', timestamp: 2 },
    ]} />);
    const reply = screen.getByTestId('agent-activity-assistant-message');
    expect(reply.querySelector('strong')?.textContent).toBe('Title:');
    expect(reply.querySelector('li')?.textContent).toBe('Title: Ember Drift');
    const mine = screen.getByTestId('agent-activity-user-message');
    expect(mine.querySelector('strong')).toBeNull();
    expect(mine.textContent).toBe('list **all** tasks');
  });

  it('shows the empty state for no activities', () => {
    wrap(<AgentActivityFeed activities={[]} emptyTitle="Nothing yet" />);
    expect(screen.getByText('Nothing yet')).toBeTruthy();
    expect(screen.queryByTestId('agent-activity-feed')).toBeNull();
  });

  it('names the changed orbital and trait on a schema change', () => {
    wrap(<AgentActivityRow activity={change} facts={NO_FACTS} />);
    expect(screen.getByText('Changed the settings of FlagOrbital')).toBeTruthy();
    expect(screen.getByText('ListingFlag')).toBeTruthy();
  });

  it('jump renders only with a handler and an orbital target, and reports the target', () => {
    const onJump = vi.fn();
    const { rerender } = wrap(<AgentActivityRow activity={change} facts={NO_FACTS} />);
    expect(screen.queryByTestId('agent-activity-jump')).toBeNull();
    rerender(<AgentActivityRow activity={ALL[13]} onJump={onJump} facts={NO_FACTS} />);
    expect(screen.queryByTestId('agent-activity-jump')).toBeNull();
    rerender(<AgentActivityRow activity={change} onJump={onJump} facts={NO_FACTS} />);
    fireEvent.click(screen.getByTestId('agent-activity-jump'));
    expect(onJump).toHaveBeenCalledWith({ orbital: 'FlagOrbital', trait: 'ListingFlag' });
  });

  it('cancelled with no message falls back to the cancelled label', () => {
    wrap(<AgentActivityRow activity={ALL[15]} facts={NO_FACTS} />);
    expect(screen.getByText('Cancelled')).toBeTruthy();
  });

  it('a raw LLM response is one collapsed line that expands to the full call', () => {
    const longPrompt = `You are the Coordinator. ${'x'.repeat(5000)}`;
    wrap(<AgentActivityRow activity={{
      type: 'llm_response',
      content: '[{"name":"set_roster"}]',
      llm: {
        service: 'coordinator', provider: 'deepseek', model: 'deepseek-chat',
        systemPrompt: longPrompt, userPrompt: 'rename it', toolCallsJson: '[{"name":"set_roster","args":{}}]',
        durationMs: 1200, promptTokens: 900, completionTokens: 40, costUSD: 0.0021,
      },
      timestamp: 1,
    }} facts={NO_FACTS} />);
    expect(screen.getByText('coordinator · deepseek-chat · 1.2s · 900 in / 40 out tokens · $0.0021')).toBeTruthy();
    expect(screen.queryByText(longPrompt)).toBeNull();
    fireEvent.click(screen.getByText(/coordinator · deepseek-chat/));
    expect(screen.getByText(longPrompt)).toBeTruthy();
    expect(screen.getByText('rename it')).toBeTruthy();
    expect(screen.getByText('[{"name":"set_roster","args":{}}]')).toBeTruthy();
  });
});

// While the agent works — before its first event, and through every long LLM
// call after — the feed says so, instead of sitting still or claiming it is empty.
describe('AgentActivityFeed working indicator', () => {
  it('working with nothing yet: the thinking row, not the empty state', () => {
    wrap(<AgentActivityFeed activities={[]} working emptyTitle="Nothing yet" />);
    expect(screen.getByTestId('agent-activity-thinking')).toBeTruthy();
    expect(screen.queryByText('Nothing yet')).toBeNull();
  });

  it('working after some activity: the thinking row comes last', () => {
    wrap(<AgentActivityFeed activities={[change]} working />);
    const feed = screen.getByTestId('agent-activity-feed');
    const thinking = screen.getByTestId('agent-activity-thinking');
    expect(feed.contains(thinking)).toBe(true);
    const rows = Array.from(feed.querySelectorAll('[data-testid^="agent-activity-"]'));
    expect(rows[rows.length - 1]).toBe(thinking);
  });

  it('control: not working shows no thinking row (and the empty state when empty)', () => {
    wrap(<AgentActivityFeed activities={[]} emptyTitle="Nothing yet" />);
    expect(screen.queryByTestId('agent-activity-thinking')).toBeNull();
    expect(screen.getByText('Nothing yet')).toBeTruthy();
  });
});


const TWO_RUNS: TraceActivity[] = [
  { type: 'message', role: 'user', content: 'Build a forum', timestamp: 1 },
  { type: 'orbital_started', orbitalName: 'ThreadOrbital', timestamp: 2 },
  { type: 'orbital_done', orbitalName: 'ThreadOrbital', timestamp: 3 },
  { type: 'message', role: 'user', content: 'Add voting', timestamp: 10 },
  { type: 'orbital_started', orbitalName: 'VoteOrbital', timestamp: 11 },
];

describe('groupIntoConversations', () => {
  it('starts a conversation at each user prompt', () => {
    const groups = groupIntoConversations(TWO_RUNS);
    expect(groups.map((g) => [g.prompt, g.activities.length])).toEqual([['Build a forum', 3], ['Add voting', 2]]);
  });

  it('edge: activities before any prompt form their own conversation; empty input has none', () => {
    const groups = groupIntoConversations([{ type: 'done', orbitalCount: 1, timestamp: 0 }, ...TWO_RUNS]);
    expect(groups.map((g) => g.prompt)).toEqual([undefined, 'Build a forum', 'Add voting']);
    expect(groupIntoConversations([])).toEqual([]);
  });
});

describe('AgentActivityFeed — earlier conversations', () => {
  it('keeps earlier conversations collapsed under their prompt and the current one open', () => {
    wrap(<AgentActivityFeed activities={TWO_RUNS} />);
    expect(screen.getByTestId('agent-earlier-conversations')).toBeTruthy();
    expect(screen.getByText('Build a forum')).toBeTruthy();
    expect(screen.queryByText(/ThreadOrbital ready/)).toBeNull();
    expect(screen.getByText('Add voting')).toBeTruthy();
    expect(screen.getByText(/Working on VoteOrbital/)).toBeTruthy();
  });

  it('expanding an earlier conversation shows what happened in it', () => {
    wrap(<AgentActivityFeed activities={TWO_RUNS} />);
    fireEvent.click(screen.getByText('Build a forum'));
    expect(screen.getByText(/ThreadOrbital ready/)).toBeTruthy();
  });

  it('control: a single conversation renders flat, with no earlier section', () => {
    wrap(<AgentActivityFeed activities={TWO_RUNS.slice(0, 3)} />);
    expect(screen.queryByTestId('agent-earlier-conversations')).toBeNull();
    expect(screen.getByText(/ThreadOrbital ready/)).toBeTruthy();
  });
});

/**
 * "Working on X…" spins only while X is actually being built: once an
 * `orbital_done` for X follows it, the run is over (a replayed trace used to
 * show every re-built orbital spinning forever).
 */
describe('AgentActivityFeed — a finished orbital run stops spinning', () => {
  const spinningStarts = (container: HTMLElement) =>
    [...container.querySelectorAll('[data-testid="agent-activity-orbital_started"]')]
      .filter((row) => row.querySelector('.animate-spin') !== null)
      .map((row) => row.textContent ?? '');

  it('every run of a re-built orbital that finished is settled', () => {
    const { container } = wrap(
      <AgentActivityFeed
        activities={[
          { type: 'orbital_started', orbitalName: 'FlagOrbital', timestamp: 1 },
          { type: 'orbital_done', orbitalName: 'FlagOrbital', timestamp: 2 },
          { type: 'orbital_started', orbitalName: 'FlagOrbital', timestamp: 3 },
          { type: 'orbital_done', orbitalName: 'FlagOrbital', timestamp: 4 },
        ]}
      />,
    );
    expect(spinningStarts(container)).toEqual([]);
  });

  it('control: a run with no done yet keeps spinning', () => {
    const { container } = wrap(
      <AgentActivityFeed
        activities={[
          { type: 'orbital_started', orbitalName: 'FlagOrbital', timestamp: 1 },
          { type: 'orbital_done', orbitalName: 'FlagOrbital', timestamp: 2 },
          { type: 'orbital_started', orbitalName: 'FlagOrbital', timestamp: 3 },
        ]}
      />,
    );
    expect(spinningStarts(container)).toHaveLength(1);
  });

  it("edge: one orbital's done never settles another orbital's start", () => {
    const { container } = wrap(
      <AgentActivityFeed
        activities={[
          { type: 'orbital_started', orbitalName: 'FlagOrbital', timestamp: 1 },
          { type: 'orbital_started', orbitalName: 'ListingOrbital', timestamp: 2 },
          { type: 'orbital_done', orbitalName: 'FlagOrbital', timestamp: 3 },
        ]}
      />,
    );
    const spinning = spinningStarts(container);
    expect(spinning).toHaveLength(1);
    expect(spinning[0]).toContain('ListingOrbital');
  });
});

/**
 * "Done — N orbitals ready" counts the orbitals this run finished, read from
 * the run's own "ready" rows — the same on a live stream and on a replayed
 * trace (a replay has no schema, and used to say "0 orbitals ready").
 */
describe('AgentActivityFeed — the done row counts the orbitals the run finished', () => {
  const doneText = (container: HTMLElement) =>
    container.querySelector('[data-testid="agent-activity-done"]')?.textContent ?? '';

  it('a replayed edit that rebuilt one orbital says 1, not the missing-schema 0', () => {
    const { container } = wrap(
      <AgentActivityFeed
        activities={[
          { type: 'orbital_started', orbitalName: 'FlagOrbital', timestamp: 1 },
          { type: 'orbital_done', orbitalName: 'FlagOrbital', timestamp: 2 },
          { type: 'done', orbitalCount: 0, timestamp: 3 },
        ]}
      />,
    );
    expect(doneText(container)).toContain('1');
    expect(doneText(container)).not.toContain('0');
  });

  it('control: a full generation that finished three orbitals says 3', () => {
    const { container } = wrap(
      <AgentActivityFeed
        activities={[
          { type: 'orbital_done', orbitalName: 'A', timestamp: 1 },
          { type: 'orbital_done', orbitalName: 'B', timestamp: 2 },
          { type: 'orbital_done', orbitalName: 'C', timestamp: 3 },
          { type: 'done', orbitalCount: 3, timestamp: 4 },
        ]}
      />,
    );
    expect(doneText(container)).toContain('3');
  });

  it('edge: an orbital rebuilt twice in one run counts once', () => {
    const { container } = wrap(
      <AgentActivityFeed
        activities={[
          { type: 'orbital_done', orbitalName: 'ListingOrbital', timestamp: 1 },
          { type: 'orbital_done', orbitalName: 'ListingOrbital', timestamp: 2 },
          { type: 'done', orbitalCount: 5, timestamp: 3 },
        ]}
      />,
    );
    expect(doneText(container)).toContain('1');
    expect(doneText(container)).not.toContain('5');
  });

  it('follows the latest row by default (scrolls it into view)', () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    wrap(<AgentActivityFeed activities={[{ type: 'message', role: 'user', content: 'hi', timestamp: 1 }]} />);
    expect(scroll).toHaveBeenCalled();
  });

  it('control: followLatest={false} never scrolls the page (a history list of feeds)', () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    wrap(<AgentActivityFeed activities={[{ type: 'message', role: 'user', content: 'hi', timestamp: 1 }]} followLatest={false} />);
    expect(scroll).not.toHaveBeenCalled();
  });

  it('a tool call keeps its arguments one click away, exactly as the model wrote them', () => {
    wrap(<AgentActivityFeed activities={[{ type: 'tool_call', tool: 'TaskBrowse.CREATE_TASK', kind: 'input', argsText: '{"title":"Ship"}', timestamp: 1 }]} />);
    expect(screen.queryByText('{"title":"Ship"}')).toBeNull();
    fireEvent.click(screen.getByText('Called TaskBrowse.CREATE_TASK'));
    expect(screen.getByText('{"title":"Ship"}')).toBeTruthy();
  });

  it('a refused tool result shows why at once, and its full answer when opened', () => {
    const answer = `{"success":false,"rows":"${'x'.repeat(4000)}"}`;
    wrap(<AgentActivityFeed activities={[{ type: 'tool_result', tool: 'TaskBrowse.CREATE_TASK', kind: 'input', success: false, detail: 'create denied', resultText: answer, timestamp: 2 }]} />);
    expect(screen.getByText('create denied')).toBeTruthy();
    expect(screen.queryByText(answer)).toBeNull();
    fireEvent.click(screen.getByText('TaskBrowse.CREATE_TASK returned'));
    expect(screen.getByText(answer)).toBeTruthy();
  });

  it('a read result says how many rows came back', () => {
    wrap(<AgentActivityFeed activities={[{ type: 'tool_result', tool: 'Task', kind: 'read', success: true, rows: 3, resultText: '{"rows":[]}', timestamp: 3 }]} />);
    expect(screen.getByText('3 rows')).toBeTruthy();
  });

  it('control: empty arguments add no detail line', () => {
    wrap(<AgentActivityFeed activities={[{ type: 'tool_call', tool: 'Task', kind: 'read', argsText: '{}', timestamp: 4 }]} />);
    expect(screen.queryByText('{}')).toBeNull();
  });
});


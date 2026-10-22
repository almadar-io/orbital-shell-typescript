import { describe, it, expect } from 'vitest';
import { selectTraceActivities, TRACE_ACTIVITY_TYPES, type TraceActivity } from '../src/agent-trace-view';

const activities: TraceActivity[] = [
  { type: 'message', role: 'user', content: 'hi', timestamp: 1 },
  { type: 'message', role: 'system', content: 'Coordinator state: planning', timestamp: 2 },
  { type: 'tool_call', tool: 'set_roster', argsText: '{}', timestamp: 3 },
  { type: 'schema_change', changeKind: 'trait-config-changed', orbitalName: 'Flag', traitName: 'ListingFlag', timestamp: 4 },
  { type: 'schema_change', changeKind: 'guard-changed', orbitalName: 'Flag', timestamp: 5 },
  { type: 'done', orbitalCount: 1, timestamp: 6 },
  { type: 'llm_response', content: '[{"name":"set_roster"}]', timestamp: 7 },
];

describe('selectTraceActivities', () => {
  it('keeps only the audience types, in order', () => {
    expect(selectTraceActivities(activities, { types: ['done', 'tool_call'] }).map((a) => a.type)).toEqual(['tool_call', 'done']);
  });

  it('restricts messages to the named roles; omitted = every role', () => {
    expect(selectTraceActivities(activities, { types: ['message'], messageRoles: ['user'] })).toEqual([activities[0]]);
    expect(selectTraceActivities(activities, { types: ['message'] })).toHaveLength(2);
  });

  it('restricts schema changes to the named kinds; omitted = every kind', () => {
    expect(selectTraceActivities(activities, { types: ['schema_change'], schemaChangeKinds: ['trait-config-changed'] })).toEqual([activities[3]]);
    expect(selectTraceActivities(activities, { types: ['schema_change'] })).toHaveLength(2);
  });

  it('a sub-filter never hides other types', () => {
    const picked = selectTraceActivities(activities, { types: ['tool_call', 'message'], messageRoles: [] });
    expect(picked.map((a) => a.type)).toEqual(['tool_call']);
  });

  it('raw LLM responses are their own type, never a message', () => {
    expect(selectTraceActivities(activities, { types: ['message'] }).some((a) => a.type === 'llm_response')).toBe(false);
    expect(selectTraceActivities(activities, { types: ['llm_response'] })).toEqual([activities[6]]);
  });

  it('empty audience sees nothing; full audience sees everything', () => {
    expect(selectTraceActivities(activities, { types: [] })).toEqual([]);
    expect(selectTraceActivities(activities, { types: TRACE_ACTIVITY_TYPES })).toEqual(activities);
  });
});

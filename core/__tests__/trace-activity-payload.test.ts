import { describe, it, expect } from 'vitest';
import { traceActivityPayload, type TraceActivity } from '../src/agent-trace-view';
import { RENDERED_SLOTS, UI_SLOTS } from '../src/types/effect';

describe('traceActivityPayload', () => {
  it('carries a tool_result unchanged under `activity`', () => {
    const activity: TraceActivity = {
      type: 'tool_result',
      tool: 'TaskBrowse.CREATE_TASK',
      kind: 'input',
      success: true,
      resultText: '{"success":true,"states":{"TaskBrowse":"browsing"}}',
      timestamp: 3,
    };
    expect(traceActivityPayload(activity)).toEqual({ activity });
  });

  it('keeps the llm call meta of an llm_response', () => {
    const activity: TraceActivity = {
      type: 'llm_response',
      content: 'Done.',
      llm: { service: 'llm', provider: 'deepseek', model: 'deepseek-chat', systemPrompt: '', userPrompt: 'add a task', durationMs: 812, promptTokens: 40, completionTokens: 4 },
      timestamp: 4,
    };
    expect(traceActivityPayload(activity)).toEqual({ activity });
  });

  it('drops absent optional fields instead of carrying undefined', () => {
    const activity: TraceActivity = { type: 'tool_call', tool: 'Task', kind: 'read', argsText: '{}', timestamp: 1, isExecuting: undefined };
    expect(traceActivityPayload(activity)).toStrictEqual({ activity: { type: 'tool_call', tool: 'Task', kind: 'read', argsText: '{}', timestamp: 1 } });
  });

  it('a failed call and a read carry their concrete outcome fields', () => {
    const refused: TraceActivity = { type: 'tool_result', tool: 'TaskBrowse.CREATE_TASK', kind: 'input', success: false, detail: 'create denied', resultText: '{"success":false}', timestamp: 6 };
    const read: TraceActivity = { type: 'tool_result', tool: 'Task', kind: 'read', success: true, rows: 3, resultText: '{"rows":[]}', timestamp: 7 };
    expect(traceActivityPayload(refused)).toEqual({ activity: refused });
    expect(traceActivityPayload(read)).toEqual({ activity: read });
  });

  it('control: a plain message round-trips', () => {
    const activity: TraceActivity = { type: 'message', role: 'assistant', content: 'hi', timestamp: 2 };
    expect(traceActivityPayload(activity)).toEqual({ activity });
  });
});

describe('UI_SLOTS', () => {
  it('declares the dock slot beside sidebar', () => {
    expect(UI_SLOTS).toContain('dock');
  });

  it('control: still declares drawer (the overlay sheet the dock is not)', () => {
    expect(UI_SLOTS).toContain('drawer');
  });
});

describe('RENDERED_SLOTS', () => {
  it('is every slot a renderer mounts by id, the dock included', () => {
    expect(RENDERED_SLOTS).toContain('dock');
    expect(RENDERED_SLOTS).toContain('floating');
  });

  it('control: excludes the HUD group key, the screen alias and dotted sub-slots', () => {
    expect(RENDERED_SLOTS).not.toContain('hud');
    expect(RENDERED_SLOTS).not.toContain('screen');
    expect(RENDERED_SLOTS.some((s) => s.includes('.'))).toBe(false);
  });
});

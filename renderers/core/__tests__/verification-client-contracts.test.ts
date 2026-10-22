import { expectTypeOf, it } from 'vitest';
import type { OrbitalVerificationAPI } from '../src/types/verification.js';
import type { TraitConfig } from '../src/types/trait.js';
import type { AgentTraceState, TraceActivity, TraceSubagent, TraceChatMessage } from '../src/agent-trace-view.js';

it('the optional config sweep contract accepts canonical trait configs', () => {
  expectTypeOf<OrbitalVerificationAPI['applyConfig']>().toEqualTypeOf<
    ((traitName: string, config: TraitConfig) => void | Promise<void>) | undefined
  >();
});

it('the trace snapshot composes existing core render contracts', () => {
  expectTypeOf<AgentTraceState['activities']>().toEqualTypeOf<TraceActivity[]>();
  expectTypeOf<AgentTraceState['subagents']>().toEqualTypeOf<TraceSubagent[]>();
  expectTypeOf<AgentTraceState['coordinatorMessages']>().toEqualTypeOf<TraceChatMessage[]>();
  expectTypeOf<AgentTraceState['status']>().toEqualTypeOf<'idle' | 'running' | 'paused' | 'complete' | 'error'>();
});

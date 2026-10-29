export * from '@almadar/shell-runtime/kernel/host';
import { answerRequest as answerSharedRequest, type KernelHostPorts, type KernelAnswerScope } from '@almadar/shell-runtime/kernel/host';
import type { IoRequestWire, IoAnswerWire } from '@almadar/shell-runtime/kernel/wire';
import { readPageFacts } from '@almadar/shell-browser/page-facts';
import { webHostActions } from '../lib/host-actions';

export function answerRequest(ports: KernelHostPorts, request: IoRequestWire, scope: KernelAnswerScope): Promise<IoAnswerWire> {
  return answerSharedRequest({ ...ports, pageFacts: ports.pageFacts ?? readPageFacts, hostActions: ports.hostActions ?? webHostActions }, request, scope);
}

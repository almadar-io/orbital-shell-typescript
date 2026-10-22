export * from '@almadar/shell-runtime/kernel/host';
import { answerRequest as answerSharedRequest, type KernelHostPorts, type KernelAnswerScope } from '@almadar/shell-runtime/kernel/host';
import type { IoRequestWire, IoAnswerWire } from '@almadar/shell-runtime/kernel/wire';
import { readPageFacts } from '@almadar/shell-browser/page-facts';

export function answerRequest(ports: KernelHostPorts, request: IoRequestWire, scope: KernelAnswerScope): Promise<IoAnswerWire> {
  return answerSharedRequest({ ...ports, pageFacts: ports.pageFacts ?? readPageFacts }, request, scope);
}

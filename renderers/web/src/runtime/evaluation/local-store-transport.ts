export * from '@almadar/shell-runtime/runtime/evaluation/local-store-transport';
import { openLocalKernel as openSharedLocalKernel, type LocalKernelOptions } from '@almadar/shell-runtime/runtime/evaluation/local-store-transport';
import { readPageFacts } from '@almadar/shell-browser/page-facts';

export function openLocalKernel(options: LocalKernelOptions): ReturnType<typeof openSharedLocalKernel> {
  return openSharedLocalKernel({ ...options, pageFacts: options.pageFacts ?? readPageFacts });
}

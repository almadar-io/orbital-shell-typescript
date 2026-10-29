export * from '@almadar/shell-runtime/kernel/engine';
import { KernelEngine as SharedKernelEngine } from '@almadar/shell-runtime/kernel/engine';
import type { KernelHostPorts } from '@almadar/shell-runtime/kernel/host';
import type { KernelModule, KernelServerHandle } from '@almadar/shell-runtime/kernel/wire';
import type { OrbitalSchema } from '@almadar/core';
import { readPageFacts } from '@almadar/shell-browser/page-facts';
import { webHostActions } from '../lib/host-actions';

export class KernelEngine extends SharedKernelEngine {
  constructor(kernel: KernelModule, schemaJson: string, ports: KernelHostPorts, entityTypes: readonly string[] = [], forkedFrom?: KernelServerHandle) {
    super(kernel, schemaJson, { ...ports, pageFacts: ports.pageFacts ?? readPageFacts, hostActions: ports.hostActions ?? webHostActions }, entityTypes, forkedFrom);
  }

  static override open(kernel: KernelModule, schema: OrbitalSchema, ports: KernelHostPorts): SharedKernelEngine {
    return SharedKernelEngine.open(kernel, schema, { ...ports, pageFacts: ports.pageFacts ?? readPageFacts, hostActions: ports.hostActions ?? webHostActions });
  }
}

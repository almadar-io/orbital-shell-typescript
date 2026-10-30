import type { KernelMemoryStoreExports } from '@almadar/core';
import { NativeMemoryPersistenceAdapter } from '@almadar/shell-runtime/persistence/native-memory';
import type { KernelModule } from '@almadar/shell-runtime/kernel/wire';

function hasMemoryStore(kernel: KernelModule): kernel is KernelModule & KernelMemoryStoreExports {
  return 'MemoryStore' in kernel;
}

/** A row store held by the kernel itself (its `MemoryStore`): what a host with no browser database keeps rows in. */
export function nativeMemoryPersistence(kernel: KernelModule): NativeMemoryPersistenceAdapter {
  if (!hasMemoryStore(kernel)) throw new Error('nativeMemoryPersistence: this kernel module exports no MemoryStore; install a kernel build that carries it');
  return new NativeMemoryPersistenceAdapter(new kernel.MemoryStore());
}

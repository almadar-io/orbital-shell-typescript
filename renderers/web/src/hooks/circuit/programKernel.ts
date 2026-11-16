/**
 * One client kernel per program (EXEC-LOAD-2): a program's pages and the lazy pages it opens run in the kernel its first
 * page built, each lazy page's program loaded into it once. Its server session holds every page's frames, so a kernel
 * per page refused the frames of the page it left.
 *
 * @packageDocumentation
 */
import { createContext } from 'react';
import type { KernelInstance } from '../../lib/kernel-wire';

export interface ProgramKernel<K = KernelInstance> {
  /** The program's kernel with the program `key` names in it: built by `make` the first time, loaded by `load` once after. */
  open(key: string, make: () => Promise<K>, load: (kernel: K) => void): Promise<K>;
}

export function createProgramKernel<K = KernelInstance>(): ProgramKernel<K> {
  let kernel: Promise<K> | undefined;
  const opened = new Map<string, Promise<K>>();
  return {
    open(key, make, load) {
      const held = opened.get(key);
      if (held !== undefined) return held;
      const base = kernel;
      const next = base === undefined ? make() : base.then((k) => { load(k); return k; });
      opened.set(key, next);
      // A page whose program failed to load fails alone: the pages after it load into the kernel as it was.
      const kept = base === undefined ? next : next.then((k) => k, () => base);
      kernel = kept;
      next.catch(() => {
        opened.delete(key);
        if (base === undefined && kernel === kept) kernel = undefined;
      });
      return next;
    },
  };
}

export const ProgramKernelContext = createContext<ProgramKernel | null>(null);

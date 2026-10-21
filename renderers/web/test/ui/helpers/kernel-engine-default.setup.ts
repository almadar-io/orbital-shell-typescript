import { beforeAll, vi } from 'vitest';
import { warmKernel } from '../../../src/test-support/kernel-engine';

vi.mock('../../../src/providers/KernelEngineContext', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/providers/KernelEngineContext')>();
  const { KERNEL_ENGINE } = await import('../../../src/test-support/kernel-engine');
  return { ...actual, useKernelEngine: () => KERNEL_ENGINE };
});

beforeAll(warmKernel);

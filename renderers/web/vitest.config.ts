import { defineConfig } from 'vitest/config';

const RENDER_KERNEL_SETUP = ['./vitest.setup.ts', './test/ui/helpers/kernel-evaluator.setup.ts', './test/ui/helpers/kernel-engine-default.setup.ts'];

export default defineConfig({
  test: {
    passWithNoTests: true,
    projects: [
      {
        test: {
          name: 'host',
          include: ['test/*.test.ts', 'test/runtime/**/*.test.ts', 'src/runtime/**/__tests__/*.test.ts'],
          environment: 'node',
          globals: true,
        },
      },
      {
        test: {
          name: 'core',
          include: ['src/core/**/__tests__/*.test.{ts,tsx}'],
          environment: 'jsdom',
          globals: true,
          setupFiles: ['./vitest.setup.ts'],
        },
      },
      {
        // Every circuit runs on the kernel: the setup supplies the test kernel where a host would pass its loader.
        test: {
          name: 'render',
          include: ['test/ui/**/*.test.{ts,tsx}', 'src/**/__tests__/**/*.test.{ts,tsx}'],
          exclude: [
            '**/node_modules/**',
            '**/dist/**',
            'src/core/**',
            'src/runtime/**',
            // BURNDOWN (2026-08-19, target 0): drifted while the component glob was orphaned (CardGrid search/navigatesTo,
            // EmojiPicker listbox roles, RuntimeDebugger redesign).
            'src/components/core/organisms/__tests__/CardGrid.test.tsx',
            'src/components/core/molecules/__tests__/EmojiPicker.test.tsx',
            'src/components/core/organisms/debug/__tests__/RuntimeDebugger.test.tsx',
          ],
          environment: 'jsdom',
          globals: true,
          setupFiles: RENDER_KERNEL_SETUP,
        },
      },
    ],
  },
});

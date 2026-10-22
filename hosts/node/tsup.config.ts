import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { index: 'src/index.ts', OrbitalServerRuntime: 'src/runtime/OrbitalServerRuntime.ts', kernelWorkspace: 'src/program/kernel-workspace-host.ts', createProgramHandlers: 'src/program/createProgramHandlers.ts', sse: 'src/runtime/sse.ts' },
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: false,
  splitting: true,
  treeshake: true,
});

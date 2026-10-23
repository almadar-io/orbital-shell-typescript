import { workspacesRoot, kernelWorkspaceHost, workspaceBucketFromEnv } from './chunk-UZQ2N73M.js';
import { runProgramEffect } from './chunk-QLDWVDYK.js';
import { installedWorkspaceHost, installWorkspaceHost } from './chunk-BWMLDDCL.js';

// src/program/createProgramHandlers.ts
var bucketOf = () => {
  const bucket = workspaceBucketFromEnv(process.env);
  return bucket === void 0 ? {} : { bucket };
};
function createProgramHandlers(host) {
  const opts = host.orbBin === void 0 ? { cwd: host.cwd } : { cwd: host.cwd, orbBin: host.orbBin };
  if (installedWorkspaceHost()?.root !== workspacesRoot(host.cwd)) {
    installWorkspaceHost(kernelWorkspaceHost({ projectRoot: host.cwd, ...bucketOf(), ...host.orbBin !== void 0 ? { orb: host.orbBin } : {} }));
  }
  return { programEffect: (op, args, context) => runProgramEffect(op, args, opts, context) };
}

export { createProgramHandlers };

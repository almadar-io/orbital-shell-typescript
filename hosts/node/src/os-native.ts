/** Node-only: the `os` port of the native kernel add-on, anchored at this process. */
import { homedir } from 'node:os';
import { dirname } from 'node:path';
import { createNativeOsPort, type KernelModule, type KernelServerHandle, type OsAnchors, type OsHostPort } from '@almadar/shell-runtime';

/** Where `~/` and `./` resolve for this process: its home, working directory, executable and environment. */
export function nodeOsAnchors(): OsAnchors {
  const env = Object.fromEntries(Object.entries(process.env).flatMap(([name, value]) => (value === undefined ? [] : [[name, value]])));
  return { home: homedir(), start: process.cwd(), exeDir: dirname(process.execPath), exe: process.execPath, env };
}

/** The native add-on's `os` answerer over `server`'s grants; `undefined` for a kernel module that has none (the wasm module), whose `os` asks stay `unsupported`. */
export function nativeOsHost(kernel: KernelModule, server: () => KernelServerHandle): OsHostPort | undefined {
  return kernel.OsHost === undefined ? undefined : createNativeOsPort(kernel.OsHost, nodeOsAnchors(), server);
}

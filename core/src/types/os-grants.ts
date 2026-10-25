/**
 * OS grants — the program's closed-by-default `os/` permissions.
 * Mirrors `OsGrants` in `orbital-core/crates/base/src/os_grants.rs`.
 */

import { z } from "zod";

export const FS_MODES = ["read", "write", "create", "remove", "meta"] as const;
export const NET_KINDS = ["tcp", "udp", "listen"] as const;
export const STDIO_KINDS = ["in", "out", "err"] as const;
export const SYS_KINDS = ["cpu", "memory", "disk", "network", "power-state", "identity"] as const;
export const DESKTOP_KINDS = ["notify", "speak", "brightness", "volume", "power"] as const;
export const DEV_KINDS = ["read", "write", "wait", "ack"] as const;

export type FsMode = (typeof FS_MODES)[number];
export type NetKind = (typeof NET_KINDS)[number];
export type StdioKind = (typeof STDIO_KINDS)[number];
export type SysKind = (typeof SYS_KINDS)[number];
export type DesktopKind = (typeof DESKTOP_KINDS)[number];
export type DevKind = (typeof DEV_KINDS)[number];

/** A path glob and the modes it grants. */
export interface FsGrant {
  glob: string;
  modes: FsMode[];
}

/** An exact `host:port` and the kinds of traffic it grants. */
export interface NetGrant {
  target: string;
  kinds: NetKind[];
}

/** A device resource (`mmio:<base>+<length>` or `irq:<line>`) and the kinds of access it grants. */
export interface DevGrant {
  target: string;
  kinds: DevKind[];
}

/** Every grant a program or orbital declares; an omitted family grants nothing. */
export interface OsGrants {
  fs?: FsGrant[];
  exec?: string[];
  net?: NetGrant[];
  env?: string[];
  stdio?: StdioKind[];
  sys?: SysKind[];
  desktop?: DesktopKind[];
  dev?: DevGrant[];
}

/** Every grant either declares: lists deduplicated in first-seen order, an fs glob or net target named by both with its modes or kinds unioned. */
export function unionOsGrants(a: OsGrants | undefined, b: OsGrants | undefined): OsGrants {
  const list = <T>(x: readonly T[] | undefined, y: readonly T[] | undefined): T[] => [...new Set([...(x ?? []), ...(y ?? [])])];
  const keyed = <G, K>(x: readonly G[] | undefined, y: readonly G[] | undefined, key: (g: G) => string, items: (g: G) => readonly K[], make: (g: G, merged: K[]) => G): G[] => {
    const out = new Map<string, G>();
    for (const grant of [...(x ?? []), ...(y ?? [])]) {
      const seen = out.get(key(grant));
      out.set(key(grant), seen === undefined ? grant : make(seen, list(items(seen), items(grant))));
    }
    return [...out.values()];
  };
  const out: OsGrants = {};
  const fs = keyed(a?.fs, b?.fs, (g) => g.glob, (g) => g.modes, (g, modes) => ({ ...g, modes }));
  const net = keyed(a?.net, b?.net, (g) => g.target, (g) => g.kinds, (g, kinds) => ({ ...g, kinds }));
  if (fs.length > 0) out.fs = fs;
  if (net.length > 0) out.net = net;
  const dev = keyed(a?.dev, b?.dev, (g) => g.target, (g) => g.kinds, (g, kinds) => ({ ...g, kinds }));
  if (dev.length > 0) out.dev = dev;
  const exec = list(a?.exec, b?.exec);
  const env = list(a?.env, b?.env);
  const stdio = list(a?.stdio, b?.stdio);
  const sys = list(a?.sys, b?.sys);
  const desktop = list(a?.desktop, b?.desktop);
  if (exec.length > 0) out.exec = exec;
  if (env.length > 0) out.env = env;
  if (stdio.length > 0) out.stdio = stdio;
  if (sys.length > 0) out.sys = sys;
  if (desktop.length > 0) out.desktop = desktop;
  return out;
}

export const FsModeSchema = z.enum(FS_MODES);
export const NetKindSchema = z.enum(NET_KINDS);
export const StdioKindSchema = z.enum(STDIO_KINDS);
export const SysKindSchema = z.enum(SYS_KINDS);
export const DesktopKindSchema = z.enum(DESKTOP_KINDS);
export const DevKindSchema = z.enum(DEV_KINDS);

export const FsGrantSchema = z.object({
  glob: z.string(),
  modes: z.array(FsModeSchema),
});

export const NetGrantSchema = z.object({
  target: z.string(),
  kinds: z.array(NetKindSchema),
});

export const DevGrantSchema = z.object({
  target: z.string(),
  kinds: z.array(DevKindSchema),
});

export const OsGrantsSchema = z.object({
  fs: z.array(FsGrantSchema).optional(),
  exec: z.array(z.string()).optional(),
  net: z.array(NetGrantSchema).optional(),
  env: z.array(z.string()).optional(),
  stdio: z.array(StdioKindSchema).optional(),
  sys: z.array(SysKindSchema).optional(),
  desktop: z.array(DesktopKindSchema).optional(),
  dev: z.array(DevGrantSchema).optional(),
});

/** `deployment` — target name to the orbital names deployed there. */
export const DeploymentSchema = z.record(z.string(), z.array(z.string()));
export type Deployment = z.infer<typeof DeploymentSchema>;

/**
 * OS grants: the program's closed-by-default `os/` permissions. The types are generated from `OsGrants` in
 * `orbital-core/crates/base/src/host/os_grants/mod.rs` (`generated/kernel-wire.ts`); only the union lives here.
 */

import { z } from "zod";
import type { AnchoredGrants, KvMode, OsGrants } from "../generated/kernel-wire.js";

export type {
  AnchoredExec,
  AnchoredFsGrant,
  AnchoredGrants,
  AnchoredNetGrant,
  DesktopKind,
  DevGrant,
  DevKind,
  FsGrant,
  FsMode,
  GrantAnchor,
  KvMode,
  NetGrant,
  NetKind,
  NetPart,
  OsGrants,
  StdioKind,
  SysKind,
} from "../generated/kernel-wire.js";

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
  const kv: Record<string, KvMode[]> = {};
  for (const store of [...Object.keys(a?.kv ?? {}), ...Object.keys(b?.kv ?? {})]) {
    kv[store] = list(a?.kv?.[store], b?.kv?.[store]);
  }
  if (Object.keys(kv).length > 0) out.kv = kv;
  const anchored: AnchoredGrants = {};
  const distinct = <T>(x: readonly T[] | undefined, y: readonly T[] | undefined): T[] => {
    const out = new Map<string, T>();
    for (const g of [...(x ?? []), ...(y ?? [])]) out.set(JSON.stringify(g), g);
    return [...out.values()];
  };
  const anchoredFs = distinct(a?.anchored?.fs, b?.anchored?.fs);
  const anchoredExec = distinct(a?.anchored?.exec, b?.anchored?.exec);
  const anchoredNet = distinct(a?.anchored?.net, b?.anchored?.net);
  if (anchoredFs.length > 0) anchored.fs = anchoredFs;
  if (anchoredExec.length > 0) anchored.exec = anchoredExec;
  if (anchoredNet.length > 0) anchored.net = anchoredNet;
  if (Object.keys(anchored).length > 0) out.anchored = anchored;
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

/** The boundary check for a program's `os-grants`: an object. The Rust serde parse owns the shape. */
export const OsGrantsSchema = z.custom<OsGrants>((v) => typeof v === "object" && v !== null && !Array.isArray(v));

/** `deployment` — target name to the orbital names deployed there. */
export const DeploymentSchema = z.record(z.string(), z.array(z.string()));
export type Deployment = z.infer<typeof DeploymentSchema>;

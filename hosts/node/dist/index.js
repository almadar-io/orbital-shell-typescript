export { OrbitalServerRuntime, UnresolvedProgramError, createOrbitalServerRuntime } from './chunk-HUUPTHU2.js';
export { createProgramHandlers } from './chunk-W4SLHLHN.js';
export { GCS_ENDPOINT, KernelProgram, WORKSPACE_HMAC_KEY_ID, WORKSPACE_HMAC_SECRET, createNodeOsHost, emitPayload, kernelWorkspaceHost, processAnchors, resolveKernelDir, resolveProgramFile, workspaceBucketFromEnv, workspacesRoot } from './chunk-UZQ2N73M.js';
export { installNodeHostPorts, nodeCredentialScope, nodeNetPort, pinnedFetchNode, resolveHostNode } from './chunk-23YAOI6P.js';
export { initKernelSync, loadHttpKernel, loadInstalledKernel, loadKernelModule, loadNativeKernelModule, nativeMemoryOf, resolveNativeAddon } from './chunk-UBZT5LDW.js';
export { behaviorCatalog, behaviorCatalogSync, behaviorDependencies, behaviorDescribe, behaviorResolve, behaviorSource, mountBehaviorValue, mountTraitValue, programCompose, programEval, programPrint, programRead, programResolve, programResolveSchema, programStep, programValidate, runProgramEffect, workspaceAccessError } from './chunk-QLDWVDYK.js';
export { installWorkspaceHost, installedWorkspaceHost, uninstallWorkspaceHost, workspaceOwnerSegment } from './chunk-BWMLDDCL.js';
import { randomBytes } from 'crypto';
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { mkdir, open, rename, rm, readFile } from 'fs/promises';

var KEY_FILE = "dev-credential-master-key";
var HEX_KEY = /^[0-9a-f]{64}$/;
function loadOrCreateDevMasterKey(dir) {
  if (process.env.NODE_ENV === "production") {
    throw new Error("A generated dev master key is not permitted when NODE_ENV=production \u2014 set ALMADAR_CREDENTIAL_MASTER_KEY");
  }
  const path = join(dir, KEY_FILE);
  if (existsSync(path)) {
    const key2 = readFileSync(path, "utf8").trim();
    if (!HEX_KEY.test(key2)) throw new Error(`${path} is malformed (expected 64 hex characters)`);
    return key2;
  }
  mkdirSync(dir, { recursive: true });
  const key = randomBytes(32).toString("hex");
  writeFileSync(path, `${key}
`, { mode: 384, flag: "wx" });
  return key;
}
var KvFailure = class extends Error {
  constructor(kind, message) {
    super(message);
    this.kind = kind;
  }
  kind;
};
var LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;
var SEGMENT = /^[A-Za-z0-9._-]+$/;
function namespaceId(ns) {
  return `kv:${ns.app}:${ns.locale}:${ns.store}`;
}
function checkNamespace(ns) {
  for (const [what, seg] of [["app", ns.app], ["locale", ns.locale], ["store", ns.store]]) {
    if (!SEGMENT.test(seg) || seg === "." || seg === "..") throw new KvFailure("invalid", `kv ${what} name ${JSON.stringify(seg)} is not [A-Za-z0-9._-]+`);
  }
}
function checkString(what, s) {
  if (typeof s !== "string") throw new KvFailure("invalid", `kv ${what} must be a string`);
  if (LONE_SURROGATE.test(s)) throw new KvFailure("invalid", `kv ${what} is not valid UTF-8`);
  return s;
}
function checkJson(value, path) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new KvFailure("invalid", `kv value at ${path} is not a finite number`);
    return value;
  }
  if (Array.isArray(value)) return value.map((item, i) => checkJson(item, `${path}[${i}]`));
  if (typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    const out = {};
    for (const [k, v] of Object.entries(value)) Object.defineProperty(out, k, { value: checkJson(v, `${path}.${k}`), enumerable: true, writable: true, configurable: true });
    return out;
  }
  throw new KvFailure("invalid", `kv value at ${path} is not JSON`);
}
function byteCompare(a, b) {
  return Buffer.compare(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
}
function serialize(table) {
  const keys = [...table.keys()].sort(byteCompare);
  return `{${keys.map((k) => `${JSON.stringify(k)}:${JSON.stringify(table.get(k))}`).join(",")}}`;
}
function parseTable(text) {
  const parsed = JSON.parse(text);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new KvFailure("io", "kv store file is not a JSON object");
  const table = /* @__PURE__ */ new Map();
  for (const [k, v] of Object.entries(parsed)) table.set(k, checkJson(v, k));
  return table;
}
function memoryKvBackend() {
  const tables = /* @__PURE__ */ new Map();
  return {
    async load(ns) {
      return new Map(tables.get(namespaceId(ns)) ?? []);
    },
    async commit(ns, table) {
      tables.set(namespaceId(ns), new Map(table));
    }
  };
}
function isErrno(e, code) {
  return typeof e === "object" && e !== null && "code" in e && e.code === code;
}
function directoryKvBackend(stateDir) {
  const fileOf = (ns) => {
    const dir = join(stateDir, "kv", ns.app, ns.locale);
    return { dir, file: join(dir, `${ns.store}.json`) };
  };
  return {
    async load(ns) {
      const { file } = fileOf(ns);
      let text;
      try {
        text = await readFile(file, "utf8");
      } catch (e) {
        if (isErrno(e, "ENOENT")) return /* @__PURE__ */ new Map();
        throw new KvFailure("io", `kv read failed: ${e instanceof Error ? e.message : String(e)}`);
      }
      try {
        return parseTable(text);
      } catch (e) {
        if (e instanceof KvFailure) throw e;
        throw new KvFailure("io", `kv store file is corrupt: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
    async commit(ns, table) {
      const { dir, file } = fileOf(ns);
      const tmp = `${file}.tmp-${randomBytes(6).toString("hex")}`;
      try {
        await mkdir(dir, { recursive: true });
        const handle = await open(tmp, "w");
        try {
          await handle.writeFile(serialize(table), "utf8");
          await handle.sync();
        } finally {
          await handle.close();
        }
        await rename(tmp, file);
      } catch (e) {
        await rm(tmp, { force: true }).catch(() => void 0);
        throw new KvFailure("io", `kv write failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  };
}
function createKvHost(backend) {
  const tails = /* @__PURE__ */ new Map();
  const serialized = (ns, run) => {
    const id = namespaceId(ns);
    const next = (tails.get(id) ?? Promise.resolve()).then(run, run);
    tails.set(id, next.catch(() => void 0));
    return next;
  };
  const guard = async (run) => {
    try {
      return { ok: true, value: await run() };
    } catch (e) {
      if (e instanceof KvFailure) return { ok: false, error: e.message, kind: e.kind };
      return { ok: false, error: e instanceof Error ? e.message : String(e), kind: "io" };
    }
  };
  return {
    get: (ns, key) => guard(async () => {
      checkNamespace(ns);
      checkString("key", key);
      const table = await backend.load(ns);
      const value = table.get(key);
      return value === void 0 ? { found: false } : { found: true, value };
    }),
    put: (ns, key, value) => guard(() => {
      checkNamespace(ns);
      checkString("key", key);
      const checked = checkJson(value, "value");
      return serialized(ns, async () => {
        const table = await backend.load(ns);
        table.set(key, checked);
        await backend.commit(ns, table);
        return { storedKey: key };
      });
    }),
    delete: (ns, key) => guard(() => {
      checkNamespace(ns);
      checkString("key", key);
      return serialized(ns, async () => {
        const table = await backend.load(ns);
        const existed = table.delete(key);
        if (existed) await backend.commit(ns, table);
        return { existed };
      });
    }),
    scan: (ns, prefix, limit) => guard(async () => {
      checkNamespace(ns);
      checkString("prefix", prefix);
      if (limit !== void 0 && (!Number.isInteger(limit) || limit < 0)) throw new KvFailure("invalid", "kv scan limit must be a non-negative integer");
      const table = await backend.load(ns);
      const wanted = Buffer.from(prefix, "utf8");
      const hits = [...table.keys()].filter((k) => Buffer.from(k, "utf8").subarray(0, wanted.length).equals(wanted)).sort(byteCompare);
      const entries = [];
      for (const key of limit === void 0 ? hits : hits.slice(0, limit)) {
        const value = table.get(key);
        if (value !== void 0) entries.push({ key, value });
      }
      return { entries };
    }),
    batch: (ns, ops) => guard(() => {
      checkNamespace(ns);
      const checked = ops.map((op, i) => {
        const key = checkString(`batch op ${i} key`, op.key);
        if (op.kind === "put") return { kind: "put", key, value: checkJson(op.value, `ops[${i}].value`) };
        if (op.kind === "delete") return { kind: "delete", key };
        throw new KvFailure("invalid", `kv batch op ${i} has unknown kind`);
      });
      return serialized(ns, async () => {
        const table = await backend.load(ns);
        for (const op of checked) {
          if (op.kind === "put") table.set(op.key, op.value);
          else table.delete(op.key);
        }
        await backend.commit(ns, table);
        return { applied: checked.length };
      });
    })
  };
}

export { KvFailure, createKvHost, directoryKvBackend, loadOrCreateDevMasterKey, memoryKvBackend, namespaceId };

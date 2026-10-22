import { AsyncLocalStorage } from 'async_hooks';
import { isIP, createConnection } from 'net';
import { lookup } from 'dns/promises';
import { createHttpPorts, kernelOsGrants, InFlightCalls, KernelEngine, dispatchInbound, installNetPort, installCredentialScopeStorage, anchoredGrants, expandAnchor } from '@almadar/shell-web';
import { Agent, fetch } from 'undici';
import { randomBytes, randomUUID } from 'crypto';
import { existsSync, readFileSync, mkdirSync, writeFileSync, mkdtempSync, rmSync, constants as constants$1 } from 'fs';
import { join, relative, resolve, isAbsolute, sep, dirname } from 'path';
import { mkdir, open, rename, rm, readFile, lstat, chmod, stat, readlink, symlink, link, unlink, copyFile, readdir, rmdir, access, chown } from 'fs/promises';
import { constants, homedir, tmpdir, loadavg, uptime, machine, version, release, hostname, type, userInfo } from 'os';
import { createSocket } from 'dgram';
import { spawn, execFile, spawnSync } from 'child_process';
import { isatty } from 'tty';
import { createRequire } from 'module';
import { pathToFileURL } from 'url';
import { EventPayloadSchema, SExprSchema, CatalogEntrySchema, formatTraitValueLiteral, BehaviorDescriptionSchema, mergeCallSiteConfigOverrides, defaultPage, importsOf, dependencyGraphOf, DescribeTargetSchema, CatalogScopeSchema, tickEventKey, installKernelEvaluator, parseProgram, TraitDescriptionSchema } from '@almadar/core';
import { readLanguageBundle } from '@almadar/core/language-data';
import * as installedModule from '@almadar/kernel';
import { z } from 'zod';
import { createLogger } from '@almadar/logger';
import { resolveOrbBinary, discoverBehaviorPackages } from '@almadar/core/behavior-package';
import { composeAppFromFiles, orbitalImportResolver, atomTraitResolver, organismOrderResolver } from '@almadar/core/builders';
import { InMemoryPersistence } from '@almadar/db/mock';

// src/index.ts
var pinnedFetchNode = async (url, init, address) => {
  const dispatcher = new Agent({
    ...init.signal !== void 0 ? { headersTimeout: 0, bodyTimeout: 0 } : {},
    connect: {
      lookup: (_host, options, callback) => {
        const family = address.includes(":") ? 6 : 4;
        if (options.all === true) callback(null, [{ address, family }]);
        else callback(null, address, family);
      }
    }
  });
  try {
    return await fetch(url, { ...init, dispatcher });
  } finally {
    void dispatcher.close();
  }
};
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
var OsFailure = class extends Error {
  constructor(error) {
    super(error.message);
    this.error = error;
  }
  error;
};
function osFailure(kind, op, what) {
  return new OsFailure({ kind, message: `${op}: ${what}` });
}
function denied(op, what) {
  return osFailure("denied", op, what);
}
function invalid(op, what) {
  return osFailure("invalid", op, what);
}
function invalidArgument(op, i, expected) {
  return invalid(op, `argument ${i + 1} must be ${expected}`);
}
function argument(args, i, op, expected) {
  if (i >= args.length) return fail(invalid(op, `missing argument ${i + 1} (${expected})`));
  return args[i];
}
function fail(failure) {
  throw failure;
}
function argOpt(args, i) {
  return i < args.length && args[i] !== null ? args[i] : void 0;
}
function argStr(args, i, op) {
  const value = argument(args, i, op, "a string");
  return typeof value === "string" ? value : fail(invalidArgument(op, i, "a string"));
}
function argI64(args, i, op) {
  const value = argument(args, i, op, "an integer");
  if (typeof value === "number" && Number.isFinite(value) && Number.isInteger(value) && Math.abs(value) < 9007199254740992) return value;
  return fail(invalidArgument(op, i, "an integer"));
}
function argBool(args, i, op) {
  const value = argument(args, i, op, "a boolean");
  return typeof value === "boolean" ? value : fail(invalidArgument(op, i, "a boolean"));
}
var BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function decodeStandardBase64(text) {
  const symbols = text.endsWith("==") ? text.length - 2 : text.endsWith("=") ? text.length - 1 : text.length;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (i >= symbols) continue;
    if (BASE64_ALPHABET.indexOf(text[i]) === -1) return { failure: `Invalid byte ${code}, offset ${i}.` };
  }
  const padding = text.length - symbols;
  const remainder = symbols % 4;
  if (remainder === 1) return { failure: `Invalid input length: ${symbols}` };
  if (text.length % 4 !== 0 || remainder === 0 && padding !== 0 || remainder === 2 && padding !== 2 || remainder === 3 && padding !== 1) {
    return { failure: "Invalid padding" };
  }
  if (remainder === 2 || remainder === 3) {
    const last = BASE64_ALPHABET.indexOf(text[symbols - 1]);
    const spare = remainder === 2 ? 15 : 3;
    if ((last & spare) !== 0) return { failure: `Invalid last symbol ${text.charCodeAt(symbols - 1)}, offset ${symbols - 1}.` };
  }
  return { bytes: Buffer.from(text, "base64") };
}
function argBytes(args, i, op) {
  const decoded = decodeStandardBase64(argStr(args, i, op));
  if ("failure" in decoded) throw invalid(op, `argument ${i + 1} is not standard base64: ${decoded.failure}`);
  return decoded.bytes;
}
function bytesValue(bytes) {
  return Buffer.from(bytes).toString("base64");
}
var ERRNO = constants.errno;
var POSIX_TEXT = {
  EPERM: "Operation not permitted",
  ENOENT: "No such file or directory",
  ESRCH: "No such process",
  EINTR: "Interrupted system call",
  EIO: "Input/output error",
  E2BIG: "Argument list too long",
  EBADF: "Bad file descriptor",
  EAGAIN: "Resource temporarily unavailable",
  ENOMEM: "Cannot allocate memory",
  EACCES: "Permission denied",
  EBUSY: "Device or resource busy",
  EEXIST: "File exists",
  EXDEV: "Invalid cross-device link",
  ENOTDIR: "Not a directory",
  EISDIR: "Is a directory",
  EINVAL: "Invalid argument",
  EMFILE: "Too many open files",
  EFBIG: "File too large",
  ENOSPC: "No space left on device",
  ESPIPE: "Illegal seek",
  EROFS: "Read-only file system",
  EMLINK: "Too many links",
  EPIPE: "Broken pipe",
  ENAMETOOLONG: "File name too long",
  ENOTEMPTY: "Directory not empty",
  ELOOP: "Too many levels of symbolic links",
  EADDRINUSE: "Address already in use",
  EADDRNOTAVAIL: "Cannot assign requested address",
  ENETDOWN: "Network is down",
  ENETUNREACH: "Network is unreachable",
  ECONNABORTED: "Software caused connection abort",
  ECONNRESET: "Connection reset by peer",
  ENOTCONN: "Transport endpoint is not connected",
  ETIMEDOUT: "Connection timed out",
  ECONNREFUSED: "Connection refused",
  EHOSTUNREACH: "No route to host",
  EINPROGRESS: "Operation now in progress"
};
var DARWIN_TEXT = {
  EXDEV: "Cross-device link",
  EBUSY: "Resource busy",
  ENOTCONN: "Socket is not connected",
  ETIMEDOUT: "Operation timed out"
};
var TextIoError = class extends Error {
  constructor(code, text) {
    super(text);
    this.code = code;
  }
  code;
};
function errnoError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}
function errnoText(error) {
  if (error instanceof TextIoError) return error.message;
  const code = errnoCode(error);
  const number = code === void 0 ? void 0 : ERRNO[code];
  const text = code === void 0 ? void 0 : (process.platform === "darwin" ? DARWIN_TEXT[code] : void 0) ?? POSIX_TEXT[code];
  if (number === void 0 || text === void 0) return error.message;
  return `${text} (os error ${number})`;
}
function errnoCode(error) {
  const raised = error;
  return raised.code;
}
function fsKind(code) {
  switch (code) {
    case "ENOENT":
      return "not-found";
    case "EEXIST":
      return "exists";
    case "EACCES":
    case "EPERM":
      return "denied";
    case "ETIMEDOUT":
      return "timeout";
    case "EINVAL":
    case "EISDIR":
    case "ENOTDIR":
    case "ENAMETOOLONG":
    case "ELOOP":
    case "EBADF":
      return "invalid";
    default:
      return "io";
  }
}
function processKind(code) {
  switch (code) {
    case "ENOENT":
      return "not-found";
    case "EACCES":
    case "EPERM":
      return "denied";
    case "EINVAL":
      return "invalid";
    default:
      return "io";
  }
}
function netKind(code) {
  switch (code) {
    case "ENOENT":
      return "not-found";
    case "EACCES":
    case "EPERM":
      return "denied";
    case "ETIMEDOUT":
    case "EAGAIN":
    case "EWOULDBLOCK":
    case "EINPROGRESS":
      return "timeout";
    case "ECONNRESET":
    case "ECONNABORTED":
    case "EPIPE":
    case "ENOTCONN":
      return "closed";
    case "EADDRINUSE":
    case "EEXIST":
      return "exists";
    case "EINVAL":
      return "invalid";
    default:
      return "io";
  }
}
function processFailure(op, error) {
  return osFailure(processKind(errnoCode(error)), op, errnoText(error));
}
function netFailure(op, error) {
  return osFailure(netKind(errnoCode(error)), op, errnoText(error));
}
var ByteSource = class {
  constructor(stream, highWater) {
    this.stream = stream;
    this.highWater = highWater;
    stream.on("data", (chunk) => {
      this.chunks.push(chunk);
      this.held += chunk.length;
      if (this.held > this.highWater) stream.pause();
      this.notify();
    });
    stream.on("end", () => {
      this.ended = true;
      this.notify();
    });
    stream.on("error", (error) => {
      this.failure = error;
      this.notify();
    });
    stream.on("close", () => {
      this.ended = true;
      this.notify();
    });
  }
  stream;
  highWater;
  chunks = [];
  held = 0;
  ended = false;
  failure;
  wake;
  queue = Promise.resolve();
  notify() {
    const wake = this.wake;
    this.wake = void 0;
    wake?.();
  }
  /** One read at a time, as the native pipe lock does: a read that has not ended holds the next one back. */
  take(want, timeoutMs) {
    const run = this.queue.then(() => this.takeNow(want, timeoutMs));
    this.queue = run.then(() => void 0, () => void 0);
    return run;
  }
  /** At most `want` bytes of one read: what is held, else what arrives; empty at end of stream; `'timeout'` after `timeoutMs`. */
  async takeNow(want, timeoutMs) {
    if (want === 0) return Buffer.alloc(0);
    const deadline = timeoutMs === void 0 ? void 0 : Date.now() + timeoutMs;
    for (; ; ) {
      if (this.held > 0) return this.slice(want);
      if (this.failure !== void 0) throw this.failure;
      if (this.ended) return Buffer.alloc(0);
      const left = deadline === void 0 ? void 0 : deadline - Date.now();
      if (left !== void 0 && left <= 0) return "timeout";
      await new Promise((resolve3) => {
        const timer = left === void 0 ? void 0 : setTimeout(resolve3, left);
        this.wake = () => {
          if (timer !== void 0) clearTimeout(timer);
          resolve3();
        };
      });
    }
  }
  slice(want) {
    const parts = [];
    let need = want;
    while (need > 0 && this.chunks.length > 0) {
      const head = this.chunks[0];
      if (head.length <= need) {
        parts.push(head);
        need -= head.length;
        this.chunks.shift();
      } else {
        parts.push(head.subarray(0, need));
        this.chunks[0] = head.subarray(need);
        need = 0;
      }
    }
    const taken = Buffer.concat(parts);
    this.held -= taken.length;
    if (this.held <= this.highWater) this.stream.resume();
    return taken;
  }
  destroy() {
    this.stream.destroy();
  }
};
function writeAll(stream, data, timeoutMs) {
  return new Promise((resolve3, reject) => {
    const timer = setTimeout(() => reject(errnoError("EAGAIN")), timeoutMs);
    stream.write(data, (error) => {
      if (timer !== void 0) clearTimeout(timer);
      if (error) reject(error);
      else resolve3();
    });
  });
}
var Completions = class {
  live = /* @__PURE__ */ new Set();
  /** `false` when `key` already has a completion pending. */
  begin(key) {
    if (this.live.has(key)) return false;
    this.live.add(key);
    return true;
  }
  /** Drop the pending completion of `key`; `false` when none is pending. */
  cancel(key) {
    return this.live.delete(key);
  }
  /** Take the right to deliver `key`'s completion: `false` when it was cancelled first. */
  claim(key) {
    return this.live.delete(key);
  }
  clear() {
    this.live.clear();
  }
};
var FIRST_HANDLE_ID = 3;
var OsState = class {
  constructor(anchors = {}) {
    this.anchors = anchors;
  }
  anchors;
  next = FIRST_HANDLE_ID;
  fds = /* @__PURE__ */ new Map();
  socks = /* @__PURE__ */ new Map();
  children = /* @__PURE__ */ new Map();
  env = /* @__PURE__ */ new Map();
  completions = new Completions();
  cwd;
  allocate() {
    const id = this.next;
    this.next += 1;
    return id;
  }
  close() {
    this.completions.clear();
    for (const entry of this.children.values()) entry.child.kill("SIGKILL");
    this.children.clear();
    this.env.clear();
    for (const entry of this.fds.values()) closeFd(entry);
    this.fds.clear();
    this.cwd = void 0;
    for (const entry of this.socks.values()) closeSock(entry);
    this.socks.clear();
  }
};
function closeFd(entry) {
  if (entry.kind === "file") void entry.handle.close();
  else if (entry.kind === "child-stdin") entry.stream.end();
  else entry.source.destroy();
}
function closeSock(entry) {
  if (entry.kind === "stream") entry.socket.destroy();
  else entry.socket.close();
}
function byteOrder(a, b) {
  return Buffer.compare(Buffer.from(a), Buffer.from(b));
}

// src/os-node-fs.ts
var MAX_BYTES = 64 * 1024 * 1024;
var MAX_LINKS = 40;
var CHUNK = 1024 * 1024;
function kindOf(entry) {
  if (entry.isSymbolicLink()) return "symlink";
  if (entry.isDirectory()) return "dir";
  if (entry.isFile()) return "file";
  return "other";
}
function millis(ns) {
  let seconds = ns / 1000000000n;
  let nanos = ns % 1000000000n;
  if (nanos < 0n) {
    nanos += 1000000000n;
    seconds -= 1n;
  }
  return Number(seconds) * 1e3 + Number(nanos) / 1e6;
}
function statValue(entry) {
  return {
    kind: kindOf(entry),
    size: Number(entry.size),
    mode: Number(entry.mode & 0o7777n),
    uid: Number(entry.uid),
    gid: Number(entry.gid),
    atime: millis(entry.atimeNs),
    mtime: millis(entry.mtimeNs),
    ctime: millis(entry.ctimeNs)
  };
}
function lexical(path) {
  const kept = [];
  for (const part of path.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (kept.length === 0) return void 0;
      kept.pop();
      continue;
    }
    kept.push(part);
  }
  return `/${kept.join("/")}`;
}
function joinPath(directory, part) {
  return directory === "/" ? `/${part}` : `${directory}/${part}`;
}
function parentOf(path) {
  const cut = path.lastIndexOf("/");
  return cut <= 0 ? "/" : path.slice(0, cut);
}
function ancestorsOf(path) {
  const out = [];
  let at = path;
  for (; ; ) {
    out.push(at);
    if (at === "/") return out;
    at = parentOf(at);
  }
}
function components(path) {
  return path.split("/").filter((part) => part !== "" && part !== ".");
}
async function resolveReal(path, followLast) {
  const queue = components(path);
  let current = "/";
  let links = 0;
  while (queue.length > 0) {
    const part = queue.shift() ?? "";
    if (part === "..") {
      current = parentOf(current);
      continue;
    }
    const next = joinPath(current, part);
    const entry = await lstat(next).catch((raised) => raised);
    if (entry instanceof Error) {
      if (errnoCode(entry) === "ENOENT") {
        current = next;
        continue;
      }
      throw entry;
    }
    if (entry.isSymbolicLink() && (followLast || queue.length > 0)) {
      links += 1;
      if (links > MAX_LINKS) throw errnoError("ELOOP");
      const target = await readlink(next);
      if (target.startsWith("/")) current = "/";
      queue.unshift(...components(target));
    } else {
      current = next;
    }
  }
  return current;
}
function modeName(mode) {
  return mode.charAt(0).toUpperCase() + mode.slice(1);
}
var FS_OPS = /* @__PURE__ */ new Set([
  "os/read-file",
  "os/write-file",
  "os/append-file",
  "os/open",
  "os/close",
  "os/read",
  "os/write",
  "os/seek",
  "os/truncate",
  "os/fsync",
  "os/copy",
  "os/rename",
  "os/remove",
  "os/link",
  "os/symlink",
  "os/readlink",
  "os/watch-files",
  "os/mkdir",
  "os/rmdir",
  "os/list-dir",
  "os/glob",
  "os/mktemp",
  "os/realpath",
  "os/cwd",
  "os/chdir",
  "os/stat",
  "os/lstat",
  "os/access",
  "os/exists",
  "os/chmod",
  "os/chown",
  "os/utimes"
]);
function isFsOp(op) {
  return FS_OPS.has(op);
}
var FsOps = class {
  constructor(state, grants) {
    this.state = state;
    this.grants = grants;
  }
  state;
  grants;
  failure(op, kind, what) {
    return osFailure(kind, op, what);
  }
  io(op, path, error) {
    return this.failure(op, fsKind(errnoCode(error)), `${path}: ${errnoText(error)}`);
  }
  allow(op, path, mode) {
    if (!this.grants.allows({ need: "fs", path, mode })) {
      throw denied(op, `${path} is not granted for ${modeName(mode)}`);
    }
  }
  async locate(op, raw, mode, followLast) {
    if (raw === "") throw invalid(op, "empty path");
    const absolute = this.absolute(op, raw);
    const norm = lexical(absolute);
    if (norm === void 0) throw denied(op, `${raw} climbs above the root`);
    this.allow(op, norm, mode);
    const real = await resolveReal(norm, followLast).catch((raised) => {
      throw this.io(op, norm, raised);
    });
    if (real !== norm && !this.grants.allows({ need: "fs", path: real, mode })) {
      throw denied(op, `${norm} resolves to ${real}, outside the grant`);
    }
    return { norm, real };
  }
  absolute(op, raw) {
    const anchored = expandAnchor(this.state.anchors, raw);
    if (anchored.kind === "anchored") return anchored.path;
    if (anchored.kind === "unknown") throw invalid(op, anchored.message);
    if (raw.startsWith("/")) return raw;
    const cwd = this.state.cwd;
    if (cwd === void 0) throw invalid(op, `${raw} is relative and no working directory is set (os/chdir)`);
    return `${cwd}/${raw}`;
  }
  require(op, at, mode) {
    this.allow(op, at.norm, mode);
    if (at.real !== at.norm) this.allow(op, at.real, mode);
  }
  async path(op, raw, mode, followLast) {
    return (await this.locate(op, raw, mode, followLast)).real;
  }
  async missing(op, at) {
    const found = await lstat(at.real).catch((raised) => raised);
    if (!(found instanceof Error)) return false;
    if (errnoCode(found) === "ENOENT") return true;
    throw this.io(op, at.real, found);
  }
  async writeTarget(op, raw) {
    const at = await this.locate(op, raw, "write", true);
    if (await this.missing(op, at)) this.require(op, at, "create");
    return at.real;
  }
  modeArg(op, args, i) {
    if (argOpt(args, i) === void 0) return void 0;
    const mode = argI64(args, i, op);
    if (mode < 0 || mode > 4095) throw invalid(op, "mode must be within 0..=0o7777");
    return mode;
  }
  fdEntry(op, fd) {
    const entry = this.state.fds.get(fd);
    if (entry === void 0) throw osFailure("closed", op, `fd ${fd} is not open`);
    return entry;
  }
  fileEntry(op, fd) {
    const entry = this.fdEntry(op, fd);
    if (entry.kind !== "file") throw invalid(op, `fd ${fd} is a pipe, not a file`);
    return entry;
  }
  fdIo(op, raised) {
    return this.io(op, "fd", raised);
  }
  /** `None` of the native `answer`: an `os/close` of a handle this table does not own. */
  closeOwned(args) {
    const fd = argI64(args, 0, "os/close");
    const entry = this.state.fds.get(fd);
    if (fd < FIRST_HANDLE_ID || entry === void 0) return false;
    this.state.fds.delete(fd);
    closeFd(entry);
    return true;
  }
  async run(op, args) {
    switch (op) {
      case "os/read-file":
        return this.readFile(op, args);
      case "os/write-file":
        return this.writeFile(op, args, false);
      case "os/append-file":
        return this.writeFile(op, args, true);
      case "os/open":
        return this.open(op, args);
      case "os/read":
        return this.read(op, args);
      case "os/write":
        return this.write(op, args);
      case "os/seek":
        return this.seek(op, args);
      case "os/truncate":
        return this.truncate(op, args);
      case "os/fsync": {
        const entry = this.fileEntry(op, argI64(args, 0, op));
        await entry.handle.sync().catch((raised) => {
          throw this.fdIo(op, raised);
        });
        return {};
      }
      case "os/copy": {
        const from = await this.path(op, argStr(args, 0, op), "read", true);
        const to = await this.writeTarget(op, argStr(args, 1, op));
        await copyFile(from, to).catch((raised) => {
          throw this.io(op, from, raised);
        });
        return {};
      }
      case "os/rename": {
        const from = await this.path(op, argStr(args, 0, op), "remove", false);
        const to = await this.locate(op, argStr(args, 1, op), "create", false);
        if (!await this.missing(op, to)) this.require(op, to, "remove");
        await rename(from, to.real).catch((raised) => {
          throw this.io(op, from, raised);
        });
        return {};
      }
      case "os/remove": {
        const path = await this.path(op, argStr(args, 0, op), "remove", false);
        const entry = await lstat(path).catch((raised) => {
          throw this.io(op, path, raised);
        });
        if (entry.isDirectory()) throw invalid(op, `${path} is a directory; use os/rmdir`);
        await unlink(path).catch((raised) => {
          throw this.io(op, path, raised);
        });
        return {};
      }
      case "os/link": {
        const target = await this.path(op, argStr(args, 0, op), "write", true);
        const path = await this.path(op, argStr(args, 1, op), "create", false);
        await link(target, path).catch((raised) => {
          throw this.io(op, path, raised);
        });
        return {};
      }
      case "os/symlink": {
        const target = argStr(args, 0, op);
        const path = await this.path(op, argStr(args, 1, op), "create", false);
        await symlink(target, path).catch((raised) => {
          throw this.io(op, path, raised);
        });
        return {};
      }
      case "os/readlink": {
        const path = await this.path(op, argStr(args, 0, op), "read", false);
        const target = await readlink(path).catch((raised) => {
          throw this.io(op, path, raised);
        });
        return { target };
      }
      case "os/watch-files":
        throw this.failure(op, "unsupported", "streaming host not implemented");
      case "os/mkdir":
        return this.mkdir(op, args);
      case "os/rmdir":
        return this.rmdir(op, args);
      case "os/list-dir":
        return this.listDir(op, args);
      case "os/glob":
        return this.glob(op, args);
      case "os/mktemp":
        return this.mktemp(op, args);
      case "os/realpath": {
        const path = await this.path(op, argStr(args, 0, op), "read", true);
        await lstat(path).catch((raised) => {
          throw this.io(op, path, raised);
        });
        return { path };
      }
      case "os/cwd": {
        const cwd = this.state.cwd;
        if (cwd === void 0) throw invalid(op, "no working directory is set (os/chdir)");
        return { path: cwd };
      }
      case "os/chdir": {
        const path = await this.path(op, argStr(args, 0, op), "read", true);
        const entry = await stat(path).catch((raised) => {
          throw this.io(op, path, raised);
        });
        if (!entry.isDirectory()) throw invalid(op, `${path} is not a directory`);
        this.state.cwd = path;
        return {};
      }
      case "os/stat":
      case "os/lstat": {
        const follow = op === "os/stat";
        const path = await this.path(op, argStr(args, 0, op), "read", follow);
        const read = follow ? stat : lstat;
        const entry = await read(path, { bigint: true }).catch((raised) => {
          throw this.io(op, path, raised);
        });
        return statValue(entry);
      }
      case "os/access":
        return this.access(op, args);
      case "os/exists": {
        const path = await this.path(op, argStr(args, 0, op), "read", true);
        const present = await stat(path).then(() => true, () => false);
        return { ok: present };
      }
      case "os/chmod": {
        const path = await this.path(op, argStr(args, 0, op), "meta", true);
        const mode = this.modeArg(op, args, 1);
        if (mode === void 0) throw invalid(op, "missing mode");
        await chmod(path, mode).catch((raised) => {
          throw this.io(op, path, raised);
        });
        return {};
      }
      case "os/chown":
        return this.chown(op, args);
      case "os/utimes":
        return this.utimes(op, args);
      default:
        throw this.failure(op, "unsupported", "not a file operation");
    }
  }
  async readFile(op, args) {
    const path = await this.path(op, argStr(args, 0, op), "read", true);
    const handle = await open(path, "r").catch((raised) => {
      throw this.io(op, path, raised);
    });
    const parts = [];
    let total = 0;
    try {
      while (total < MAX_BYTES + 1) {
        const chunk = Buffer.allocUnsafe(Math.min(CHUNK, MAX_BYTES + 1 - total));
        const { bytesRead } = await handle.read(chunk, 0, chunk.length, null);
        if (bytesRead === 0) break;
        parts.push(chunk.subarray(0, bytesRead));
        total += bytesRead;
      }
    } catch (raised) {
      throw this.io(op, path, raised instanceof Error ? raised : new Error(String(raised)));
    } finally {
      await handle.close();
    }
    if (total > MAX_BYTES) {
      throw invalid(op, `${path} exceeds the ${MAX_BYTES}-byte (64 MiB) per-call cap; use os/open and os/read`);
    }
    return { data: bytesValue(Buffer.concat(parts)) };
  }
  async writeFile(op, args, append) {
    const path = await this.writeTarget(op, argStr(args, 0, op));
    const data = argBytes(args, 1, op);
    const mode = this.modeArg(op, args, 2);
    const flags = constants$1.O_WRONLY | constants$1.O_CREAT | (append ? constants$1.O_APPEND : constants$1.O_TRUNC);
    const handle = await open(path, flags, mode).catch((raised) => {
      throw this.io(op, path, raised);
    });
    try {
      let written = 0;
      while (written < data.length) {
        const { bytesWritten } = await handle.write(data, written, data.length - written, null);
        written += bytesWritten;
      }
    } catch (raised) {
      throw this.io(op, path, raised instanceof Error ? raised : new Error(String(raised)));
    } finally {
      await handle.close();
    }
    return { bytes: data.length };
  }
  parseFlags(op, flags) {
    const exclusive = flags.endsWith("x");
    const base = exclusive ? flags.slice(0, -1) : flags;
    let parsed;
    switch (base) {
      case "r":
        parsed = { read: true, write: false, append: false, create: false, truncate: false };
        break;
      case "r+":
        parsed = { read: true, write: true, append: false, create: false, truncate: false };
        break;
      case "w":
        parsed = { read: false, write: true, append: false, create: true, truncate: true };
        break;
      case "w+":
        parsed = { read: true, write: true, append: false, create: true, truncate: true };
        break;
      case "a":
        parsed = { read: false, write: true, append: true, create: true, truncate: false };
        break;
      case "a+":
        parsed = { read: true, write: true, append: true, create: true, truncate: false };
        break;
      default:
        throw invalid(op, `flags ${JSON.stringify(flags)} must be one of r r+ w w+ a a+, optionally followed by x`);
    }
    if (exclusive && !parsed.create) throw invalid(op, "the x flag needs w or a");
    return { ...parsed, exclusive };
  }
  async open(op, args) {
    const raw = argStr(args, 0, op);
    const flags = this.parseFlags(op, argStr(args, 1, op));
    const mode = this.modeArg(op, args, 2);
    const at = await this.locate(op, raw, flags.write ? "write" : "read", true);
    if (flags.read && flags.write) this.require(op, at, "read");
    if (flags.create && (flags.exclusive || await this.missing(op, at))) this.require(op, at, "create");
    let access2 = constants$1.O_RDONLY;
    if (flags.write) access2 = flags.read ? constants$1.O_RDWR : constants$1.O_WRONLY;
    let numeric = access2;
    if (flags.append) numeric |= constants$1.O_APPEND;
    if (flags.truncate) numeric |= constants$1.O_TRUNC;
    if (flags.exclusive) numeric |= constants$1.O_CREAT | constants$1.O_EXCL;
    else if (flags.create) numeric |= constants$1.O_CREAT;
    const handle = await open(at.real, numeric, mode).catch((raised) => {
      throw this.io(op, at.real, raised);
    });
    const fd = this.state.allocate();
    this.state.fds.set(fd, { kind: "file", handle, position: 0, append: flags.append });
    return { fd };
  }
  async read(op, args) {
    return (await this.readLater(op, args)())();
  }
  /** `os/read` after its checks; a keyed ask under a route runs the returned work in the background (EXEC-QUEUE-10). */
  readLater(op, args) {
    const fd = argI64(args, 0, op);
    const count = argI64(args, 1, op);
    if (count < 0 || count > MAX_BYTES) {
      throw invalid(op, `count must be within 0..=${MAX_BYTES} (64 MiB per-call cap)`);
    }
    const entry = this.fdEntry(op, fd);
    if (entry.kind === "child-stdin") throw invalid(op, `fd ${fd} is write-only`);
    return async () => {
      let data;
      if (entry.kind === "file") {
        const parts = [];
        let total = 0;
        try {
          while (total < count) {
            const chunk = Buffer.allocUnsafe(Math.min(CHUNK, count - total));
            const { bytesRead } = await entry.handle.read(chunk, 0, chunk.length, entry.position);
            if (bytesRead === 0) break;
            parts.push(chunk.subarray(0, bytesRead));
            total += bytesRead;
            entry.position += bytesRead;
          }
        } catch (raised) {
          throw this.fdIo(op, raised instanceof Error ? raised : new Error(String(raised)));
        }
        data = Buffer.concat(parts);
      } else {
        try {
          const taken = await entry.source.take(count, void 0);
          data = taken === "timeout" ? Buffer.alloc(0) : taken;
        } catch (raised) {
          throw this.fdIo(op, raised instanceof Error ? raised : new Error(String(raised)));
        }
      }
      const answer = { data: bytesValue(data), eof: count > 0 && data.length === 0 };
      return () => answer;
    };
  }
  async write(op, args) {
    const fd = argI64(args, 0, op);
    const data = argBytes(args, 1, op);
    const entry = this.fdEntry(op, fd);
    if (entry.kind === "file") {
      try {
        let written = 0;
        while (written < data.length) {
          const position = entry.append ? null : entry.position;
          const { bytesWritten } = await entry.handle.write(data, written, data.length - written, position);
          written += bytesWritten;
          if (!entry.append) entry.position += bytesWritten;
        }
        if (entry.append) entry.position = (await entry.handle.stat()).size;
      } catch (raised) {
        throw this.fdIo(op, raised instanceof Error ? raised : new Error(String(raised)));
      }
    } else if (entry.kind === "child-stdin") {
      const { stream } = entry;
      await new Promise((resolve3, reject) => {
        stream.write(data, (error) => error ? reject(error) : resolve3());
      }).catch((raised) => {
        throw this.fdIo(op, raised);
      });
    } else {
      throw invalid(op, `fd ${fd} is read-only`);
    }
    return { bytes: data.length };
  }
  async seek(op, args) {
    const fd = argI64(args, 0, op);
    const offset = argI64(args, 1, op);
    const whence = argStr(args, 2, op);
    if (whence !== "set" && whence !== "cur" && whence !== "end") {
      throw invalid(op, `whence ${JSON.stringify(whence)} must be set, cur or end`);
    }
    if (whence === "set" && offset < 0) throw invalid(op, "a set offset cannot be negative");
    const entry = this.fileEntry(op, fd);
    let target = offset;
    if (whence === "cur") target = entry.position + offset;
    if (whence === "end") {
      const size = (await entry.handle.stat().catch((raised) => {
        throw this.fdIo(op, raised);
      })).size;
      target = size + offset;
    }
    if (target < 0) throw this.fdIo(op, errnoError("EINVAL"));
    entry.position = target;
    return { offset: target };
  }
  async truncate(op, args) {
    const size = argI64(args, 1, op);
    if (size < 0) throw invalid(op, "size cannot be negative");
    if (typeof args[0] === "number") {
      const entry = this.fileEntry(op, argI64(args, 0, op));
      await entry.handle.truncate(size).catch((raised) => {
        throw this.fdIo(op, raised);
      });
      return {};
    }
    const path = await this.path(op, argStr(args, 0, op), "write", true);
    const handle = await open(path, constants$1.O_WRONLY).catch((raised) => {
      throw this.io(op, path, raised);
    });
    try {
      await handle.truncate(size);
    } catch (raised) {
      throw this.io(op, path, raised instanceof Error ? raised : new Error(String(raised)));
    } finally {
      await handle.close();
    }
    return {};
  }
  async mkdir(op, args) {
    const at = await this.locate(op, argStr(args, 0, op), "create", false);
    const recursive = argOpt(args, 1) === void 0 ? false : argBool(args, 1, op);
    const mode = this.modeArg(op, args, 2);
    if (recursive) {
      for (const ancestor of ancestorsOf(at.real)) {
        const present = await lstat(ancestor).then(() => true, () => false);
        if (!present) this.allow(op, ancestor, "create");
      }
    }
    await mkdir(at.real, { recursive, mode }).catch((raised) => {
      throw this.io(op, at.real, raised);
    });
    return {};
  }
  async requireTreeRemovable(op, directory) {
    const entries = await readdir(directory, { withFileTypes: true }).catch((raised) => {
      throw this.io(op, directory, raised);
    });
    for (const entry of entries) {
      const path = joinPath(directory, entry.name);
      this.allow(op, path, "remove");
      if (entry.isDirectory()) await this.requireTreeRemovable(op, path);
    }
  }
  async rmdir(op, args) {
    const path = await this.path(op, argStr(args, 0, op), "remove", false);
    const recursive = argOpt(args, 1) === void 0 ? false : argBool(args, 1, op);
    const entry = await lstat(path).catch((raised) => {
      throw this.io(op, path, raised);
    });
    if (!entry.isDirectory()) throw invalid(op, `${path} is not a directory; use os/remove`);
    if (recursive) {
      await this.requireTreeRemovable(op, path);
      await rm(path, { recursive: true }).catch((raised) => {
        throw this.io(op, path, raised);
      });
    } else {
      await rmdir(path).catch((raised) => {
        throw this.io(op, path, raised);
      });
    }
    return {};
  }
  async listDir(op, args) {
    const path = await this.path(op, argStr(args, 0, op), "read", true);
    const found = await readdir(path, { withFileTypes: true }).catch((raised) => {
      throw this.io(op, path, raised);
    });
    const entries = found.map((entry) => ({ name: entry.name, kind: kindOf(entry) })).sort((a, b) => byteOrder(a.name, b.name) || byteOrder(a.kind, b.kind));
    return { entries };
  }
  async glob(op, args) {
    const raw = argStr(args, 0, op);
    if (raw === "") throw invalid(op, "empty pattern");
    const pattern = lexical(this.absolute(op, raw));
    if (pattern === void 0) throw denied(op, `${raw} climbs above the root`);
    const fixed = [];
    let rest = 0;
    let wild = false;
    let deep = false;
    for (const part of components(pattern)) {
      if (wild || part.includes("*") || part.includes("?")) {
        wild = true;
        rest += 1;
        deep = deep || part === "**";
      } else {
        fixed.push(part);
      }
    }
    const prefix = `/${fixed.join("/")}`;
    this.allow(op, prefix, "read");
    const found = [];
    await this.consider(prefix, pattern, found);
    if (wild) await this.walk(prefix, 1, deep ? void 0 : rest, pattern, found);
    const sorted = [...new Set(found)].sort(byteOrder);
    return { paths: sorted };
  }
  async consider(path, pattern, out) {
    if (!this.grants.globMatches(pattern, path) || !this.grants.allows({ need: "fs", path, mode: "read" })) return;
    const real = await resolveReal(path, true).catch((raised) => raised);
    if (real instanceof Error) return;
    if (real !== path && !this.grants.allows({ need: "fs", path: real, mode: "read" })) return;
    if (await lstat(path).then(() => true, () => false)) out.push(path);
  }
  async walk(directory, level, maxLevel, pattern, out) {
    const entries = await readdir(directory, { withFileTypes: true }).catch((raised) => raised);
    if (entries instanceof Error) return;
    const children = entries.map((entry) => ({ path: joinPath(directory, entry.name), isDir: entry.isDirectory() })).sort((a, b) => byteOrder(a.path, b.path));
    for (const child of children) {
      await this.consider(child.path, pattern, out);
      if (child.isDir && (maxLevel === void 0 || level < maxLevel)) {
        await this.walk(child.path, level + 1, maxLevel, pattern, out);
      }
    }
  }
  async mktemp(op, args) {
    const prefix = argStr(args, 0, op);
    if (prefix.includes("/") || prefix.includes("\0") || prefix === ".." || prefix === ".") {
      throw invalid(op, "prefix must be a plain file-name prefix");
    }
    const base = argOpt(args, 1) === void 0 ? process.env.TMPDIR ?? "/tmp" : argStr(args, 1, op);
    const at = await this.locate(op, base, "create", true);
    for (let attempt = 0; attempt < 64; attempt += 1) {
      const candidate = joinPath(at.real, `${prefix}${randomBytes(8).toString("hex")}`);
      const handle = await open(candidate, constants$1.O_WRONLY | constants$1.O_CREAT | constants$1.O_EXCL, 384).catch((raised) => raised);
      if (handle instanceof Error) {
        if (errnoCode(handle) === "EEXIST") continue;
        throw this.io(op, candidate, handle);
      }
      await handle.close();
      return { path: candidate };
    }
    throw this.failure(op, "io", "could not find an unused temporary name");
  }
  async access(op, args) {
    const path = await this.path(op, argStr(args, 0, op), "read", true);
    let flags = constants$1.F_OK;
    if (argOpt(args, 1) !== void 0) {
      const mode = argStr(args, 1, op);
      if (mode === "exists") flags = constants$1.F_OK;
      else if (mode === "read") flags = constants$1.R_OK;
      else if (mode === "write") flags = constants$1.W_OK;
      else if (mode === "exec" || mode === "execute") flags = constants$1.X_OK;
      else if (mode !== "" && [...mode].every((letter) => "rwx".includes(letter))) {
        flags = 0;
        for (const letter of mode) {
          flags |= letter === "r" ? constants$1.R_OK : letter === "w" ? constants$1.W_OK : constants$1.X_OK;
        }
      } else {
        throw invalid(op, `mode ${JSON.stringify(mode)} must be exists, read, write, exec or letters of rwx`);
      }
    }
    const outcome = await access(path, flags).then(() => void 0, (raised) => raised);
    if (outcome === void 0) return { ok: true };
    const code = errnoCode(outcome);
    if (code === "ENOENT" || code === "EACCES" || code === "EPERM") return { ok: false };
    throw this.io(op, path, outcome);
  }
  async chown(op, args) {
    const path = await this.path(op, argStr(args, 0, op), "meta", true);
    const id = (i) => {
      const value = argI64(args, i, op);
      if (value === -1) return -1;
      if (value < 0 || value >= 4294967295) throw invalid(op, "uid and gid must be -1 or a valid id");
      return value;
    };
    const uid = id(1);
    const gid = id(2);
    await chown(path, uid, gid).catch((raised) => {
      throw this.io(op, path, raised);
    });
    return {};
  }
  async utimes(op, args) {
    const path = await this.path(op, argStr(args, 0, op), "meta", true);
    const accessed = new Date(argI64(args, 1, op));
    const modified = new Date(argI64(args, 2, op));
    if (Number.isNaN(accessed.getTime())) throw invalid(op, "atime is out of range");
    if (Number.isNaN(modified.getTime())) throw invalid(op, "mtime is out of range");
    const handle = await open(path, "r").catch((raised) => {
      throw this.io(op, path, raised);
    });
    try {
      await handle.utimes(accessed, modified);
    } catch (raised) {
      throw this.io(op, path, raised instanceof Error ? raised : new Error(String(raised)));
    } finally {
      await handle.close();
    }
    return {};
  }
};
var IO_TIMEOUT_MS = 5e3;
var CONNECT_TIMEOUT_MS = 1e4;
var MAX_RECV = 64 * 1024 * 1024;
var MAX_DATAGRAM = 65535;
var SOCKET_HIGH_WATER = 1024 * 1024;
var NET_OPS = /* @__PURE__ */ new Set([
  "os/tcp-connect",
  "os/tcp-listen",
  "os/send",
  "os/recv",
  "os/udp-bind",
  "os/sendto",
  "os/recvfrom",
  "os/dns-resolve",
  "os/shutdown",
  "os/watch-port"
]);
function isNetOp(op) {
  return NET_OPS.has(op);
}
var LOOKUP_FAILED = process.platform === "darwin" ? "nodename nor servname provided, or not known" : "Name or service not known";
function hostArg(args, i, op) {
  const name = argStr(args, i, op).replace(/^\[+/, "").replace(/\]+$/, "");
  if (name === "") throw osFailure("invalid", op, "the host is empty");
  return name;
}
function portArg(args, i, op) {
  const port = argI64(args, i, op);
  if (port < 0 || port > 65535) throw osFailure("invalid", op, "the port must be 0 to 65535");
  return port;
}
function countArg(args, i, op) {
  const count = argI64(args, i, op);
  if (count < 0) throw osFailure("invalid", op, "the count must not be negative");
  return count;
}
function peerText(address, port, family) {
  return family === "IPv6" ? `[${address}]:${port}` : `${address}:${port}`;
}
function streamFailure(op, error) {
  const code = errnoCode(error);
  return netFailure(op, code !== void 0 && code.startsWith("ERR_STREAM") ? errnoError("EPIPE") : error);
}
var NetOps = class {
  constructor(state, grants) {
    this.state = state;
    this.grants = grants;
  }
  state;
  grants;
  checkGrant(op, name, port, kind) {
    if (!this.grants.allows({ need: "net", host: name, port, kinds: [kind] })) {
      throw denied(op, `${name}:${port} is not granted`);
    }
  }
  async resolve(op, name) {
    const found = await lookup(name, { all: true, verbatim: true }).catch((raised) => raised);
    if (found instanceof Error) {
      const text = errnoCode(found) === "ENOTFOUND" ? `failed to lookup address information: ${LOOKUP_FAILED}` : found.message;
      throw osFailure("not-found", op, `${name} did not resolve: ${text}`);
    }
    if (found.length === 0) throw osFailure("not-found", op, `${name} has no addresses`);
    return found.map((entry) => ({ address: entry.address, family: entry.family === 6 ? 6 : 4 }));
  }
  async outbound(op, name) {
    const literal = isIP(name);
    if (literal !== 0) return [{ address: name, family: literal === 6 ? 6 : 4 }];
    const addresses = await this.resolve(op, name);
    const closed = addresses.find((entry) => !this.grants.isPublicAddress(entry.address));
    if (closed !== void 0) throw denied(op, `${name} resolves to ${closed.address}, not a public address`);
    return addresses;
  }
  streamEntry(op, id) {
    const entry = this.state.socks.get(id);
    if (entry === void 0) throw osFailure("closed", op, "not an open socket");
    if (entry.kind !== "stream") throw osFailure("invalid", op, "not a connected stream socket");
    return entry;
  }
  datagramEntry(op, id) {
    const entry = this.state.socks.get(id);
    if (entry === void 0) throw osFailure("closed", op, "not an open socket");
    if (entry.kind !== "datagram") throw osFailure("invalid", op, "not a datagram socket");
    return entry;
  }
  /** `None` of the native `answer`: an `os/close` of a handle this table does not own. */
  closeOwned(args) {
    const id = argI64(args, 0, "os/close");
    const entry = this.state.socks.get(id);
    if (entry === void 0) return false;
    this.state.socks.delete(id);
    if (entry.kind === "stream") entry.socket.destroy();
    else entry.socket.close();
    return true;
  }
  async run(op, args) {
    switch (op) {
      case "os/tcp-connect":
        return this.tcpConnect(op, args);
      case "os/send":
        return this.send(op, args);
      case "os/recv":
        return this.recv(op, args);
      case "os/udp-bind":
        return this.udpBind(op, args);
      case "os/sendto":
        return this.sendto(op, args);
      case "os/recvfrom":
        return this.recvfrom(op, args);
      case "os/dns-resolve":
        return this.dnsResolve(op, args);
      case "os/shutdown":
        return this.shutdown(op, args);
      default:
        throw osFailure("unsupported", op, "streaming host not implemented");
    }
  }
  connectOnce(address, port) {
    return new Promise((resolve3, reject) => {
      const socket = createConnection({ host: address.address, port, autoSelectFamily: false });
      const timer = setTimeout(() => {
        socket.destroy();
        reject(new TextIoError("ETIMEDOUT", "connection timed out"));
      }, CONNECT_TIMEOUT_MS);
      socket.once("connect", () => {
        clearTimeout(timer);
        resolve3(socket);
      });
      socket.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
  }
  async tcpConnect(op, args) {
    const name = hostArg(args, 0, op);
    const port = portArg(args, 1, op);
    this.checkGrant(op, name, port, "tcp");
    let last;
    for (const address of await this.outbound(op, name)) {
      const outcome = await this.connectOnce(address, port).catch((raised) => raised);
      if (outcome instanceof Error) {
        last = outcome;
        continue;
      }
      const id = this.state.allocate();
      this.state.socks.set(id, { kind: "stream", socket: outcome, source: new ByteSource(outcome, SOCKET_HIGH_WATER), shut: false });
      return { sock: id };
    }
    if (last === void 0) throw osFailure("io", op, "no address to connect to");
    throw netFailure(op, last);
  }
  async send(op, args) {
    return (await this.sendLater(op, args)())();
  }
  /** `os/send` after its checks; a keyed ask under a route writes in the background (EXEC-QUEUE-12). The write is queued before the first await, so the socket's write queue keeps sends in call order. */
  sendLater(op, args) {
    const id = argI64(args, 0, op);
    const data = argBytes(args, 1, op);
    const entry = this.streamEntry(op, id);
    if (entry.shut) throw netFailure(op, errnoError("EPIPE"));
    return async () => {
      await writeAll(entry.socket, data, IO_TIMEOUT_MS).catch((raised) => {
        throw streamFailure(op, raised);
      });
      const answer = { bytes: data.length };
      return () => answer;
    };
  }
  async recv(op, args) {
    return (await this.recvLater(op, args)())();
  }
  /** `os/recv` after its checks; a keyed ask under a route reads in the background (EXEC-QUEUE-10). */
  recvLater(op, args) {
    const id = argI64(args, 0, op);
    const want = Math.min(countArg(args, 1, op), MAX_RECV);
    const entry = this.streamEntry(op, id);
    return async () => {
      if (entry.shut) {
        const ended = { data: bytesValue(Buffer.alloc(0)), eof: want > 0 };
        return () => ended;
      }
      const taken = await entry.source.take(want, IO_TIMEOUT_MS).catch((raised) => {
        throw netFailure(op, raised);
      });
      if (taken === "timeout") throw netFailure(op, errnoError("EAGAIN"));
      const answer = { data: bytesValue(taken), eof: taken.length === 0 && want > 0 };
      return () => answer;
    };
  }
  bindOnce(address, port) {
    return new Promise((resolve3, reject) => {
      const socket = createSocket(address.family === 6 ? "udp6" : "udp4");
      const entry = { kind: "datagram", socket, inbox: [], failure: void 0, wake: void 0 };
      socket.on("message", (data, info) => {
        entry.inbox.push({ data, peer: peerText(info.address, info.port, info.family) });
        entry.wake?.();
      });
      socket.on("error", (error) => {
        entry.failure = error;
        entry.wake?.();
        reject(error);
      });
      socket.once("listening", () => resolve3(entry));
      socket.bind(port, address.address);
    });
  }
  async udpBind(op, args) {
    const name = hostArg(args, 0, op);
    const port = portArg(args, 1, op);
    this.checkGrant(op, name, port, "udp");
    let last;
    for (const address of await this.resolve(op, name)) {
      const bound = await this.bindOnce(address, port).catch((raised) => raised);
      if (bound instanceof Error) {
        last = bound;
        continue;
      }
      const id = this.state.allocate();
      this.state.socks.set(id, bound);
      return { sock: id };
    }
    throw last === void 0 ? osFailure("io", op, "no address to bind") : netFailure(op, last);
  }
  async sendto(op, args) {
    const id = argI64(args, 0, op);
    const data = argBytes(args, 1, op);
    const name = hostArg(args, 2, op);
    const port = portArg(args, 3, op);
    this.checkGrant(op, name, port, "udp");
    const entry = this.datagramEntry(op, id);
    let last;
    for (const address of await this.outbound(op, name)) {
      const sent = await new Promise((resolve3) => {
        entry.socket.send(data, port, address.address, (error) => resolve3(error ?? void 0));
      });
      if (sent === void 0) return { bytes: data.length };
      last = sent;
    }
    throw last === void 0 ? osFailure("io", op, "no address to send to") : netFailure(op, last);
  }
  async nextDatagram(entry) {
    const deadline = Date.now() + IO_TIMEOUT_MS;
    for (; ; ) {
      const queued = entry.inbox.shift();
      if (queued !== void 0) return queued;
      if (entry.failure !== void 0) return entry.failure;
      const left = deadline - Date.now();
      if (left <= 0) return errnoError("EAGAIN");
      await new Promise((resolve3) => {
        const timer = setTimeout(resolve3, left);
        entry.wake = () => {
          clearTimeout(timer);
          resolve3();
        };
      });
    }
  }
  async recvfrom(op, args) {
    return (await this.recvfromLater(op, args)())();
  }
  /** `os/recvfrom` after its checks; a keyed ask under a route reads in the background (EXEC-QUEUE-10). */
  recvfromLater(op, args) {
    const id = argI64(args, 0, op);
    const want = Math.min(countArg(args, 1, op), MAX_RECV, MAX_DATAGRAM);
    const entry = this.datagramEntry(op, id);
    return async () => {
      const received = await this.nextDatagram(entry);
      if (received instanceof Error) throw netFailure(op, received);
      const answer = { data: bytesValue(received.data.subarray(0, want)), peer: received.peer };
      return () => answer;
    };
  }
  async dnsResolve(op, args) {
    const name = hostArg(args, 0, op);
    let family;
    if (argOpt(args, 1) !== void 0) {
      family = argI64(args, 1, op);
      if (family !== 4 && family !== 6) throw invalid(op, "the family must be 4 or 6");
    }
    if (!this.grants.allows({ need: "net", host: name, port: 0, kinds: ["tcp", "udp"] })) {
      throw denied(op, `${name}:0 is not granted`);
    }
    const seen = [];
    for (const entry of await this.resolve(op, name)) {
      const wanted = family === void 0 || family === entry.family;
      if (wanted && !seen.includes(entry.address)) seen.push(entry.address);
    }
    if (seen.length === 0) throw osFailure("not-found", op, `${name} has no address of that family`);
    return { addresses: seen };
  }
  shutdown(op, args) {
    const id = argI64(args, 0, op);
    const entry = this.streamEntry(op, id);
    if (entry.socket.destroyed) throw netFailure(op, errnoError("ENOTCONN"));
    entry.socket.end();
    entry.shut = true;
    return {};
  }
};
var PROCESS_OPS = /* @__PURE__ */ new Set([
  "os/spawn",
  "os/wait",
  "os/kill",
  "os/pid",
  "os/ppid",
  "os/watch-process",
  "os/watch-signal",
  "os/getenv",
  "os/setenv",
  "os/unsetenv",
  "os/environ",
  "os/watch-env",
  "os/stdin-read",
  "os/stdout-write",
  "os/stderr-write",
  "os/isatty",
  "os/tty-size"
]);
function isProcessOp(op) {
  return PROCESS_OPS.has(op);
}
var PIPE_HIGH_WATER = 1024 * 1024;
var SIGNALS = constants.signals;
var SIGNAL_SET = ["TERM", "KILL", "INT", "HUP", "QUIT", "USR1", "USR2", "STOP", "CONT"].map(
  (name) => [name, SIGNALS[`SIG${name}`]]
);
function validEnvName(name) {
  return name !== "" && !name.includes("=") && !name.includes("\0");
}
function isJsonRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
var ProcessOps = class {
  constructor(state, grants) {
    this.state = state;
    this.grants = grants;
  }
  state;
  grants;
  lookupEnv(name) {
    if (this.state.env.has(name)) return this.state.env.get(name) ?? null;
    return process.env[name] ?? null;
  }
  envGranted(op, name) {
    if (!this.grants.allows({ need: "env", name })) throw denied(op, `environment ${name} is not granted`);
  }
  stdioMode(options, key, kind) {
    const op = "os/spawn";
    const given = options?.[key];
    let mode = "null";
    if (given === void 0 || given === null) {
      mode = "null";
    } else if (typeof given === "string") {
      if (given !== "inherit" && given !== "pipe" && given !== "null") {
        throw invalid(op, `${key} must be inherit, pipe or null, got ${given}`);
      }
      mode = given;
    } else {
      throw invalid(op, `${key} must be a string`);
    }
    if (mode === "inherit" && !this.grants.allows({ need: "stdio", kind })) {
      throw denied(op, `inheriting ${key} is not granted`);
    }
    return mode;
  }
  async run(op, args) {
    switch (op) {
      case "os/spawn":
        return this.spawn(args);
      case "os/wait":
        return this.wait(args);
      case "os/kill":
        return this.kill(args);
      case "os/pid":
        return { pid: process.pid };
      case "os/ppid":
        return { pid: process.ppid };
      case "os/getenv": {
        const name = argStr(args, 0, op);
        this.envGranted(op, name);
        return { value: this.lookupEnv(name) };
      }
      case "os/setenv":
      case "os/unsetenv":
        return this.setenv(op, args, op === "os/setenv");
      case "os/environ":
        return this.environ();
      case "os/stdout-write":
        return this.writeStdio(op, args, false);
      case "os/stderr-write":
        return this.writeStdio(op, args, true);
      case "os/isatty":
        return { ok: isatty(this.stdFd(op, args)) };
      case "os/tty-size":
        return this.ttySize(op, args);
      case "os/watch-process":
      case "os/watch-signal":
      case "os/watch-env":
        throw osFailure("unsupported", op, "streaming host not implemented");
      default:
        throw osFailure("unsupported", op, "the Node os host does not answer this operation yet (G-ORB-308)");
    }
  }
  async spawn(args) {
    const op = "os/spawn";
    const command = argStr(args, 0, op);
    const listed = args[1];
    if (!Array.isArray(listed) || !listed.every((item) => typeof item === "string")) {
      throw invalid(op, "argument 2 must be a list of strings");
    }
    const argv = listed.filter((item) => typeof item === "string");
    const given = argOpt(args, 2);
    if (given !== void 0 && !isJsonRecord(given)) throw invalid(op, "argument 3 must be an object");
    const options = given === void 0 ? void 0 : given;
    if (options !== void 0) {
      for (const key of Object.keys(options)) {
        if (!["cwd", "env", "stdin", "stdout", "stderr", "detached"].includes(key)) throw invalid(op, `unknown option ${key}`);
      }
    }
    if (!this.grants.allows({ need: "exec", command })) throw denied(op, `command ${command} is not granted`);
    const wantedCwd = options?.cwd;
    let cwd;
    if (wantedCwd === void 0 || wantedCwd === null) {
      cwd = void 0;
    } else if (typeof wantedCwd === "string") {
      const anchored = expandAnchor(this.state.anchors, wantedCwd);
      if (anchored.kind === "unknown") throw invalid(op, anchored.message);
      const dir = anchored.kind === "anchored" ? anchored.path : wantedCwd;
      if (!this.grants.allows({ need: "fs", path: dir, mode: "read" })) {
        throw denied(op, `cwd ${wantedCwd} is not granted for read`);
      }
      cwd = dir;
    } else {
      throw invalid(op, "cwd must be a string");
    }
    const stdinMode = this.stdioMode(options, "stdin", "in");
    const stdoutMode = this.stdioMode(options, "stdout", "out");
    const stderrMode = this.stdioMode(options, "stderr", "err");
    const wantedDetached = options?.detached;
    if (wantedDetached !== void 0 && wantedDetached !== null && typeof wantedDetached !== "boolean") {
      throw invalid(op, "detached must be a boolean");
    }
    const detached = wantedDetached === true;
    if (detached && [stdinMode, stdoutMode, stderrMode].includes("pipe")) throw invalid(op, "a detached child takes no piped stream");
    const vars = {};
    for (const [name, value] of this.state.env) {
      if (value !== null) vars[name] = value;
    }
    const wantedEnv = options?.env;
    if (wantedEnv === void 0 || wantedEnv === null) ; else if (isJsonRecord(wantedEnv)) {
      for (const [name, value] of Object.entries(wantedEnv)) {
        if (!validEnvName(name)) throw invalid(op, `bad environment name ${name}`);
        if (typeof value === "string" && !value.includes("\0")) {
          vars[name] = value;
        } else if (value === null) {
          this.envGranted(op, name);
          const found = this.lookupEnv(name);
          if (found !== null) vars[name] = found;
          else delete vars[name];
        } else {
          throw invalid(op, `environment ${name} must be a string or null`);
        }
      }
    } else {
      throw invalid(op, "env must be an object");
    }
    const modes = [stdinMode, stdoutMode, stderrMode].map((mode) => mode === "inherit" ? "inherit" : mode === "pipe" ? "pipe" : "ignore");
    let child;
    try {
      child = spawn(command, argv, { cwd, env: vars, stdio: [modes[0], modes[1], modes[2]], detached });
    } catch (raised) {
      const error = raised instanceof Error ? raised : new Error(String(raised));
      if (errnoCode(error) === "ERR_INVALID_ARG_VALUE") throw invalid(op, "nul byte found in provided data");
      throw processFailure(op, error);
    }
    const exit = new Promise((resolve3) => {
      child.once("exit", (code, signal) => resolve3({ code, signal: signal === null ? null : SIGNALS[signal] ?? null }));
    });
    const started = await new Promise((resolve3) => {
      child.once("spawn", () => resolve3(void 0));
      child.once("error", (error) => resolve3(error));
    });
    if (started !== void 0) throw processFailure(op, started);
    child.on("error", () => void 0);
    if (detached) child.unref();
    const pid = child.pid ?? 0;
    const entry = { child, exit, exited: false };
    void exit.then(() => {
      entry.exited = true;
    });
    const fields = { pid };
    if (child.stdin !== null) {
      const id = this.state.allocate();
      this.state.fds.set(id, { kind: "child-stdin", stream: child.stdin });
      fields.stdin = id;
    }
    if (child.stdout !== null) {
      const id = this.state.allocate();
      this.state.fds.set(id, { kind: "child-stdout", source: new ByteSource(child.stdout, PIPE_HIGH_WATER) });
      fields.stdout = id;
    }
    if (child.stderr !== null) {
      const id = this.state.allocate();
      this.state.fds.set(id, { kind: "child-stderr", source: new ByteSource(child.stderr, PIPE_HIGH_WATER) });
      fields.stderr = id;
    }
    this.state.children.set(pid, entry);
    return fields;
  }
  async wait(args) {
    return (await this.waitLater(args)())();
  }
  /** `os/wait` after its checks; a keyed ask under a route watches the child in the background (EXEC-QUEUE-10). */
  waitLater(args) {
    const op = "os/wait";
    const pid = argI64(args, 0, op);
    const entry = this.state.children.get(pid);
    if (entry === void 0) throw osFailure("closed", op, `pid ${pid} is not a spawned process`);
    return async () => {
      const info = await entry.exit;
      return () => {
        if (!this.state.children.delete(pid)) throw osFailure("closed", op, `pid ${pid} was already reaped`);
        const fields = {};
        if (info.code !== null) fields.code = info.code;
        if (info.signal !== null) fields.signal = info.signal;
        return fields;
      };
    };
  }
  signalNumber(value) {
    const op = "os/kill";
    let found;
    if (typeof value === "string") found = SIGNAL_SET.find(([name]) => name === value)?.[1];
    else if (typeof value === "number" && Number.isInteger(value)) found = SIGNAL_SET.find(([, number]) => number === value)?.[1];
    if (found === void 0) {
      throw invalid(op, "signal must be one of TERM, KILL, INT, HUP, QUIT, USR1, USR2, STOP, CONT (or its number)");
    }
    return found;
  }
  kill(args) {
    const op = "os/kill";
    const pid = argI64(args, 0, op);
    const signal = this.signalNumber(args.length > 1 ? args[1] : null);
    const entry = this.state.children.get(pid);
    if (entry === void 0) throw osFailure("closed", op, `pid ${pid} is not a spawned process`);
    if (pid < -2147483648 || pid > 2147483647) throw invalid(op, "pid out of range");
    if (entry.exited) return {};
    try {
      process.kill(pid, signal);
    } catch (raised) {
      throw processFailure(op, raised instanceof Error ? raised : new Error(String(raised)));
    }
    return {};
  }
  setenv(op, args, set) {
    const name = argStr(args, 0, op);
    this.envGranted(op, name);
    if (!validEnvName(name)) throw invalid(op, `bad environment name ${name}`);
    let entry = null;
    if (set) {
      const value = argStr(args, 1, op);
      if (value.includes("\0")) throw invalid(op, "value contains a NUL byte");
      entry = value;
    }
    this.state.env.set(name, entry);
    return {};
  }
  environ() {
    const names = new Set(Object.keys(process.env).filter((name) => this.grants.allows({ need: "env", name })));
    for (const [name, value] of this.state.env) {
      if (value !== null && this.grants.allows({ need: "env", name })) names.add(name);
      else if (value === null) names.delete(name);
    }
    return { names: [...names].sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b))) };
  }
  async writeStdio(op, args, toStderr) {
    const data = argBytes(args, 0, op);
    if (!this.grants.allows({ need: "stdio", kind: toStderr ? "err" : "out" })) throw denied(op, "stdio is not granted");
    const stream = toStderr ? process.stderr : process.stdout;
    await new Promise((resolve3, reject) => {
      stream.write(data, (error) => error ? reject(error) : resolve3());
    }).catch((raised) => {
      throw processFailure(op, raised);
    });
    return { bytes: data.length };
  }
  stdFd(op, args) {
    const fd = argI64(args, 0, op);
    let kind;
    if (fd === 0) kind = "in";
    else if (fd === 1) kind = "out";
    else if (fd === 2) kind = "err";
    else throw osFailure("unsupported", op, "only fds 0, 1 and 2 are supported");
    if (!this.grants.allows({ need: "stdio", kind })) throw denied(op, "stdio is not granted");
    return fd;
  }
  ttySize(op, args) {
    const fd = this.stdFd(op, args);
    if (!isatty(fd)) throw osFailure("io", op, `fd ${fd} is not a terminal`);
    if (fd === 0) throw osFailure("unsupported", op, "the Node os host does not read the size of a terminal on fd 0 yet (G-ORB-308)");
    const stream = fd === 1 ? process.stdout : process.stderr;
    const [cols, rows] = stream.getWindowSize();
    return { rows, cols };
  }
};
var SYS_KIND = {
  "os/uid": "identity",
  "os/gid": "identity",
  "os/username": "identity",
  "os/group-of": "identity",
  "os/hostname": "identity",
  "os/uname": "identity",
  "os/cpu-usage": "cpu",
  "os/uptime": "cpu",
  "os/load-avg": "cpu",
  "os/memory-info": "memory",
  "os/disk-usage": "disk",
  "os/mounts": "disk",
  "os/disk-io": "disk",
  "os/network-interfaces": "network",
  "os/network-stats": "network",
  "os/network-connected": "network",
  "os/default-gateway": "network",
  "os/battery-status": "power-state",
  "os/ac-power": "power-state",
  "os/thermal-zones": "power-state"
};
var DESKTOP_KIND = {
  "os/notify": "notify",
  "os/speak": "speak",
  "os/brightness-get": "brightness",
  "os/brightness-set": "brightness",
  "os/volume-get": "volume",
  "os/volume-set": "volume",
  "os/volume-mute": "volume",
  "os/suspend": "power",
  "os/hibernate": "power"
};
function isSysOp(op) {
  return op === "os/clock-monotonic" || op === "os/watch-cron" || op in SYS_KIND || op in DESKTOP_KIND;
}
var ORIGIN = process.hrtime.bigint();
var SysOps = class {
  constructor(grants) {
    this.grants = grants;
  }
  grants;
  run(op) {
    const sys = SYS_KIND[op];
    if (sys !== void 0 && !this.grants.allows({ need: "sys", kind: sys })) {
      throw denied(op, `the sys grant ${sys} is missing`);
    }
    const desktop = DESKTOP_KIND[op];
    if (desktop !== void 0 && !this.grants.allows({ need: "desktop", kind: desktop })) {
      throw denied(op, `the desktop grant ${desktop} is missing`);
    }
    switch (op) {
      case "os/clock-monotonic":
        return { nanos: Number(process.hrtime.bigint() - ORIGIN) };
      case "os/uid":
        return { uid: process.getuid?.() ?? -1 };
      case "os/gid":
        return { gid: process.getgid?.() ?? -1 };
      case "os/username":
        return { username: userInfo().username };
      case "os/hostname":
        return { hostname: hostname() };
      case "os/uname":
        return { sysname: type(), nodename: hostname(), release: release(), version: version(), machine: machine() };
      case "os/uptime":
        return { seconds: uptime() };
      case "os/load-avg": {
        const [one, five, fifteen] = loadavg();
        return { one, five, fifteen };
      }
      case "os/watch-cron":
        throw osFailure("unsupported", op, "streaming host not implemented");
      default:
        throw osFailure("unsupported", op, "the Node os host does not answer this operation yet (G-ORB-308)");
    }
  }
};
function failureOf(op, raised) {
  if (raised instanceof OsFailure) return raised.error;
  return { kind: "io", message: `${op}: ${raised instanceof Error ? raised.message : String(raised)}` };
}
var NodeOsHost = class {
  state;
  fs;
  process;
  net;
  sys;
  constructor(given, anchors) {
    this.state = new OsState(anchors);
    const grants = anchoredGrants(given, anchors);
    this.fs = new FsOps(this.state, grants);
    this.process = new ProcessOps(this.state, grants);
    this.net = new NetOps(this.state, grants);
    this.sys = new SysOps(grants);
  }
  async dispatch(op, args) {
    if (op === "os/close") {
      if (this.fs.closeOwned(args) || this.net.closeOwned(args)) return {};
      throw osFailure("closed", op, "not an open handle");
    }
    if (isFsOp(op)) return this.fs.run(op, args);
    if (isProcessOp(op)) return this.process.run(op, args);
    if (isNetOp(op)) return this.net.run(op, args);
    if (isSysOp(op)) return this.sys.run(op);
    throw osFailure("unsupported", op, "this host does not implement the operation yet");
  }
  async answer(op, args) {
    try {
      return { ok: await this.dispatch(op, args) };
    } catch (raised) {
      return { error: failureOf(op, raised) };
    }
  }
  deferral(op, args) {
    switch (op) {
      case "os/wait":
        return this.process.waitLater(args);
      case "os/read":
        return this.fs.readLater(op, args);
      case "os/send":
        return this.net.sendLater(op, args);
      case "os/recv":
        return this.net.recvLater(op, args);
      case "os/recvfrom":
        return this.net.recvfromLater(op, args);
      default:
        throw osFailure("unsupported", op, "this operation does not defer its completion");
    }
  }
  /** `Completions::run_later`: the checks fail in place, the wait runs in the background and its outcome goes to `deliver` unless the key is cancelled first. */
  defer(op, args, key, deliver) {
    let blocking;
    try {
      blocking = this.deferral(op, args);
    } catch (raised) {
      return { error: failureOf(op, raised) };
    }
    if (!this.state.completions.begin(key)) return { error: failureOf(op, invalid(op, `key ${key} already has a completion pending`)) };
    const finish = (build) => {
      if (!this.state.completions.claim(key)) return;
      try {
        deliver({ ok: build() });
      } catch (raised) {
        deliver({ error: failureOf(op, raised) });
      }
    };
    blocking().then(finish, (raised) => finish(() => {
      throw raised;
    }));
    return { ok: null };
  }
  cancel(key) {
    return this.state.completions.cancel(key);
  }
  close() {
    this.state.close();
  }
};
function createNodeOsHost(grants, options = {}) {
  return new NodeOsHost(grants, options.anchors ?? { home: homedir(), start: process.cwd() });
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
        return { key };
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
async function loadKernelModule(kernelDir, options) {
  return loadKernel(kernelDir, options);
}
var initialised = /* @__PURE__ */ new WeakSet();
function initOnce(loaded, wasm, languageFrom) {
  if (initialised.has(loaded)) return loaded;
  if (wasm !== void 0) loaded.initSync({ module: wasm });
  loaded.installLanguage(JSON.stringify(readLanguageBundle(languageFrom)));
  installKernelEvaluator(loaded);
  initialised.add(loaded);
  return loaded;
}
function initKernelSync(languageFrom) {
  initOnce(installedModule, readFileSync(createRequire(import.meta.url).resolve("@almadar/kernel/kernel.wasm")), languageFrom);
  return installedModule;
}
async function loadInstalledKernel(languageFrom) {
  return initKernelSync(languageFrom);
}
async function loadHttpKernel(kernelDir, options) {
  return loadKernel(kernelDir, options);
}
async function loadKernel(kernelDir, options) {
  const loaded = await import(pathToFileURL(join(kernelDir, "pkg/orbital_wasm.js")).href);
  return initOnce(loaded, initialised.has(loaded) ? void 0 : readFileSync(join(kernelDir, "pkg/orbital_wasm_bg.wasm")), options.languageFrom);
}
var NATIVE_PLATFORMS = {
  "darwin-x64": "darwin-x64",
  "darwin-arm64": "darwin-arm64",
  "linux-x64": "linux-x64",
  "linux-arm64": "linux-arm64",
  "win32-x64": "windows-x64"
};
function resolveNativeAddon(from) {
  const named = process.env.ALMADAR_KERNEL_NODE;
  if (named !== void 0 && named !== "") return named;
  const platform = NATIVE_PLATFORMS[`${process.platform}-${process.arch}`];
  if (platform === void 0) throw new Error(`no native kernel add-on is shipped for ${process.platform}-${process.arch}`);
  return createRequire(join(from, "resolve.js")).resolve(`@almadar/orb-${platform}/kernel.node`);
}
async function loadNativeKernelModule(addonPath, options) {
  const loaded = createRequire(import.meta.url)(addonPath);
  return initOnce(loaded, void 0, options.languageFrom);
}

// src/program/workspace-host.ts
var installedHost = null;
function installWorkspaceHost(host) {
  installedHost = host;
}
function uninstallWorkspaceHost() {
  installedHost = null;
}
function installedWorkspaceHost() {
  return installedHost;
}
function workspaceOwnerSegment(principal) {
  let out = "";
  for (const byte of new TextEncoder().encode(principal)) {
    const ch = String.fromCharCode(byte);
    out += /[A-Za-z0-9-]/.test(ch) ? ch : `_${byte.toString(16).padStart(2, "0")}`;
  }
  return out;
}

// src/program/index.ts
var log = createLogger("almadar:integrations:program");
function runOrb(args, opts) {
  const bin = opts.orbBin ?? resolveOrbBinary(opts.cwd);
  return new Promise((done) => {
    execFile(bin, [...args], { cwd: opts.cwd, maxBuffer: 1024 * 1024 * 512 }, (error, stdout, stderr) => {
      const code = error === null ? 0 : typeof error.code === "number" ? error.code : 1;
      if (code !== 0) log.warn("orb exited non-zero", { args: args.join(" "), code, stderr });
      done({ stdout, stderr, code });
    });
  });
}
function runOrbSync(args, opts) {
  const bin = opts.orbBin ?? resolveOrbBinary(opts.cwd);
  const res = spawnSync(bin, [...args], { cwd: opts.cwd, maxBuffer: 1024 * 1024 * 512, encoding: "utf-8" });
  const code = res.error !== void 0 ? 1 : res.status ?? 1;
  const stderr = res.error !== void 0 ? res.error.message : res.stderr;
  if (code !== 0) log.warn("orb exited non-zero", { args: args.join(" "), code, stderr });
  return { stdout: res.stdout, stderr, code };
}
var ProgramParser = {
  safeParse(value) {
    try {
      return { success: true, data: parseProgram(value) };
    } catch (error) {
      return { success: false, error: { message: error instanceof Error ? error.message : String(error) } };
    }
  }
};
function parseJson(schema, run, what) {
  if (run.code !== 0) throw new Error(`${what}: orb exited ${run.code}: ${run.stderr.trim()}`);
  const parsed = schema.safeParse(JSON.parse(run.stdout));
  if (!parsed.success) throw new Error(`${what}: unexpected orb output: ${parsed.error.message}`);
  return parsed.data;
}
function withTempFile(name, content, use) {
  const dir = mkdtempSync(join(tmpdir(), "almadar-program-"));
  const path = join(dir, name);
  writeFileSync(path, content);
  return use(path).finally(() => rmSync(dir, { recursive: true, force: true }));
}
function withProjectFile(cwd, name, content, use) {
  const path = join(cwd, `.${randomUUID()}-${name}`);
  writeFileSync(path, content);
  return use(path).finally(() => rmSync(path, { force: true }));
}
async function behaviorCatalog(scope, opts) {
  const exposure = (scope.exposure ?? []).flatMap((e) => ["--exposure", e]);
  const run = await runOrb(["behaviors", "catalog", "--json", ...scope.paths, ...exposure], opts);
  return parseJson(CatalogEntrySchema.array(), run, "behavior/catalog");
}
function behaviorCatalogSync(scope, opts) {
  const exposure = (scope.exposure ?? []).flatMap((e) => ["--exposure", e]);
  return parseJson(CatalogEntrySchema.array(), runOrbSync(["behaviors", "catalog", "--json", ...scope.paths, ...exposure], opts), "behavior/catalog");
}
async function behaviorDescribe(value, opts) {
  if ("trait" in value) {
    const run = await runOrb(["behaviors", "describe", "--json", formatTraitValueLiteral(value)], opts);
    return parseJson(TraitDescriptionSchema, run, "behavior/describe");
  }
  const spec = "orbital" in value ? `${value.behavior}.orbitals.${value.orbital}` : value.behavior;
  return parseJson(BehaviorDescriptionSchema, await runOrb(["behaviors", "describe", "--json", spec], opts), "behavior/describe");
}
async function behaviorSource(value, opts) {
  const run = await runOrb(["behaviors", "source", "--json", value.behavior], opts);
  return parseJson(ProgramParser, run, "behavior/source");
}
function programRead(text, opts) {
  return withTempFile(
    "program.lolo",
    text,
    async (path) => parseJson(ProgramParser, await runOrb(["emit", "orb", path], opts), "program/read")
  );
}
async function programReadOutcome(text, opts) {
  return withTempFile("program.lolo", text, async (path) => {
    const run = await runOrb(["emit", "orb", path], opts);
    if (run.code !== 0) return fail2(`program/read: orb exited ${run.code}: ${run.stderr.trim()}`);
    const parsed = ProgramParser.safeParse(JSON.parse(run.stdout));
    if (parsed.success) return { ok: true, result: parsed.data };
    const report = parseJson(ValidateReportSchema, await runOrb(["validate", "--json", "--deny-warnings", path], opts), "program/read");
    const issues = [...report.errors ?? [], ...report.warnings ?? []];
    if (issues.length === 0) return fail2(`program/read: not a program: ${parsed.error.message}`);
    return { ok: false, error: `program/read: ${issues.length} validation issue(s): ${issues.map((e) => e.message).join("; ")}`, errors: issues };
  });
}
function programPrint(program, opts) {
  return withTempFile("program.orb", JSON.stringify(program), async (path) => {
    const run = await runOrb(["emit", "lolo", path], opts);
    if (run.code !== 0) throw new Error(`program/print: orb exited ${run.code}: ${run.stderr.trim()}`);
    return run.stdout;
  });
}
var IssueSchema = z.object({
  code: z.string(),
  message: z.string(),
  path: z.string().optional(),
  line: z.number().optional(),
  column: z.number().optional()
});
var ValidateReportSchema = z.object({
  valid: z.boolean(),
  errors: z.array(IssueSchema).optional(),
  warnings: z.array(IssueSchema).optional()
});
function workspaceAccessError(behavior, opts, context) {
  const host = installedWorkspaceHost();
  if (host === null || !behavior.startsWith("./")) return void 0;
  const under = relative(host.root, resolve(opts.cwd, behavior));
  if (under.startsWith("..") || isAbsolute(under)) return void 0;
  const owner = under.split(sep)[0];
  if (context?.principal !== void 0 && workspaceOwnerSegment(context.principal) === owner) return void 0;
  return `behavior "${behavior}" is in another user's workspace`;
}
var PROGRAM_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
async function stampAndValidate(program, opts, dir, caller) {
  if (!PROGRAM_NAME.test(program.name)) {
    return { ok: false, errors: [{ code: "PROGRAM_NAME_INVALID", message: `program name "${program.name}" is not a file name` }] };
  }
  const input = join(dir, `${program.name}.orb`);
  const stamped = join(dir, `${program.name}.stamped.orb`);
  writeFileSync(input, JSON.stringify(program));
  const stampArgs = ["stamp", input, "-o", stamped];
  if (opts.prior !== void 0) {
    const priorPath = join(dir, "prior.orb");
    writeFileSync(priorPath, JSON.stringify(opts.prior));
    stampArgs.push("--prior", priorPath);
  }
  const stamp = await runOrb(stampArgs, opts);
  if (stamp.code !== 0) {
    return { ok: false, errors: [{ code: "PROGRAM_STAMP_FAILED", message: stamp.stderr.trim() }] };
  }
  const validateArgs = ["validate", "--json", "--deny-warnings", ...opts.final === true ? ["--final"] : [], stamped];
  const report = parseJson(ValidateReportSchema, await runOrb(validateArgs, opts), caller);
  const errors = report.errors ?? [];
  const warnings = report.warnings ?? [];
  return { ok: true, stamped, errors, warnings, valid: report.valid && errors.length === 0 && warnings.length === 0 };
}
async function programValidate(program, opts) {
  const dir = mkdtempSync(join(tmpdir(), "almadar-validate-"));
  try {
    const run = await stampAndValidate(program, opts, dir, "program/validate");
    return run.ok ? { valid: run.valid, errors: run.errors, warnings: run.warnings } : { valid: false, errors: run.errors, warnings: [] };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
async function programEval(program, opts) {
  const dir = mkdtempSync(join(tmpdir(), "almadar-eval-"));
  try {
    const run = await stampAndValidate(program, opts, dir, "program/eval");
    if (!run.ok) return { ok: false, errors: run.errors };
    const stamped = run.stamped;
    const issues = [...run.errors, ...run.warnings];
    if (!run.valid || issues.length > 0) return { ok: false, errors: issues };
    const written = ProgramParser.safeParse(JSON.parse(readFileSync(stamped, "utf-8")));
    if (!written.success) throw new Error(`program/eval: stamped program does not parse: ${written.error.message}`);
    const content = JSON.stringify(written.data, null, 2);
    let behavior;
    if (opts.workspace !== void 0) {
      const host = installedWorkspaceHost();
      if (host === null) return { ok: false, errors: [{ code: "PROGRAM_NO_WORKSPACE_HOST", message: "no workspace host is installed on this host" }] };
      if (opts.workspace.context.principal === void 0) {
        return { ok: false, errors: [{ code: "PROGRAM_WORKSPACE_UNAUTHORIZED", message: "a workspace eval needs a signed-in caller" }] };
      }
      const ws = await host.open(opts.workspace.id, opts.workspace.context);
      const rel = relative(opts.cwd, ws.workDir);
      if (rel.startsWith("..") || isAbsolute(rel)) {
        return { ok: false, errors: [{ code: "PROGRAM_WORKSPACE_OUTSIDE_PROJECT", message: `workspace ${ws.workDir} is outside the project ${opts.cwd}` }] };
      }
      await ws.writeFile(`orbitals/${program.name}.orb`, content);
      await ws.snapshot(`program/eval ${program.name}`);
      behavior = `./${rel.split(sep).join("/")}/orbitals/${program.name}`;
    } else {
      const target = join(opts.cwd, "orbitals");
      mkdirSync(target, { recursive: true });
      writeFileSync(join(target, `${program.name}.orb`), content);
      behavior = `./orbitals/${program.name}`;
    }
    const traits = written.data.orbitals.flatMap(
      (orbital) => orbital.traits.flatMap((t) => typeof t === "object" && "name" in t && typeof t.name === "string" ? [{ behavior, trait: t.name }] : [])
    );
    return { ok: true, result: { behavior, traits, value: { behavior } } };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
var LAYOUT_STRATEGIES = ["sidebar", "tabs", "dashboard", "wizard-flow", "single"];
function importSource(orbital) {
  const ref = orbital.reference?.ref;
  if (ref === void 0) return void 0;
  const [alias, kind, name] = ref.split(".");
  if (kind !== "orbitals" || name === void 0) return void 0;
  const use = (orbital.uses ?? []).find((u) => u.as === alias);
  return use === void 0 ? void 0 : { from: use.from, orbital: name };
}
var behaviorName = (from) => from.split("/").pop() ?? from;
async function programCompose(programs, options, opts) {
  const sources = /* @__PURE__ */ new Set();
  for (const program of programs) {
    for (const orbital of program.orbitals) for (const use of orbital.uses ?? []) sources.add(use.from);
  }
  const loaded = /* @__PURE__ */ new Map();
  for (const from of sources) loaded.set(behaviorName(from), await behaviorSource({ behavior: from }, opts));
  const load = (name) => loaded.get(name) ?? null;
  const byName = /* @__PURE__ */ new Map();
  for (const program of programs) for (const orbital of program.orbitals) byName.set(orbital.name, orbital);
  const catalogOrbitalOf = (name) => {
    const orbital = byName.get(name);
    const source = orbital === void 0 ? void 0 : importSource(orbital);
    return source === void 0 ? void 0 : { organism: behaviorName(source.from), orbital: source.orbital };
  };
  const composed = composeAppFromFiles(programs, {
    appName: options.appName,
    ...options.layout !== void 0 ? { layoutStrategy: options.layout } : {},
    organismOf: (name) => catalogOrbitalOf(name)?.organism,
    organismOrderOf: organismOrderResolver(catalogOrbitalOf, load),
    atomTraitOf: atomTraitResolver(load),
    importedOrbitalOf: orbitalImportResolver(load),
    importedProgramOf: (orbital) => {
      const source = importSource(orbital);
      return source === void 0 ? void 0 : load(behaviorName(source.from)) ?? void 0;
    }
  });
  return options.theme !== void 0 ? { ...composed.schema, theme: options.theme } : composed.schema;
}
async function mountTraitValue(value, opts, context) {
  const denied2 = workspaceAccessError(value.behavior, opts, context);
  if (denied2 !== void 0) return { ok: false, error: denied2 };
  let source;
  try {
    source = await behaviorSource(value, opts);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
  const owner = source.orbitals.find(
    (o) => o.traits.some((t) => typeof t === "object" && !("ref" in t) && t.name === value.trait)
  );
  if (owner === void 0) {
    return { ok: false, error: `behavior "${value.behavior}" declares no inline trait "${value.trait}"` };
  }
  const { behavior, trait, config, ...rest } = value;
  const overrides = config !== void 0 ? { ...rest, config: mergeCallSiteConfigOverrides({}, config) } : rest;
  const projectRelative = behavior.startsWith("./");
  const page = (owner.pages ?? []).find((p) => typeof p === "object" && "path" in p && (p.traits ?? []).some((t) => (typeof t === "string" ? t : "ref" in t ? t.ref : t.name) === trait));
  const wrapper = {
    name: `Mount${trait}`,
    orbitals: [
      {
        name: "Mounted",
        entity: `Bound.orbitals.${owner.name}.entity`,
        reference: {
          ref: `Bound.orbitals.${owner.name}`,
          only: [trait],
          ...Object.keys(overrides).length > 0 ? { traits: { [trait]: overrides } } : {}
        },
        traits: [],
        pages: [],
        uses: [{ as: "Bound", from: behavior }]
      }
    ]
  };
  const check = async (path) => {
    const report = parseJson(ValidateReportSchema, await runOrb(["validate", "--json", "--deny-warnings", path], opts), "mount");
    const issues = [...report.errors ?? [], ...report.warnings ?? []];
    if (!report.valid || issues.length > 0) {
      return { ok: false, error: `trait value ${formatTraitValueLiteral(value)} does not validate where it is bound`, errors: issues };
    }
    const schema = parseJson(ProgramParser, await runOrb(["resolve", path], opts), "mount");
    const pagePath = page !== void 0 && typeof page === "object" && "path" in page ? page.path : void 0;
    return { ok: true, mounted: { schema, orbital: "Mounted", trait: `Mounted${trait}`, ...pagePath !== void 0 ? { pagePath } : {} } };
  };
  const text = JSON.stringify(wrapper);
  return projectRelative ? withProjectFile(opts.cwd, "mount.orb", text, check) : withTempFile("mount.orb", text, check);
}
var WHICH_LINE = /^(\/\S+\.(?:orb|lolo)) \((.+)\)$/;
async function behaviorFile(behavior, opts) {
  if (behavior.startsWith("./")) {
    const path = `${resolve(opts.cwd, behavior)}.orb`;
    return existsSync(path) ? path : { error: `no program at ${behavior}` };
  }
  const run = await runOrb(["behaviors", "which", behavior], opts);
  const line = run.stdout.trim().split("\n").pop() ?? "";
  const match = WHICH_LINE.exec(line);
  if (run.code !== 0 || match === null) return { error: `behavior "${behavior}" is not installed${run.stderr.trim() ? `: ${run.stderr.trim()}` : ""}` };
  return match[1];
}
async function mountBehaviorValue(value, opts, context) {
  const denied2 = workspaceAccessError(value.behavior, opts, context);
  if (denied2 !== void 0) return { ok: false, error: denied2 };
  const file = await behaviorFile(value.behavior, opts);
  if (typeof file !== "string") return { ok: false, error: file.error };
  const report = parseJson(ValidateReportSchema, await runOrb(["validate", "--json", "--deny-warnings", file], opts), "mount");
  const issues = [...report.errors ?? [], ...report.warnings ?? []];
  if (!report.valid || issues.length > 0) {
    return { ok: false, error: `behavior ${value.behavior} does not validate`, errors: issues };
  }
  const schema = parseJson(ProgramParser, await runOrb(["resolve", file], opts), "mount");
  const firstPage = defaultPage(schema)?.page.path;
  if (firstPage === void 0) return { ok: false, error: `behavior ${value.behavior} has no page to open` };
  return { ok: true, mounted: { schema, firstPage } };
}
async function programResolve(path, opts) {
  return parseJson(ProgramParser, await runOrb(["resolve", path], opts), "program/resolve");
}
function programResolveSchema(program, opts) {
  return withProjectFile(opts.cwd, "program.orb", JSON.stringify(program), (path) => programResolve(path, opts));
}
async function behaviorResolve(value, opts) {
  const file = await behaviorFile(value.behavior, opts);
  if (typeof file !== "string") return file;
  return parseJson(ProgramParser, await runOrb(["resolve", file], opts), "behavior/resolve");
}
function installedBehaviorIndex(opts) {
  const out = /* @__PURE__ */ new Map();
  for (const pkg of discoverBehaviorPackages(opts.cwd)) {
    const tier = pkg.name === "@almadar/std" ? "std" : pkg.name === "@almadar-io/behaviors" ? "io" : "unknown";
    const catalog = parseJson(CatalogEntrySchema.array(), runOrbSync(["behaviors", "catalog", "--json", "--no-vectors", pkg.orb.prefix], opts), "behavior/dependencies");
    for (const entry of catalog) {
      const name = entry.behavior.slice(pkg.orb.prefix.length + 1);
      if (!out.has(name)) out.set(name, { tier, prefix: pkg.orb.prefix, ...entry.pattern !== void 0 ? { pattern: entry.pattern } : {} });
    }
  }
  return out;
}
async function behaviorDependencies(program, opts) {
  const index = installedBehaviorIndex(opts);
  const orbs = /* @__PURE__ */ new Map();
  let frontier = [...new Set(importsOf(program, () => "unknown").map((i) => i.behavior))];
  while (frontier.length > 0) {
    const loaded = await Promise.all(
      frontier.map(async (name) => {
        const entry = index.get(name);
        return [name, entry ? await behaviorSource({ behavior: `${entry.prefix}/${name}` }, opts) : null];
      })
    );
    const next = /* @__PURE__ */ new Set();
    for (const [name, orb] of loaded) {
      orbs.set(name, orb);
      for (const i of orb ? importsOf(orb, () => "unknown") : []) if (!orbs.has(i.behavior)) next.add(i.behavior);
    }
    frontier = [...next].filter((n) => !orbs.has(n));
  }
  return dependencyGraphOf(program, {
    tierOf: (n) => index.get(n)?.tier ?? "unknown",
    orbOf: (n) => orbs.get(n) ?? null,
    patternOf: (n) => index.get(n)?.pattern
  });
}
var StepRequestSchema = z.object({
  orbital: z.string(),
  trait: z.string(),
  from: z.string(),
  event: z.string(),
  payload: EventPayloadSchema
});
var StepOutcomeSchema = z.object({
  trait: z.string(),
  executed: z.boolean(),
  previousState: z.string(),
  newState: z.string(),
  emits: z.array(z.object({ event: z.string(), payload: EventPayloadSchema.nullable() })),
  firedArm: z.number().int().nullable(),
  guards: z.array(z.object({ arm: z.number().int(), guard: SExprSchema, passed: z.boolean(), error: z.string().optional() })),
  effects: z.array(z.object({ type: z.string(), args: z.array(SExprSchema), status: z.enum(["executed", "failed", "skipped"]), error: z.string().optional() }))
});
var StepReportSchema = z.union([
  z.object({ success: z.literal(true), steps: z.array(z.object({ outcomes: z.array(StepOutcomeSchema) })) }),
  z.object({ success: z.literal(false), error: z.string() })
]);
async function programStep(program, requests, opts) {
  const steps = requests.map((r) => ({ trait: r.trait, event: r.event, payload: r.payload, from: r.from }));
  return withTempFile("program.orb", JSON.stringify(program), async (path) => {
    const run = await runOrb(["execute", path, "--steps", JSON.stringify(steps)], opts);
    const report = parseJson(StepReportSchema, run, "program/step");
    if (!report.success) return { error: report.error };
    const results = [];
    for (const [i, request] of requests.entries()) {
      const outcome = report.steps[i]?.outcomes.find((o) => o.trait === request.trait);
      if (outcome === void 0) return { error: `trait "${request.trait}" did not run` };
      const firedGuarded = outcome.firedArm !== null && outcome.guards.some((g) => g.arm === outcome.firedArm);
      results.push({ ...request, result: {
        trait: outcome.trait,
        event: request.event,
        transitionFired: outcome.executed,
        guard: firedGuarded ? "pass" : outcome.firedArm === null && outcome.guards.length > 0 ? "fail" : "none",
        ...outcome.firedArm !== null ? { firedArm: outcome.firedArm } : {},
        state: { before: outcome.previousState, after: outcome.newState },
        effects: outcome.effects.map((e) => ({ type: e.type, args: e.args, status: e.status, ...e.error !== void 0 ? { error: e.error } : {} })),
        emitted: outcome.emits.map((e) => ({ type: e.event, ...e.payload !== null ? { payload: e.payload } : {}, timestamp: i })),
        guards: outcome.guards.map((g) => ({ arm: g.arm, guard: g.guard, passed: g.passed, trace: [], ...g.error !== void 0 ? { error: g.error } : {} }))
      } });
    }
    return results;
  });
}
function fail2(error) {
  return { ok: false, error };
}
function issuesOf(error) {
  return error.issues.map((i) => i.path.length > 0 ? `${i.path.join(".")}: ${i.message}` : i.message).join("; ");
}
function programArg(op, value) {
  const parsed = ProgramParser.safeParse(value);
  return parsed.success ? parsed.data : `${op}: not a program: ${parsed.error.message}`;
}
async function runProgramEffect(op, args, opts, context) {
  log.debug("effect", { op, args: JSON.stringify(args) });
  try {
    switch (op) {
      case "behavior/catalog": {
        const scope = CatalogScopeSchema.safeParse(args[0]);
        return scope.success ? { ok: true, result: await behaviorCatalog(scope.data, opts) } : fail2(`behavior/catalog: ${issuesOf(scope.error)}`);
      }
      case "behavior/describe": {
        const value = DescribeTargetSchema.safeParse(args[0]);
        if (!value.success) return fail2(`${op}: ${issuesOf(value.error)}`);
        const denied2 = workspaceAccessError(value.data.behavior, opts, context);
        if (denied2 !== void 0) return fail2(`${op}: ${denied2}`);
        return { ok: true, result: await behaviorDescribe(value.data, opts) };
      }
      case "behavior/source": {
        const value = DescribeTargetSchema.safeParse(args[0]);
        if (!value.success) return fail2(`${op}: ${issuesOf(value.error)}`);
        const denied2 = workspaceAccessError(value.data.behavior, opts, context);
        if (denied2 !== void 0) return fail2(`${op}: ${denied2}`);
        return { ok: true, result: await behaviorSource(value.data, opts) };
      }
      case "behavior/resolve": {
        const value = DescribeTargetSchema.safeParse(args[0]);
        if (!value.success) return fail2(`${op}: ${issuesOf(value.error)}`);
        const denied2 = workspaceAccessError(value.data.behavior, opts, context);
        if (denied2 !== void 0) return fail2(`${op}: ${denied2}`);
        const resolved = await behaviorResolve(value.data, opts);
        return "error" in resolved ? fail2(`${op}: ${resolved.error}`) : { ok: true, result: resolved };
      }
      case "program/step": {
        const program = programArg(op, args[0]);
        if (typeof program === "string") return fail2(program);
        const requests = z.array(StepRequestSchema).safeParse(args[1]);
        if (!requests.success) return fail2(`${op}: ${issuesOf(requests.error)}`);
        const played = await programStep(program, requests.data, opts);
        return "error" in played ? fail2(`${op}: ${played.error}`) : { ok: true, result: played };
      }
      case "behavior/dependencies": {
        const program = programArg(op, args[0]);
        return typeof program === "string" ? fail2(program) : { ok: true, result: await behaviorDependencies(program, opts) };
      }
      case "program/read":
        return typeof args[0] === "string" ? await programReadOutcome(args[0], opts) : fail2("program/read: expected .lolo text");
      case "program/print": {
        const program = programArg(op, args[0]);
        return typeof program === "string" ? fail2(program) : { ok: true, result: await programPrint(program, opts) };
      }
      case "program/compose": {
        if (!Array.isArray(args[0])) return fail2("program/compose: expected a list of programs");
        const programs = [];
        for (const raw of args[0]) {
          const program = programArg(op, raw);
          if (typeof program === "string") return fail2(program);
          programs.push(program);
        }
        const options = args[1];
        if (options === null || options === void 0 || typeof options !== "object" || Array.isArray(options)) {
          return fail2("program/compose: options must be an object with an appName");
        }
        let appName;
        let layout;
        let theme;
        for (const [key, value] of Object.entries(options)) {
          if (key === "appName" && typeof value === "string" && value.length > 0) appName = value;
          else if (key === "theme" && typeof value === "string") theme = value.length > 0 ? value : void 0;
          else if (key === "layout") {
            const match = LAYOUT_STRATEGIES.find((l) => l === value);
            if (match === void 0) return fail2(`program/compose: layout must be one of ${LAYOUT_STRATEGIES.join(", ")}`);
            layout = match;
          } else return fail2(`program/compose: unsupported option "${key}"`);
        }
        if (appName === void 0) return fail2("program/compose: options must name the app (appName)");
        return { ok: true, result: await programCompose(programs, { appName, ...layout !== void 0 ? { layout } : {}, ...theme !== void 0 ? { theme } : {} }, opts) };
      }
      case "program/validate": {
        const program = programArg(op, args[0]);
        if (typeof program === "string") return fail2(program);
        const options = args[1] ?? {};
        if (options === null || typeof options !== "object" || Array.isArray(options)) return fail2("program/validate: options must be an object");
        let prior;
        let final;
        for (const [key, value] of Object.entries(options)) {
          if (key === "final") {
            if (typeof value !== "boolean") return fail2("program/validate: final must be a boolean");
            final = value;
          } else if (key === "prior") {
            const p = programArg("program/validate prior", value);
            if (typeof p === "string") return fail2(p);
            prior = p;
          } else return fail2(`program/validate: unsupported option "${key}"`);
        }
        return { ok: true, result: await programValidate(program, { ...opts, ...prior !== void 0 ? { prior } : {}, ...final !== void 0 ? { final } : {} }) };
      }
      case "program/eval": {
        const program = programArg(op, args[0]);
        if (typeof program === "string") return fail2(program);
        const options = args[1] ?? {};
        if (options === null || typeof options !== "object" || Array.isArray(options)) return fail2("program/eval: options must be an object");
        let workspace;
        let prior;
        let final;
        for (const [key, value] of Object.entries(options)) {
          if (key === "workspace") {
            if (typeof value !== "string" || value === "") return fail2("program/eval: workspace must be a non-empty id");
            workspace = value;
          } else if (key === "final") {
            if (typeof value !== "boolean") return fail2("program/eval: final must be a boolean");
            final = value;
          } else if (key === "prior") {
            const p = programArg("program/eval prior", value);
            if (typeof p === "string") return fail2(p);
            prior = p;
          } else return fail2(`program/eval: unsupported option "${key}"`);
        }
        const outcome = await programEval(program, { ...opts, ...workspace !== void 0 ? { workspace: { id: workspace, context: context ?? {} } } : {}, ...prior !== void 0 ? { prior } : {}, ...final !== void 0 ? { final } : {} });
        if (outcome.ok) return { ok: true, result: outcome.result };
        return { ok: false, error: `program/eval: ${outcome.errors.length} validation issue(s): ${outcome.errors.map((e) => e.message).join("; ")}`, errors: outcome.errors };
      }
    }
  } catch (error) {
    return fail2(error instanceof Error ? error.message : String(error));
  }
}
function resolveKernelDir(from = process.cwd()) {
  const named = process.env.ALMADAR_KERNEL_DIR;
  if (named !== void 0 && named !== "") return named;
  const entry = createRequire(join(resolve(from), "resolve.js")).resolve("@almadar/kernel");
  return dirname(dirname(entry));
}
function emitPayload(run, event, read) {
  const found = run.emits.find((emit) => emit.event === event);
  return found === void 0 ? void 0 : read(found.payload ?? {});
}
async function resolveProgramFile(path, cwd = dirname(resolve(path)), orb = resolveOrbBinary(cwd)) {
  const absolute = resolve(path);
  return new Promise((done, fail3) => {
    const child = spawn(orb, ["resolve", absolute], { cwd, stdio: ["ignore", "pipe", "pipe"] });
    const out = [];
    const err = [];
    child.stdout.on("data", (chunk) => out.push(chunk));
    child.stderr.on("data", (chunk) => err.push(chunk));
    child.on("error", fail3);
    child.on("close", (code) => {
      if (code !== 0) {
        fail3(new Error(`orb resolve ${absolute} exited ${code}: ${Buffer.concat(err).toString("utf8")}`));
        return;
      }
      const text = Buffer.concat(out).toString("utf8");
      done(JSON.parse(text.slice(text.indexOf("{"))));
    });
  });
}
var KernelProgram = class _KernelProgram {
  constructor(engine, os, schema, http, persistence) {
    this.engine = engine;
    this.os = os;
    this.schema = schema;
    this.http = http;
    this.persistence = persistence;
  }
  engine;
  os;
  schema;
  http;
  persistence;
  static async open(schema, options) {
    const languageFrom = { languageFrom: options.languageFrom };
    const native = options.engine === "native";
    if (options.store !== void 0 && !native) throw new Error("KernelProgram: `store` needs engine: 'native'");
    if (options.store !== void 0 && options.seed !== void 0) throw new Error("KernelProgram: `seed` fills the host store, which `store` replaces");
    const addon = native ? await loadNativeKernelModule(options.nativeAddon ?? resolveNativeAddon(options.languageFrom), languageFrom) : void 0;
    const kernelDir = addon === void 0 ? options.kernelDir ?? resolveKernelDir() : "";
    const kernel = addon ?? await loadKernelModule(kernelDir, languageFrom);
    installNodeHostPorts();
    const http = createHttpPorts({
      kernel: addon !== void 0 ? async () => addon : () => loadHttpKernel(kernelDir, languageFrom),
      ...options.http,
      egress: schema.egress ?? []
    });
    const persistence = new InMemoryPersistence();
    if (options.seed !== void 0) persistence.seed(options.seed);
    let engine;
    const requireEngine = () => {
      if (engine === void 0) throw new Error("KernelProgram: an os ask arrived before the program opened");
      return engine;
    };
    const os = options.os === true ? createNodeOsHost(kernelOsGrants(kernel, requireEngine)) : void 0;
    const ports = {
      persistence,
      callService: async () => null,
      programEffect: () => void 0,
      inFlightCalls: new InFlightCalls(),
      servicePorts: (caller, _user, message) => ({ caller, message, inputs: () => [], readableEntities: () => [], dispatchInput: async () => {
        throw new Error("KernelProgram has no input channel");
      }, read: async () => [] }),
      deliverLive: () => void 0,
      deferCallOutcome: () => void 0,
      http,
      ...os !== void 0 ? { os } : {}
    };
    engine = KernelEngine.open(kernel, schema, ports, options.store);
    return new _KernelProgram(engine, os, schema, http, persistence);
  }
  /** Fire `event` at the orbital as `user` (the program's `@user`), wait for its whole cascade (every `http` ask included), and return what it emitted. */
  async dispatch(orbital, event, payload = {}, targetTrait, user) {
    const response = await this.engine.evaluate(
      orbital,
      { event, payload, ...targetTrait !== void 0 ? { targetTrait } : {}, ...user !== void 0 ? { user } : {} },
      { orbital, ...user !== void 0 ? { user } : {} }
    );
    return {
      success: response.success,
      emits: response.emittedEvents,
      rejections: response.rejections ?? [],
      ...response.error !== void 0 ? { error: response.error } : {}
    };
  }
  /** Fire `trait`'s tick `name` once, as a host timer would; the kernel evaluates the tick's guard and effects. */
  async tick(orbital, trait, name) {
    const response = await this.engine.evaluate(orbital, { event: tickEventKey(name), runTick: { trait, tick: name }, targetTrait: trait }, { orbital });
    return {
      success: response.success,
      emits: response.emittedEvents,
      rejections: response.rejections ?? [],
      ...response.error !== void 0 ? { error: response.error } : {}
    };
  }
  /** Deliver an `/api/hooks/<name>` request to the program and return the answer it gave (EXEC-INBOUND-1). */
  async deliverInbound(name, delivery) {
    return dispatchInbound(this.schema, name, delivery, (orbital, request) => this.engine.evaluate(orbital, request, { orbital }), (credential) => this.http.secrets.get(credential, void 0));
  }
  /** The rows the host's in-memory store holds for `entity` (empty when the native kernel keeps its own `store`). */
  async rows(entity) {
    return this.persistence.list(entity);
  }
  close() {
    this.os?.close();
    this.engine.dispose();
  }
};

// src/index.ts
async function resolveHostNode(host) {
  if (isIP(host) !== 0) return { literal: true, addresses: [host] };
  const found = await lookup(host, { all: true });
  return { literal: false, addresses: found.map((entry) => entry.address) };
}
var nodeNetPort = { resolve: resolveHostNode, fetch: pinnedFetchNode };
function nodeCredentialScope() {
  return new AsyncLocalStorage();
}
var installed = false;
function installNodeHostPorts() {
  if (installed) return;
  installed = true;
  installNetPort(nodeNetPort);
  installCredentialScopeStorage(nodeCredentialScope());
}

export { KernelProgram, KvFailure, behaviorCatalog, behaviorCatalogSync, behaviorDependencies, behaviorDescribe, behaviorResolve, behaviorSource, createKvHost, createNodeOsHost, directoryKvBackend, emitPayload, initKernelSync, installNodeHostPorts, installWorkspaceHost, installedWorkspaceHost, loadHttpKernel, loadInstalledKernel, loadKernelModule, loadNativeKernelModule, loadOrCreateDevMasterKey, memoryKvBackend, mountBehaviorValue, mountTraitValue, namespaceId, nodeCredentialScope, nodeNetPort, pinnedFetchNode, programCompose, programEval, programPrint, programRead, programResolve, programResolveSchema, programStep, programValidate, resolveHostNode, resolveKernelDir, resolveNativeAddon, resolveProgramFile, runProgramEffect, uninstallWorkspaceHost, workspaceAccessError, workspaceOwnerSegment };

import { installNodeHostPorts } from './chunk-23YAOI6P.js';
import { loadNativeKernelModule, resolveNativeAddon, loadKernelModule, loadHttpKernel } from './chunk-UBZT5LDW.js';
import { workspaceOwnerSegment } from './chunk-BWMLDDCL.js';
import { mkdirSync, realpathSync, mkdtempSync, writeFileSync, rmSync, constants as constants$1 } from 'fs';
import { constants, homedir, tmpdir, loadavg, uptime, machine, version, release, hostname, type, userInfo } from 'os';
import { dirname, join, resolve } from 'path';
import { spawn } from 'child_process';
import { createRequire } from 'module';
import { createHttpPorts, NativeMemoryPersistenceAdapter, kernelOsGrants, InFlightCalls, KernelEngine, dispatchInbound, anchoredGrants, expandAnchor } from '@almadar/shell-runtime';
import { resolveOrbBinary } from '@almadar/core/behavior-package';
import { tickEventKey } from '@almadar/core';
import { lstat, chmod, stat, readlink, symlink, link, unlink, rename, copyFile, open, mkdir, readdir, rm, rmdir, access, chown } from 'fs/promises';
import { randomBytes } from 'crypto';
import { lookup } from 'dns/promises';
import { createSocket } from 'dgram';
import { isIP, createServer, createConnection } from 'net';
import { isatty } from 'tty';
import { createLogger } from '@almadar/logger';

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
function fail(failure2) {
  throw failure2;
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
      await new Promise((resolve2) => {
        const timer = left === void 0 ? void 0 : setTimeout(resolve2, left);
        this.wake = () => {
          if (timer !== void 0) clearTimeout(timer);
          resolve2();
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
  return new Promise((resolve2, reject) => {
    const timer = setTimeout(() => reject(errnoError("EAGAIN")), timeoutMs);
    stream.write(data, (error) => {
      if (timer !== void 0) clearTimeout(timer);
      if (error) reject(error);
      else resolve2();
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
  else if (entry.kind === "listener") entry.server.close();
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
      await new Promise((resolve2, reject) => {
        stream.write(data, (error) => error ? reject(error) : resolve2());
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
    closeSock(entry);
    return true;
  }
  async run(op, args) {
    switch (op) {
      case "os/tcp-listen":
        throw invalid(op, "a stream needs a key and a call site");
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
  /**
   * The keyed listening stream of `os/tcp-listen` (native `listen`): binds, answers `{ sock, address, port }`, then hands
   * each accepted connection to `accept` as `{ sock, peer }`; a connection no one takes is closed. Closing the listener's
   * handle stops listening.
   */
  async listen(op, args, accept, fail2) {
    const name = hostArg(args, 0, op);
    const port = portArg(args, 1, op);
    this.checkGrant(op, name, port, "listen");
    const literal = isIP(name);
    const [address] = literal !== 0 ? [{ address: name, family: literal === 6 ? 6 : 4 }] : await this.resolve(op, name);
    if (address === void 0) throw osFailure("not-found", op, `${name} did not resolve`);
    const server = createServer();
    await new Promise((resolve2, reject) => {
      server.once("error", reject);
      server.listen({ host: address.address, port }, () => {
        server.off("error", reject);
        resolve2();
      });
    }).catch((raised) => {
      throw netFailure(op, raised);
    });
    const id = this.state.allocate();
    this.state.socks.set(id, { kind: "listener", server });
    server.on("connection", (socket) => {
      if (!this.state.socks.has(id)) {
        socket.destroy();
        return;
      }
      const conn = this.state.allocate();
      this.state.socks.set(conn, { kind: "stream", socket, source: new ByteSource(socket, SOCKET_HIGH_WATER), shut: false });
      if (!accept({ sock: conn, peer: peerOf(socket) })) {
        this.state.socks.delete(conn);
        socket.destroy();
      }
    });
    server.on("error", (raised) => {
      if (this.state.socks.delete(id)) server.close();
      fail2(netFailure(op, raised).error);
    });
    const bound = server.address();
    if (bound === null || typeof bound === "string") throw osFailure("io", op, "the listener has no address");
    return { sock: id, address: bound.address, port: bound.port };
  }
  /** Stop the listener `id` (the stream's cancel): its handle closes and no connection is accepted after. */
  stopListening(id) {
    const entry = this.state.socks.get(id);
    if (entry?.kind !== "listener") return;
    this.state.socks.delete(id);
    entry.server.close();
  }
  connectOnce(address, port) {
    return new Promise((resolve2, reject) => {
      const socket = createConnection({ host: address.address, port, autoSelectFamily: false });
      const timer = setTimeout(() => {
        socket.destroy();
        reject(new TextIoError("ETIMEDOUT", "connection timed out"));
      }, CONNECT_TIMEOUT_MS);
      socket.once("connect", () => {
        clearTimeout(timer);
        resolve2(socket);
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
    return new Promise((resolve2, reject) => {
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
      socket.once("listening", () => resolve2(entry));
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
      const sent = await new Promise((resolve2) => {
        entry.socket.send(data, port, address.address, (error) => resolve2(error ?? void 0));
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
      await new Promise((resolve2) => {
        const timer = setTimeout(resolve2, left);
        entry.wake = () => {
          clearTimeout(timer);
          resolve2();
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
function peerOf(socket) {
  const host = socket.remoteAddress ?? "";
  const port = socket.remotePort ?? 0;
  return isIP(host) === 6 ? `[${host}]:${port}` : `${host}:${port}`;
}
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
    const exit = new Promise((resolve2) => {
      child.once("exit", (code, signal) => resolve2({ code, signal: signal === null ? null : SIGNALS[signal] ?? null }));
    });
    const started = await new Promise((resolve2) => {
      child.once("spawn", () => resolve2(void 0));
      child.once("error", (error) => resolve2(error));
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
    await new Promise((resolve2, reject) => {
      stream.write(data, (error) => error ? reject(error) : resolve2());
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
var log = createLogger("almadar:host:os");
function failureOf(op, raised) {
  if (raised instanceof OsFailure) return raised.error;
  return { kind: "io", message: `${op}: ${raised instanceof Error ? raised.message : String(raised)}` };
}
var NodeOsHost = class {
  constructor(given, anchors) {
    this.given = given;
    this.anchors = anchors;
    this.state = new OsState(anchors);
    const grants = anchoredGrants(given, anchors);
    this.fs = new FsOps(this.state, grants);
    this.process = new ProcessOps(this.state, grants);
    this.net = new NetOps(this.state, grants);
    this.sys = new SysOps(grants);
  }
  given;
  anchors;
  state;
  fs;
  process;
  net;
  sys;
  placed = false;
  /** The listener handle of each open stream, by its key. */
  streams = /* @__PURE__ */ new Map();
  /** The call's arguments with every anchored part resolved by the kernel, the program's anchors placed on the first call. */
  resolved(op, args) {
    if (!this.placed) {
      for (const problem of this.given.anchor(this.anchors)) log.warn("anchor:grants-nothing", { at: problem.path, message: problem.message });
      this.placed = true;
    }
    const resolved = this.given.resolveArgs(op, args);
    if ("error" in resolved) throw new OsFailure(resolved.error);
    return resolved.ok;
  }
  async dispatch(op, given) {
    const args = this.resolved(op, given);
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
      blocking = this.deferral(op, this.resolved(op, args));
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
  /** A keyed stream (EXEC-QUEUE-12): `os/tcp-listen` binds and answers in place, then each connection reaches `message`. */
  async stream(op, args, key, message, fail2) {
    try {
      if (op !== "os/tcp-listen") throw osFailure("unsupported", op, "this host streams only os/tcp-listen");
      if (this.streams.has(key)) throw invalid(op, `key ${key} already has a stream open`);
      const answer = await this.net.listen(op, this.resolved(op, args), message, (error) => {
        this.streams.delete(key);
        fail2(error);
      });
      this.streams.set(key, answer.sock);
      return { ok: answer };
    } catch (raised) {
      return { error: failureOf(op, raised) };
    }
  }
  cancel(key) {
    const listener = this.streams.get(key);
    if (listener !== void 0) {
      this.streams.delete(key);
      this.net.stopListening(listener);
      return true;
    }
    return this.state.completions.cancel(key);
  }
  close() {
    this.state.close();
  }
};
function processAnchors() {
  const env = {};
  for (const [name, value] of Object.entries(process.env)) if (value !== void 0) env[name] = value;
  return { home: homedir(), start: process.cwd(), exeDir: dirname(process.execPath), env };
}
function createNodeOsHost(grants, options = {}) {
  return new NodeOsHost(grants, options.anchors ?? processAnchors());
}

// src/kernel-program.ts
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
  return new Promise((done, fail2) => {
    const child = spawn(orb, ["resolve", absolute], { cwd, stdio: ["ignore", "pipe", "pipe"] });
    const out = [];
    const err = [];
    child.stdout.on("data", (chunk) => out.push(chunk));
    child.stderr.on("data", (chunk) => err.push(chunk));
    child.on("error", fail2);
    child.on("close", (code) => {
      if (code !== 0) {
        fail2(new Error(`orb resolve ${absolute} exited ${code}: ${Buffer.concat(err).toString("utf8")}`));
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
    const persistence = new NativeMemoryPersistenceAdapter(new kernel.MemoryStore());
    for (const [entityType, rows] of Object.entries(options.seed ?? {})) {
      for (const row of rows) await persistence.writeWhere({ kind: "upsert", entityType, data: row });
    }
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

// src/program/kernel-workspace-host.ts
var GCS_ENDPOINT = "https://storage.googleapis.com";
var WORKSPACE_HMAC_KEY_ID = "ALMADAR_WORKSPACE_HMAC_KEY_ID";
var WORKSPACE_HMAC_SECRET = "ALMADAR_WORKSPACE_HMAC_SECRET";
function workspaceBucketFromEnv(env) {
  const name = env.ALMADAR_WORKSPACE_BUCKET;
  if (name === void 0 || name === "") return void 0;
  return { name, endpoint: GCS_ENDPOINT, region: "auto", accessKeyId: WORKSPACE_HMAC_KEY_ID, secretAccessKey: WORKSPACE_HMAC_SECRET };
}
var ORBITAL = "Workspaces";
var TRAIT = `${ORBITAL}WorkspaceClient`;
function workspacesRoot(projectRoot) {
  return join(projectRoot, "workspaces");
}
function programText(root, bucket) {
  const egress = bucket === void 0 ? "" : `
  egress: [${JSON.stringify(bucket.endpoint)}],`;
  return `app kernel-workspace-host [
  version: "1.0.0",
  description: "The program host's workspaces, run by std-workspace.",${egress}
  fs: { ${JSON.stringify(`${root}/**`)}: [read, write, create, remove] },
  exec: ["git"]
]
uses Ws from "std/behaviors/std-workspace"
orbital ${ORBITAL} = Ws.orbitals.WorkspaceOrbital {${bucket === void 0 ? `
  traits { WorkspaceClient { config { root: ${JSON.stringify(root)} } } }` : `
  traits {
    WorkspaceClient { config { root: ${JSON.stringify(root)}, store: bucket, bucket: ${JSON.stringify(bucket.name)} } }
    WorkspaceStore { config { endpoint: ${JSON.stringify(bucket.endpoint)}, region: ${JSON.stringify(bucket.region)}, bucket: ${JSON.stringify(bucket.name)}, accessKeyId: ${JSON.stringify(bucket.accessKeyId)}, secretAccessKey: ${JSON.stringify(bucket.secretAccessKey)} } }
  }`}
}
`;
}
function failure(run, failed, what) {
  const detail = emitPayload(run, failed, (p) => typeof p.message === "string" ? p.message : "");
  return new Error(`workspace ${what} failed: ${detail ?? run.error ?? "no answer"}`);
}
function snapshots(payload) {
  const rows = payload.snapshots;
  if (!Array.isArray(rows)) return [];
  return rows.flatMap(
    (row) => typeof row === "object" && row !== null && !Array.isArray(row) && typeof row.id === "string" && typeof row.timestamp === "number" && typeof row.reason === "string" ? [{ id: row.id, timestamp: row.timestamp, reason: row.reason }] : []
  );
}
function kernelWorkspaceHost(options) {
  const root = workspacesRoot(options.projectRoot);
  let program;
  let tail = Promise.resolve();
  const open2 = () => {
    program ??= (async () => {
      mkdirSync(root, { recursive: true });
      const granted = realpathSync(root);
      const dir = mkdtempSync(join(tmpdir(), "almadar-workspace-host-"));
      try {
        const file = join(dir, "workspace-host.lolo");
        writeFileSync(file, programText(granted, options.bucket));
        const schema = await resolveProgramFile(file, options.projectRoot, options.orb);
        return await KernelProgram.open(schema, { ...options.kernel, languageFrom: options.projectRoot, os: true });
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    })();
    return program;
  };
  const run = (principal, event, payload, read) => {
    const next = tail.then(async () => read(await (await open2()).dispatch(ORBITAL, event, payload, TRAIT, { id: principal })));
    tail = next.catch(() => void 0);
    return next;
  };
  return {
    root,
    async open(workspace, context) {
      const principal = context.principal;
      if (principal === void 0 || principal === "") throw new Error("A workspace needs a signed-in caller");
      return {
        workDir: join(root, workspaceOwnerSegment(principal), workspaceOwnerSegment(workspace)),
        writeFile: (path, content) => run(principal, "WORKSPACE_WRITE_FILE", { workspace, path, content }, (r) => {
          if (emitPayload(r, "WORKSPACE_FILE_WRITTEN", (p) => p.written) !== true) throw failure(r, "WORKSPACE_WRITE_FAILED", `write of ${path}`);
        }),
        snapshot: (reason) => run(principal, "WORKSPACE_SNAPSHOT", { workspace, reason }, (r) => {
          const taken = emitPayload(r, "WORKSPACE_SNAPSHOT_TAKEN", (p) => ({ committed: p.committed === true, oid: typeof p.oid === "string" ? p.oid : "" }));
          if (taken === void 0) throw failure(r, "WORKSPACE_SNAPSHOT_FAILED", "snapshot");
          return taken.committed ? { oid: taken.oid } : null;
        }),
        listSnapshots: (opts) => run(principal, "WORKSPACE_HISTORY", { workspace, ...opts?.limit !== void 0 ? { limit: opts.limit } : {} }, (r) => {
          const found = emitPayload(r, "WORKSPACE_HISTORY_LOADED", snapshots);
          if (found === void 0) throw failure(r, "WORKSPACE_HISTORY_FAILED", "history");
          return found;
        })
      };
    }
  };
}

export { GCS_ENDPOINT, KernelProgram, WORKSPACE_HMAC_KEY_ID, WORKSPACE_HMAC_SECRET, createNodeOsHost, emitPayload, kernelWorkspaceHost, processAnchors, resolveKernelDir, resolveProgramFile, workspaceBucketFromEnv, workspacesRoot };

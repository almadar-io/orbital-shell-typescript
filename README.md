<div align="center">

# orbital-shell-typescript

**The TypeScript shell: generates the React + Express web app for a compiled Orbital program, and hosts the `@almadar/core` npm package and the web, node and Chrome host packages.**

[![CI](https://github.com/almadar-io/orbital-shell-typescript/actions/workflows/ci.yml/badge.svg)](https://github.com/almadar-io/orbital-shell-typescript/actions/workflows/ci.yml) [![CI almadar-shell](https://github.com/almadar-io/orbital-shell-typescript/actions/workflows/ci-almadar-shell.yml/badge.svg)](https://github.com/almadar-io/orbital-shell-typescript/actions/workflows/ci-almadar-shell.yml) [![npm @almadar/core](https://img.shields.io/npm/v/@almadar/core)](https://www.npmjs.com/package/@almadar/core) [![License: BUSL-1.1](https://img.shields.io/badge/license-BUSL--1.1-blue)](LICENSE)

</div>

<p align="center"><sub>Part of <a href="https://github.com/almadar-io/orb"><b>Orb</b></a>: the language where the rule is the program. <a href="https://orb.almadar.io">orb.almadar.io</a></sub></p>

This repo is the TypeScript side of the Orbital compiler. Its Rust crate (`orb-shell-typescript`) turns a compiled program into a web project: a React client and an Express server, from the `almadar-shell` template. It also holds the TypeScript packages the generated app and other hosts import, including `@almadar/core`, the language data (types and pattern registry) that every shell reads.

## Where this fits

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/almadar-io/orb/main/static/img/readme/architecture/orbital-shell-typescript-dark.svg">
  <img src="https://raw.githubusercontent.com/almadar-io/orb/main/static/img/readme/architecture/orbital-shell-typescript-light.svg" width="100%" alt="Where orbital-shell-typescript sits in the Almadar architecture">
</picture>

| Upstream (this repo depends on) | Downstream (depends on this repo) |
|---|---|
| [orbital-core](https://github.com/almadar-io/orbital-core): IR, evaluator and kernel (`orbital-core-base`, `orbital-core-eval`) | [orbital-cli](https://github.com/almadar-io/orbital-cli): the `orb` binary, which runs this shell as `orb-shell-typescript` for `orb compile --shell typescript` |
| [orbital-wasm](https://github.com/almadar-io/orbital-wasm): the kernel host API behind `bridges/node` only | [almadar-std](https://github.com/almadar-io/almadar-std), [behaviors](https://github.com/almadar-io/behaviors) and the apps import `@almadar/core` from this repo's `core/` |

## Quick start

Generate a web app from a compiled program (needs the `orb` CLI installed):

```bash
orb compile <program.orb> --shell typescript -o <out-dir>
cd <out-dir> && npm run build && npm run dev
```

`npm run build`, `npm run dev` and `npm test` are the commands the shell declares for the generated project.

## How `orb compile --shell typescript` uses it

`orb` runs the `orb-shell-typescript` program. It writes the `templates/almadar-shell` project (React client in `packages/client`, Express server in `packages/server`) plus the generated code at the project root, and ships the native kernel add-on `kernel.node` into the project's `kernel/` directory. The generated server runs its execution steps on the embedded `@almadar/kernel`: the `host` option accepts only `kernel` (the generated handlers and hooks are retired). Other options: `schemaLanguage`, `typeProjection` (`wire` or `hostInput`), `devLogs`, `backendUrl` (written to `.env` as `VITE_API_URL`), `projectPatterns`. `bridges/node` is the Rust crate (`orbital-node`, N-API) that builds the `kernel.node` add-on over `orbital-wasm`.

## What's inside

| Path | Contents |
|---|---|
| `src/` | The Rust crate: codegen, backend, `orb-shell-typescript` program |
| `templates/almadar-shell/` | Express + React web template (npm `@almadar/shell`) |
| `templates/almadar-web-client/` | Prebuilt program-independent web client |
| `templates/chrome-shell/` | Chrome-extension template (private package) |
| `bridges/node/` | `orbital-node`: the native Node add-on of the kernel |
| `core/`, `hosts/`, `renderers/web/`, `runtime/`, `tooling/` | The TypeScript packages below |
| `tests/` | Rust integration tests (codegen type-check, kernel host, program binary) |

## Packages published to npm

Each is published by tag `<key>-v<version>` through `publish-npm.yml`; the template has its own `almadar-shell-v*` workflow.

| Path | npm name | Purpose |
|---|---|---|
| `core/` | `@almadar/core` | Core schema types and definitions for Almadar: the language data every shell reads |
| `renderers/web/` | `@almadar/shell-web` | Web renderer pack: browser host ports of the kernel and the React render substrate |
| `hosts/node/` | `@almadar/shell-node` | Node `os/*` and `program/*` host of the kernel |
| `hosts/browser/` | `@almadar/shell-browser` | Browser I/O ports: IndexedDB, page facts, Firebase sign-in SDK |
| `hosts/chrome/` | `@almadar/shell-chrome` | Chrome-extension host ports of the kernel |
| `runtime/kernel/` | `@almadar/shell-runtime` | Renderer-neutral kernel adapters and client orchestration |
| `runtime/logger/` | `@almadar/logger` | Diagnostics ports: console, structured log sinks, timing |
| `tooling/syntax/` | `@almadar/syntax` | Syntax highlighting for Orb programs |
| `tooling/eslint/` | `@almadar/eslint-plugin` | ESLint rules for Almadar component architecture |
| `templates/almadar-shell/` | `@almadar/shell` | Full-stack web shell template |

## Development

- Rust crate: `cargo test` after the npm install above (CI also checks `bridges/node/Cargo.toml` and `src/chrome/Cargo.toml` with `cargo metadata`). Toolchain pinned to Rust 1.93.0.
- `@almadar/core` (from `core/`): `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm build`, `pnpm test`. Never hand-edit `dist/`, `src/patterns/*.json` or `pattern-types.ts`; they are generated.
- Each package has its own `package.json` scripts; for example `hosts/node` defines `build` (`tsup`), `typecheck` (`tsc --noEmit`) and `test` (`vitest --run`).
- Language data for the crate comes from the npm packages:

```bash
npm install --no-save --no-package-lock @almadar/core@^10 @almadar/std@^16 @almadar/lolo-ar@^1 @almadar/lolo-sl@^1
cargo test
```

Open gaps are tracked in [Almadar_Gaps.md](Almadar_Gaps.md). Work on `main`; never create a feature branch.

## Docs

- [Orb documentation](https://orb.almadar.io/docs): the language, the `orb` CLI and how the pieces fit

## License

[Business Source License 1.1](LICENSE): free for non-commercial and evaluation use; converts to Apache-2.0 on the change date.

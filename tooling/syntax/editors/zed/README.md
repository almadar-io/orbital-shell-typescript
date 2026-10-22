# Almadar Orbital Extension for Zed

Language support for `.lolo` and `.orb` files, maintained in
`almadar-io/orbital-shell-typescript` under `tooling/syntax/editors/zed`.

## Features

- Tree-sitter highlighting for `.lolo` and JSON-based `.orb` programs
- Diagnostics, completion, and hover through `@almadar/orb-lsp`
- Bracket matching and comment toggling

## Install from the local checkout

Install Rust through rustup, and make `orb` available on Zed's PATH for
validation. The extension installs `@almadar/orb-lsp` from npm automatically.

In Zed, run `zed: install dev extension` from the command palette and select:

```text
/Users/osamaalghanmi/kflow.ai.builder/orbital-rust/crates/orbital-shell-typescript/tooling/syntax/editors/zed
```

Zed builds the Rust extension and downloads the grammar from the repository,
revision, and subdirectory declared in `extension.toml`. It does not compile
`tree-sitter-lolo` from the local working tree. Zed automatically installs the
WebAssembly target when Rust is managed by rustup, and downloads wasi-sdk for
the grammar build. See [Zed's development guide](https://zed.dev/docs/extensions/developing-extensions).

## Check and update the grammar

From `tooling/syntax`:

```sh
pnpm run check:zed
```

After changing the grammar, commit and push it to `almadar-io/orbital-shell-typescript`,
then update `[grammars.lolo].rev` to that full commit SHA. Keep its repository
and `tooling/syntax/editors/zed/tree-sitter-lolo` path aligned with the shell
repository. Reinstall the dev extension to rebuild; use `zed: open log` for
build or language-server errors.

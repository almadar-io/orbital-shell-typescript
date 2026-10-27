<!-- Gap ledger for this repo: the source of truth for its open gaps. Managed with scripts/gaps-ledger.mjs in the Almadar monorepo. -->
# @almadar/syntax — open gaps

Every open gap this repo owns lives here. This file is the source of truth; the monorepo's `docs/Almadar_Gaps.md` only rolls it up.

- **One entry per gap:** `- **<code>** — <what is wrong and where>. <owning package> [mechanical|architectural] — <evidence, prevention rung>`. `[mechanical]` = small and well-scoped; `[architectural]` = needs design judgment.
- **Codes:** new gaps use this repo's prefix `G-SYNTAX-`. Take the "Next code" below, then bump it in the same edit. Codes are never reused or renamed.
- **Close by deleting.** Remove the entry in the same commit as the fix. There is no "closed" section; git history is the record.
- **Cross-repo gaps don't go here.** If fixing it needs another repo, describe it in your report or PR body; the monorepo coordinator files it.

Next code: `G-SYNTAX-003`

## Open gaps

- **G-EXTENSIONS-002** — `editors/zed/tree-sitter-lolo` corpus tests "Trait with state and effect" and "Guard transition with operator symbol" fail at HEAD (`tree-sitter test`: 2/9 failed before the 2026-10-08 modifier-bracket change too): the expected trees name a `sexpr_op` node the generated parser no longer produces. Regenerate expectations or restore the node. The grammar also lags the language (no `uses`, `theme`, `locales` rules). `editors/zed/tree-sitter-lolo/` [mechanical] — found 2026-10-08. Prevention rung: tooling regression gate (`tree-sitter test` in CI). Root cause: T4.
- **G-EXTENSIONS-001** — The Orb LSP ignores `orb validate --json`'s `line`/`column`/`endLine`/`endColumn`/`approximate`: it derives positions by regex on the `path` string and underlines to end of line. Use the reported span (approximate → a hint-severity range). `lsp/src/server.ts` [mechanical] — found 2026-09-28 Root cause: T1.
- **G-EXTENSIONS-004** — The language server's `orb` lookup converges on `@almadar/core` `resolveOrbBinary` (owner rulings 2026-10-19: converge keeping the editor's `orbBin`, and apply now). DONE 2026-10-19, uncommitted: core's resolver covers what only the LSP had (the installed `@almadar/orb`'s native platform binary, Windows `orb.exe` and `where`, `~/.local/bin` and `/usr/local/bin` after PATH); `lsp/src/binary-resolution.ts` returns the editor's `orbBin` when `ORB_BIN`/`ORBITAL_BIN` are unset (a missing one is refused by name), else core's order over the workspace root, cwd and the bundle dir; tsup bundles `@almadar/core`; the six resolver tests in `server.test.ts` pass against the workspace core. OPEN: `lsp/` is a standalone npm package whose `package-lock.json` pins `@almadar/core` 10.70.0, which has no `./behavior-package` export, so its own install, typecheck, build and tests fail until core publishes and `lsp`'s lock is refreshed to that version (owner accepted the red window). `lsp/package-lock.json` [mechanical] — prevention rung: none of the language rungs (tooling duplicate); core's `orb-binary.test.ts` pins the shared order. Root cause: T1.


<!-- Gap ledger for this repo: the source of truth for its open gaps. Managed with scripts/gaps-ledger.mjs in the Almadar monorepo. -->
# @almadar/syntax — open gaps

Every open gap this repo owns lives here. This file is the source of truth; the monorepo's `docs/Almadar_Gaps.md` only rolls it up.

- **One entry per gap:** `- **<code>** — <what is wrong and where>. <owning package> [mechanical|architectural] — <evidence, prevention rung>`. `[mechanical]` = small and well-scoped; `[architectural]` = needs design judgment.
- **Codes:** new gaps use this repo's prefix `G-SYNTAX-`. Take the "Next code" below, then bump it in the same edit. Codes are never reused or renamed.
- **Close by deleting.** Remove the entry in the same commit as the fix. There is no "closed" section; git history is the record.
- **Cross-repo gaps don't go here.** If fixing it needs another repo, describe it in your report or PR body; the monorepo coordinator files it.

Next code: `G-SYNTAX-004`

## Open gaps

- **G-SYNTAX-003** — `orb-lsp` (`lsp/src/server.ts`) advertises only `completionProvider`, no `hoverProvider`: hovering an operator head in a `.lolo` s-expression (`array/groupBy`, `object/get`, `set`) shows nothing, so editors must open the whole `orb signatures` catalog to read one operator's arity, types and description. Answer `textDocument/hover` on a call head from the same signatures data completion already reads. `lsp/` [mechanical] — found 2026-10-30. Prevention rung: none of the three (editor tooling). Root cause: one-off.
- **G-EXTENSIONS-002** — `editors/zed/tree-sitter-lolo` corpus tests "Trait with state and effect" and "Guard transition with operator symbol" fail at HEAD (`tree-sitter test`: 2/9 failed before the 2026-10-08 modifier-bracket change too): the expected trees name a `sexpr_op` node the generated parser no longer produces. Regenerate expectations or restore the node. The grammar also lags the language (no `uses`, `theme`, `locales` rules). `editors/zed/tree-sitter-lolo/` [mechanical] — found 2026-10-08. Prevention rung: tooling regression gate (`tree-sitter test` in CI). Root cause: T4.



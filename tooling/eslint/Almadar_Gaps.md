<!-- Gap ledger for this repo: the source of truth for its open gaps. Managed with scripts/gaps-ledger.mjs in the Almadar monorepo. -->
# @almadar/eslint-plugin — open gaps

Every open gap this repo owns lives here. This file is the source of truth; the monorepo's `docs/Almadar_Gaps.md` only rolls it up.

- **One entry per gap:** `- **<code>** — <what is wrong and where>. <owning package> [mechanical|architectural] — <evidence, prevention rung>`. `[mechanical]` = small and well-scoped; `[architectural]` = needs design judgment.
- **Codes:** new gaps use this repo's prefix `G-ESLINT-`. Take the "Next code" below, then bump it in the same edit. Codes are never reused or renamed.
- **Close by deleting.** Remove the entry in the same commit as the fix. There is no "closed" section; git history is the record.
- **Cross-repo gaps don't go here.** If fixing it needs another repo, describe it in your report or PR body; the monorepo coordinator files it.

Next code: `G-ESLINT-003`

## Open gaps

- **G-ESLINT-001** — No rule flags a click handler on a non-interactive element (`onClick` on `Box`/`HStack`/`Card` without `action`/`role`/keyboard support); the 2026-09-30 UI audit fixed ~30 such sites by hand (`@almadar/ui` `lib/pressable.ts` is the sanctioned route). Add a rule for `@almadar/ui` + consumers. [mechanical] — prevention rung: lint
- **G-ESLINT-002** — No rule flags a hardcoded user-visible string in `@almadar/ui` components (JSX text / `label`/`placeholder`/`aria-label` literals not routed through `t()`), nor a `t('key')` whose key is missing from the locale tables; the audit found both by hand. [mechanical] — prevention rung: lint
_No open gaps._

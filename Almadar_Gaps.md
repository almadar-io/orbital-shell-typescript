<!-- Gap ledger for this repo: the source of truth for its open gaps. -->
# orbital-shell-typescript — open gaps

Every open gap this repo owns lives here. This file is the source of truth; the monorepo's `docs/Almadar_Gaps.md` only rolls it up.

- **One entry per gap:** `- **<code>** — <what is wrong and where>. <owning package> [mechanical|architectural] — <evidence, prevention rung>`.
- **Codes:** new gaps use this repo's prefix `G-ORBITAL-SHELL-TYPESCRIPT-`. Take the "Next code" below, then bump it in the same edit. Codes are never reused or renamed.
- **Close by deleting.** Remove the entry in the same commit as the fix.

Next code: `G-ORBITAL-SHELL-TYPESCRIPT-006`

- **G-ORBITAL-SHELL-TYPESCRIPT-005** — Mapped render-ui children carry no React `key`: `try_mapped_children_jsx` (`codegen/pattern/registry.rs`) emits `{(xs).map((x) => (<Node …/>))}`, so every list (kflow-site-chrome's header links, for one) logs "Each child in a list should have a unique key" and React reconciles rows by index — an inserted or reordered row reuses its neighbour's state. Key by the element's `id` when the row declares one, else by index explicitly. Prevention rung: a pattern codegen unit test asserting `key=` on mapped children. [mechanical]

- **G-ORBITAL-SHELL-TYPESCRIPT-003** — Nothing typechecks a full-mode compile of a real organism: std-kflow's `orb compile --mode full` emitted 559 client tsc errors (a `let` named `fields` shadowing the shell mirror, views without `now` for `time/relative`, unparenthesized union array casts, raw `array/sum`/`array/range` operands, payload-sourced mapped children, required `string | number` props cast with `| undefined`, computed `entity` lists, awaiting-skeleton literals, nested object-prop members, deep client entity reads, nullable arithmetic operands, `SExpr` handler payloads, literal persist rows); each class is fixed with a unit test (2026-10-12), but the next class will again only surface in a deploy. Add a gate that compiles a fixed set of organisms (std-kflow, std-notes, one game and one learning lab) in full mode and runs `tsc --noEmit` on client and server. Prevention rung: that compiled-typecheck gate (`orb verify --compiled` or the crate's CI). `[architectural]`
- **G-ORBITAL-SHELL-TYPESCRIPT-004** — Email-link sign-in loses the page the viewer was sent from: the template `Login.tsx` completes the link with `history.replaceState(…, '/login')` and then navigates to `/` because the `returnTo` navigation state did not survive the email round trip. A viewer gated off `/home` lands on the public `/` after signing in by link (Google popup and password keep `returnTo`). Carry `returnTo` through the link's `continueUrl`. Prevention rung: a template unit test for each sign-in method returning to `returnTo`. [mechanical]

- **G-ORBITAL-SHELL-TYPESCRIPT-002** — The generated server is stateless, so a server-run tick cannot know the trait's current state: `src/backend/server/ticks.rs` fixes `state` to the initial state and cannot honor `appliesTo`; the shared-frame writer driver (`src/codegen/effect/tick.rs`, one driver for several writer traits) has no per-writer state either. Per-trait client ticks honor `appliesTo` since 2026-10-12. Blocked on G-CROSS-160 (D-10, the compiled cascade / one-kernel decision). Prevention rung: `orb verify` tick fixture in a non-initial state on the compiled path. `[architectural]`


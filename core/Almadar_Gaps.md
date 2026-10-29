<!-- Gap ledger for this repo: the source of truth for its open gaps. Managed with scripts/gaps-ledger.mjs in the Almadar monorepo. -->
# @almadar/core — open gaps

Every open gap this repo owns lives here. This file is the source of truth; the monorepo's `docs/Almadar_Gaps.md` only rolls it up.

- **One entry per gap:** `- **<code>** — <what is wrong and where>. <owning package> [mechanical|architectural] — <evidence, prevention rung>`. `[mechanical]` = small and well-scoped; `[architectural]` = needs design judgment.
- **Codes:** new gaps use this repo's prefix `G-CORE-`. Take the "Next code" below, then bump it in the same edit. Codes are never reused or renamed.
- **Close by deleting.** Remove the entry in the same commit as the fix. There is no "closed" section; git history is the record.
- **Cross-repo gaps don't go here.** If fixing it needs another repo, describe it in your report or PR body; the monorepo coordinator files it.

Next code: `G-CORE-033`


## Open gaps

- **G-CORE-026** — Most of the 47 entries in `src/patterns/event-contracts.json` type their payloads as a bare `{type: "object"}`, a generic type that the owner's no-generic-types ruling forbids. Under D4 that JSON becomes the authored UI contract (core is the source of truth), so freezing it as-is would carry the debt into the source. Wanted: every event payload declares its fields, before or during the D4 freeze slice. Found by D4, 2026-10-21. D7 counted 64 of 102 emit entries as untyped. The generator hardcodes `object` (pattern-sync `parser.ts` ~2601, ~2566), and about 10 are untyped in the source too. [mechanical] Root cause: H3.
  - **Decided:** don't fix the retiring generator. The typed per-event payload map is authored in `@almadar/core` as part of the D4 contract freeze, and `@almadar/ui` `emit` becomes generic over it.
  - Field list with file:line: scratchpad `d7-event-payloads.keep.md`. `@almadar/core` patterns [mechanical]. Prevention rung: `.lolo` type system (payload typing).
- **G-CORE-025** — One `.lolo` file that does not lower fails the WHOLE behavior package mirror: `behaviorRegistryDir` (`src/behavior-package.ts` ~493) throws `BehaviorPackageError` for the package, so every `std/behaviors/*` import in every runtime and verifier fails with "std behavior not found in registry" while any agent has a half-written atom on disk (2026-10-17: an in-progress `std-redis.lolo` broke all std composition). Fix: lower per file, and refuse only imports of the broken file, with that file's exact lowering error (loud, never skipped silently). `orb behaviors index` already logs and skips per file (`behaviors_index.rs` ~657), so converge both readers on one per-file rule. `@almadar/core` [mechanical] — rung: tooling (a mirror test with one broken file and one good file: the good import resolves, the broken one errors with its parse location). Root cause: H3.




### Foundation / Core tier (`@almadar/core`, patterns, logger, validation, analytics, i18n tables)

- **G-CORE-029** — The `SpriteSheetAtlas` contract (and the `AnimationDef`/`SpriteDirection` it uses) exists only as zod and a TS interface in `src/types/asset.ts` (`SpriteSheetAtlasSchema`, `AnimationDefSchema`, `SPRITE_DIRECTIONS`); no data form (generated `.lolo` type or JSON schema) is exported, so a `.lolo` program can't check a sidecar atlas json against it and `packages/almadar-behaviors/behaviors/lolo/assets/atoms/asset-board-coverage.lolo` carries a hand-written second copy of the atlas rules (frame size/columns/rows positive ints, directions in se/sw/ne/nw, sheets keyed by direction, per-animation row/frames/frameRate/loop, optional projections). `@almadar/core` [architectural] — evidence: the coverage atom's `ATLAS_OK` clause block; rung: `.lolo` types. Acceptance: core generates a `SpriteSheetAtlas` `.lolo` type from the zod schema (same generator that feeds the other core types), the coverage atom parses the sidecar with `json/parse` into it, and the hand-written clauses are deleted. Root cause: H3.
  Consumers to repoint once the shared `.lolo` Asset type exists: the 22 local `type Asset = {…}` copies in the io board organisms (`ui-arena`, `ui-battle`, `ui-boardgame`, `ui-castle`, `ui-city-builder`, `ui-fishing`, `ui-grid-tactics-demo`, `ui-hex-strategy`, `ui-match-puzzle`, `ui-pinball`, `ui-pirate`, `ui-roguelike`, `ui-space-shmup`, `ui-tactics-demo-2d`, `ui-tanks`, `ui-top-down-shooter`, `ui-topdown-dungeon`, `ui-topdown-rts`, `ui-tower-defense`, `ui-uncontrolled-battle`, `ui-winter-ski`, `ui-world-map`) plus `DndAsset` (`dnd-dungeon-delver`) and `RiyaOwAsset` (`riya-game-platformer-open-world`); each already carries `fxKind`.


- **G-CORE-030** — `AssetPackManifest` (added 2026-10-21 to `src/types/asset.ts`, with `AssetPackManifestSchema`) has no `.lolo` data type, so `std-asset-pack` (`@almadar/std` `connect/atoms/std-asset-pack.lolo`) declares a hand-written copy of `Asset` + `AssetPackManifest`, as does every board's `type Asset`. Also the board `.lolo` `Asset.style` is a bare string while core's `style` is the closed `VisualStyle` enum, so the battle board's pre-pack data carried `style: "adventure"` (a UI-pack theme tag, not an art style) on three `ui/*` entries; the data was wrong and `assets.json` now says `pixel` (the board's 16-bit pixel style), the `adventure` tag is dropped. `@almadar/core` [architectural] — rung: `.lolo` types. Acceptance: core generates the `.lolo` types for `Asset`, `AssetPackManifest` and `SpriteSheetAtlas` (with G-CORE-029) from the zod, the atom and boards `uses` them, and the `.lolo` type uses the `VisualStyle` enum so a bad style fails at the type. Root cause: H3.

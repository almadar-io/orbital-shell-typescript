# TS shell logger — open gaps

This ledger belongs to the retained `@almadar/logger` pack in `runtime/logger`; its standalone repository is archived. Existing gap codes remain stable.

Next code: `G-LOGGER-002`

- **G-LOGGER-001** — In a browser bundle `env.ts` sees no `process`, so `NODE_ENV` is unknown and the logger starts at DEBUG with every namespace allowed: every `debug`/`info` call formats its data and writes to the console unless the host sets a level (the builder's production client did not until 2026-10-04 — about 1 s of main thread on a 59-orbital world canvas). Decide the browser default (WARN unless a host opts in) — it changes every consumer's dev logging, so it is an owner call. `@almadar/logger` [architectural] — found 2026-10-04 (studio load perf CPU profile); prevention rung: unit test of the default level with no env

# @almadar/core

> Core schema types and definitions for Almadar

Part of the [Almadar](https://github.com/almadar-io/almadar) platform.

## Installation

```bash
npm install @almadar/core
```

## Usage

```typescript
import { /* ... */ } from '@almadar/core';
```

## API

<!-- Document public exports here -->

## Event-wire fixtures (`@almadar/core/fixtures`)

`fixtures/events-wire/<case>/{request,response}.json` (+ `stream.json` for
`sse-stream`, `live-push.json` for `live-push`) is the ONE recorded fixture
set for the event-dispatch wire (Program A, §156) — canonical =
`OrbitalEventRequest`/`OrbitalEventResponse`/`LiveBroadcastItem` from
`src/types/bus.ts`. Generated and zod-validated by
`scripts/generate-event-wire-fixtures.ts` (`pnpm run build:fixtures`, wired
into `build`); loaded at runtime via `loadEventWireFixture(caseName)` /
`EVENT_WIRE_FIXTURE_CASES` from the `@almadar/core/fixtures` subpath
(Node-only — reads from disk — never the main entry).

Consumers, all reading these SAME files instead of hand-rolled wire
examples:

- vitest in `@almadar/runtime`, `@almadar/ui`, `almadar-playground-runtime`
- `cargo test` in `orbital-core` (serde round trip), `orbital-server`
  (posts fixture requests), `orbital-client`, and the Android/iOS native
  shell decoders
- the Hono/Express codegen contract test (`orbital-shell-typescript`)
- `orb verify --server`

Separate from `packages/almadar-parity` (behaviour traces across execution
paths, not wire bytes).

## License

BSL 1.1 (Business Source License). Converts to Apache 2.0 on 2030-02-01. Non-production use is free.

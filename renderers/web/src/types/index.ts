/**
 * Types barrel — pure-type (and type-adjacent runtime guard) modules meant
 * to be imported from outside `@almadar/ui` without pulling in a component
 * or hook tree. Add new type-only surfaces here as they're introduced;
 * existing type files under `types/` predate this barrel and are still
 * reached individually via `hooks/index.ts` / `providers/index.ts`.
 *
 * @packageDocumentation
 */

export * from "./slot-host";

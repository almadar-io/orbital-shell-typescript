/**
 * Duration-string parsing — the one canonical parser for a tick interval
 * written as `'5ms'`/`'5s'`/`'1m'`/`'1h'` (as opposed to a cron expression;
 * see `./cron.js`). Shared by `OrbitalServerRuntime` and any client consumer
 * (`@almadar/ui`'s `useTraitStateMachine`) so both agree on the same
 * milliseconds for the same string.
 *
 * @packageDocumentation
 */
/**
 * Parse a duration string to milliseconds. Supports `'5ms'`/`'5s'`/`'1m'`/`'1h'`,
 * and a bare number-as-string (assumed ms). Throws on anything else — a
 * caller should check `isValidCronExpression` first if the string might be
 * cron-shaped instead.
 */
declare function parseDurationString(interval: string): number;
/** Returns true if `interval` matches the duration-string shape `parseDurationString` accepts. */
declare function isValidDurationString(interval: string): boolean;

export { isValidDurationString, parseDurationString };

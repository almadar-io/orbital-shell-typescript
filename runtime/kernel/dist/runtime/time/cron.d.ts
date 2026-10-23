/**
 * Cron expression parsing and matching — the ONE canonical implementation
 * every engine that schedules a cron-shaped interval delegates to (`OrbitalServerRuntime`,
 * `TickScheduler`, and generated client codegen). No Node.js dependencies, so
 * it's safe to import client-side too.
 *
 * @packageDocumentation
 */
interface CronFields {
    minute: Set<number>;
    hour: Set<number>;
    day: Set<number>;
    month: Set<number>;
    weekday: Set<number>;
}
declare function parseCronField(field: string, min: number, max: number): Set<number>;
declare function parseCron(expression: string): CronFields;
/** Returns true if `expression` is a syntactically valid 5-field cron expression. */
declare function isValidCronExpression(expression: string): boolean;
declare function cronMatches(fields: CronFields, date: Date): boolean;
/** Calendar-minute key for once-per-minute dedup — the same shape `os/watch-cron` uses. */
declare function cronMinuteKey(date: Date): number;

export { type CronFields, cronMatches, cronMinuteKey, isValidCronExpression, parseCron, parseCronField };

/**
 * Lightweight seeded pseudo-random generator for mock data.
 *
 * Replaces @faker-js/faker in browser-facing code so the client bundle does
 * not pay the ~3.7 MB faker cost. The API surface is intentionally narrow:
 * only the helpers actually used by MockPersistenceAdapter.
 */

let seedState = 42;

/** Re-seed the generator. Same signature as `faker.seed()`. */
export function seedRandom(value: number | undefined): void {
  seedState = (value ?? 42) >>> 0;
}

/** Linear congruential generator returning a float in [0, 1). */
function nextFloat(): number {
  seedState = (seedState * 1664525 + 1013904223) >>> 0;
  return seedState / 4294967296;
}

/** Integer in [min, max]. */
export function randomInt({ min, max }: { min: number; max: number }): number {
  return Math.floor(nextFloat() * (max - min + 1)) + min;
}

/** Float in [min, max] with fixed fraction digits. */
export function randomFloat({
  min,
  max,
  fractionDigits = 2,
}: {
  min: number;
  max: number;
  fractionDigits?: number;
}): number {
  const value = nextFloat() * (max - min) + min;
  const factor = 10 ** fractionDigits;
  return Math.round(value * factor) / factor;
}

/** True/false with 50% probability. */
export function randomBoolean(): boolean {
  return nextFloat() < 0.5;
}

/** Pick one element from an array. */
export function randomArrayElement<T>(array: ReadonlyArray<T>): T {
  return array[randomInt({ min: 0, max: array.length - 1 })]!;
}

/** Return a shallow-shuffled copy of the array (Fisher-Yates). */
export function shuffleArray<T>(array: ReadonlyArray<T>): T[] {
  const copy = array.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = randomInt({ min: 0, max: i });
    const tmp = copy[i];
    copy[i] = copy[j]!;
    copy[j] = tmp!;
  }
  return copy;
}

/** ISO-8601 date string roughly `years` in the past. */
export function randomPastDate({ years = 1 }: { years?: number } = {}): Date {
  const now = Date.now();
  const maxAge = years * 365 * 24 * 60 * 60 * 1000;
  const age = Math.floor(nextFloat() * maxAge);
  return new Date(now - age);
}

/** ISO-8601 date string within the last `days`. */
export function randomRecentDate({ days = 30 }: { days?: number } = {}): Date {
  const now = Date.now();
  const maxAge = days * 24 * 60 * 60 * 1000;
  const age = Math.floor(nextFloat() * maxAge);
  return new Date(now - age);
}

/** ISO-8601 date string straddling now: `[-days, +days]`. One PRNG draw,
 *  same call shape as `randomRecentDate`, so seeded field order is unchanged —
 *  only the window shifts from past-only to centered-on-now. Past-only starved
 *  any calendar/upcoming view, since every seeded `startsAt` was already over. */
export function randomStraddlingDate({ days = 15 }: { days?: number } = {}): Date {
  const now = Date.now();
  const span = days * 24 * 60 * 60 * 1000;
  const offset = Math.floor(nextFloat() * span * 2) - span;
  return new Date(now + offset);
}

/** Any date in the last ~100 years. */
export function randomAnytimeDate(): Date {
  const now = Date.now();
  const maxAge = 100 * 365 * 24 * 60 * 60 * 1000;
  const age = Math.floor(nextFloat() * maxAge);
  return new Date(now - age);
}

// Neutral English words, not lorem: seeded titles/labels read like plausible
// product data ("harbor summit", "quarterly ledger") instead of latin filler
// that made every mock-seeded screen look broken (2026-08-22 detail survey:
// "aute ut" titles were the single most-reported raw-value defect). Same
// seeded-LCG determinism — only the corpus changed.
const LOREM_WORDS = [
  'harbor', 'summit', 'meridian', 'atlas', 'beacon', 'cedar', 'delta', 'ember',
  'falcon', 'garnet', 'horizon', 'indigo', 'juniper', 'keystone', 'lantern',
  'meadow', 'nimbus', 'orchard', 'pioneer', 'quarry', 'redwood', 'sierra',
  'timber', 'umber', 'vista', 'willow', 'zenith', 'anchor', 'basalt', 'canyon',
  'drift', 'estuary', 'fjord', 'grove', 'heath', 'inlet', 'jade', 'knoll',
  'lagoon', 'mesa', 'north', 'onyx', 'prairie', 'quartz', 'ridge', 'slate',
  'terrace', 'upland', 'valley', 'wharf', 'yonder', 'aspen', 'brook', 'cove',
  'dune', 'elm', 'fern', 'glen', 'haven', 'isle',
];

/** A few random words. */
export function randomWords(count: number): string {
  const words: string[] = [];
  for (let i = 0; i < count; i++) {
    words.push(randomArrayElement(LOREM_WORDS));
  }
  return words.join(' ');
}

/** A short sentence. */
export function randomSentence(): string {
  const words = randomWords(randomInt({ min: 4, max: 8 }));
  return words.charAt(0).toUpperCase() + words.slice(1) + '.';
}

/** UUID v4-like string (random, not strictly compliant). */
export function randomUuid(): string {
  const hex = () => randomInt({ min: 0, max: 15 }).toString(16);
  return `${hex()}${hex()}${hex()}${hex()}${hex()}${hex()}${hex()}${hex()}-${hex()}${hex()}${hex()}${hex()}-4${hex()}${hex()}${hex()}-${hex()}${hex()}${hex()}${hex()}-${hex()}${hex()}${hex()}${hex()}${hex()}${hex()}${hex()}${hex()}${hex()}${hex()}${hex()}${hex()}`;
}

/** Random hex color (#rrggbb). */
export function randomColor(): string {
  const channel = () => randomInt({ min: 0, max: 255 }).toString(16).padStart(2, '0');
  return `#${channel()}${channel()}${channel()}`;
}

const PASSWORD_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';

/** Random password of the given length. */
export function randomPassword(length = 12): string {
  let password = '';
  for (let i = 0; i < length; i++) {
    password += randomArrayElement(PASSWORD_CHARS.split(''));
  }
  return password;
}

/** Random email address. */
export function randomEmail(): string {
  const user = randomWords(1).toLowerCase().replace(/\s+/g, '.');
  const domain = randomWords(1).toLowerCase().replace(/\s+/g, '');
  return `${user}@${domain}.com`;
}

/** Random URL. */
export function randomUrl(): string {
  const slug = randomWords(2).toLowerCase().replace(/\s+/g, '-');
  return `https://example.com/${slug}`;
}

/** Random phone number. */
export function randomPhone(): string {
  const area = randomInt({ min: 200, max: 999 });
  const prefix = randomInt({ min: 200, max: 999 });
  const line = randomInt({ min: 0, max: 9999 }).toString().padStart(4, '0');
  return `+1 (${area}) ${prefix}-${line}`;
}

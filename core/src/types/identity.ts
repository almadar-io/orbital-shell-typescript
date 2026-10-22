/**
 * Identity model (Almadar Rabit V4, Phase 1 — types only).
 *
 * Branded, prefix-tagged node ids + a workspace-scoped name ledger. Ids are
 * the durable edge keys of the identity-keyed schema graph; the ledger is the
 * sole name↔id map (names are display labels, one row per rename). This module
 * is pure: no I/O, no side effects. Minting is the only impurity (clock +
 * crypto randomness for the ULID suffix).
 *
 * @packageDocumentation
 */

import { z } from 'zod';

// ============================================================================
// Branded id types
// ============================================================================

type Branded<K extends string> = string & { readonly __idBrand: K };

export type OrbitalId = Branded<'OrbitalId'>;
export type EntityId = Branded<'EntityId'>;
export type TraitId = Branded<'TraitId'>;
export type EventId = Branded<'EventId'>;
export type PageId = Branded<'PageId'>;
export type ServiceId = Branded<'ServiceId'>;
export type ThemeId = Branded<'ThemeId'>;
export type PaletteEntryId = Branded<'PaletteEntryId'>;

/** Node kind ↔ id-prefix table. The single source of truth for every prefix. */
const ID_PREFIXES = {
  orbital: 'orb_',
  entity: 'ent_',
  trait: 'trt_',
  event: 'evt_',
  page: 'pag_',
  service: 'svc_',
  theme: 'thm_',
  palette: 'pal_',
} as const;

export type IdKind = keyof typeof ID_PREFIXES;

/** Compile-time map from kind to its branded id type. */
export interface IdForKind {
  orbital: OrbitalId;
  entity: EntityId;
  trait: TraitId;
  event: EventId;
  page: PageId;
  service: ServiceId;
  theme: ThemeId;
  palette: PaletteEntryId;
}

/**
 * The one controlled brand assertion in this module. A prefix-checked string
 * is asserted into its branded form here and nowhere else.
 */
function brand<Id extends string>(value: string): Id {
  return value as Id;
}

// ============================================================================
// Kind guards + constructors (one shared factory, eight kinds)
// ============================================================================

interface IdKindApi<Id extends string> {
  readonly prefix: string;
  is(value: string): value is Id;
  as(value: string): Id;
}

function makeIdKind<Id extends string>(kind: IdKind): IdKindApi<Id> {
  const prefix = ID_PREFIXES[kind];
  const is = (value: string): value is Id =>
    value.startsWith(prefix) && value.length > prefix.length;
  const as = (value: string): Id => {
    if (!is(value)) {
      throw new Error(
        `Expected ${kind} id (prefix "${prefix}"), got: ${JSON.stringify(value)}`,
      );
    }
    return brand<Id>(value);
  };
  return { prefix, is, as };
}

const orbitalKind = makeIdKind<OrbitalId>('orbital');
const entityKind = makeIdKind<EntityId>('entity');
const traitKind = makeIdKind<TraitId>('trait');
const eventKind = makeIdKind<EventId>('event');
const pageKind = makeIdKind<PageId>('page');
const serviceKind = makeIdKind<ServiceId>('service');
const themeKind = makeIdKind<ThemeId>('theme');
const paletteKind = makeIdKind<PaletteEntryId>('palette');

export const isOrbitalId = orbitalKind.is;
export const asOrbitalId = orbitalKind.as;
export const isEntityId = entityKind.is;
export const asEntityId = entityKind.as;
export const isTraitId = traitKind.is;
export const asTraitId = traitKind.as;
export const isEventId = eventKind.is;
export const asEventId = eventKind.as;
export const isPageId = pageKind.is;
export const asPageId = pageKind.as;
export const isServiceId = serviceKind.is;
export const asServiceId = serviceKind.as;
export const isThemeId = themeKind.is;
export const asThemeId = themeKind.as;
export const isPaletteEntryId = paletteKind.is;
export const asPaletteEntryId = paletteKind.as;

/**
 * The id-prefix for a node kind (`'entity' → 'ent_'`). The JS mirror of the
 * Rust `IdKind::prefix`. Single source of truth is {@link ID_PREFIXES}.
 */
export function idPrefix(kind: IdKind): string {
  return ID_PREFIXES[kind];
}

/**
 * The node kind an id's prefix denotes, or `null` for an unrecognized /
 * bare-prefix string. The JS mirror of the Rust `id_kind_of`. Prefixes are
 * mutually non-overlapping, so match order is irrelevant.
 */
export function idKindOf(id: string): IdKind | null {
  for (const kind of Object.keys(ID_PREFIXES) as IdKind[]) {
    const prefix = ID_PREFIXES[kind];
    if (id.startsWith(prefix) && id.length > prefix.length) return kind;
  }
  return null;
}

// ============================================================================
// Minting — prefix + ULID
// ============================================================================

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const TIME_LEN = 10;
const RANDOM_LEN = 16;

function randomBytes(len: number): Uint8Array {
  const g = globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array } };
  if (g.crypto?.getRandomValues) {
    return g.crypto.getRandomValues(new Uint8Array(len));
  }
  throw new Error('mintId: no crypto.getRandomValues available in this runtime');
}

function encodeTime(now: number): string {
  let value = now;
  let out = '';
  for (let i = 0; i < TIME_LEN; i++) {
    const mod = value % 32;
    out = CROCKFORD[mod] + out;
    value = (value - mod) / 32;
  }
  return out;
}

function encodeRandom(): string {
  const bytes = randomBytes(RANDOM_LEN);
  let out = '';
  for (let i = 0; i < RANDOM_LEN; i++) {
    out += CROCKFORD[bytes[i] & 31];
  }
  return out;
}

/** A 26-char Crockford-base32 ULID: 48-bit ms timestamp + 80 bits of randomness. */
function ulid(): string {
  return encodeTime(Date.now()) + encodeRandom();
}

/** Mint a fresh, opaque, kind-tagged id: `<prefix><ULID>`. */
export function mintId<K extends IdKind>(kind: K): IdForKind[K] {
  return brand<IdForKind[K]>(ID_PREFIXES[kind] + ulid());
}

// ============================================================================
// Deterministic derivation — JS twin of Rust `derive_id`
// ============================================================================

const U64_MASK = (1n << 64n) - 1n;
const BODY_TIME_MASK = (1n << 50n) - 1n;
const BODY_RANDOM_MASK = (1n << 80n) - 1n;
const FNV_PRIME_64 = 0x100000001b3n;
const FNV_OFFSET_1 = 0xcbf29ce484222325n;
const FNV_OFFSET_2 = (0x100000001b3n ^ 0xdeadbeefn) & U64_MASK;

/** SplitMix64 — a small, well-distributed non-cryptographic mixer. */
function splitmix64(x: bigint): bigint {
  let z = (x + 0x9e3779b97f4a7c15n) & U64_MASK;
  z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & U64_MASK;
  z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & U64_MASK;
  return (z ^ (z >> 31n)) & U64_MASK;
}

/** FNV-1a 64-bit over `data` starting from `offset`. */
function fnv1a64(data: Uint8Array, offset: bigint): bigint {
  let h = offset & U64_MASK;
  for (const b of data) {
    h = (h ^ BigInt(b)) & U64_MASK;
    h = (h * FNV_PRIME_64) & U64_MASK;
  }
  return h;
}

/** Emit the low `nChars * 5` bits of `value` as base32, most-significant char first. */
function pushBase32(value: bigint, nChars: number): string {
  let v = value;
  const chars = new Array<string>(nChars);
  for (let i = nChars - 1; i >= 0; i--) {
    chars[i] = CROCKFORD[Number(v & 0x1fn)];
    v >>= 5n;
  }
  return chars.join('');
}

/**
 * Deterministically derive a child id rooted in `parentId` — no entropy, no
 * clock, so re-deriving from the same inputs never churns. JS twin of the
 * Rust `derive_id` in `orbital-core/src/identity.rs`; used ONLY for synthetic
 * nodes produced by deterministic materialization (orbital-import
 * prefixing), never for author-facing fresh ids (use {@link mintId} there).
 */
export function deriveId(parentId: string, discriminator: string): string {
  const kind = idKindOf(parentId) ?? 'trait';
  const encoder = new TextEncoder();
  const parentBytes = encoder.encode(parentId);
  const discBytes = encoder.encode(discriminator);
  const data = new Uint8Array(parentBytes.length + 1 + discBytes.length);
  data.set(parentBytes, 0);
  data[parentBytes.length] = 0x1f;
  data.set(discBytes, parentBytes.length + 1);

  const h1 = splitmix64(fnv1a64(data, FNV_OFFSET_1));
  const h2 = splitmix64(fnv1a64(data, FNV_OFFSET_2));
  const timeBits = (((h1 << 64n) | h2) & BODY_TIME_MASK);
  const randBits = (((h2 << 64n) | h1) & BODY_RANDOM_MASK);

  return ID_PREFIXES[kind] + pushBase32(timeBits, 10) + pushBase32(randBits, 16);
}

// ============================================================================
// Identity ledger
// ============================================================================

/** Ledger row kind. `palette` entries are manifest ids, not name-ledger rows. */
export type LedgerKind =
  | 'orbital'
  | 'entity'
  | 'trait'
  | 'event'
  | 'page'
  | 'service'
  | 'theme';

/**
 * One ledger row: the workspace's name history for a single node id.
 *
 * For kind `'event'` the row is minted per-(trait, declared event) per the
 * Phase-0 freeze — the owning trait is recorded in `parent`; a call-site event
 * rename is a one-row edit on this same id (the baked-vs-current key namespaces
 * collapse into `bakedName` vs `curName`).
 */
export interface LedgerEntry {
  id: string;
  kind: LedgerKind;
  bakedName: string;
  curName: string;
  renames: ReadonlyArray<{ from: string; to: string; at: string }>;
  owner: 'std' | 'io' | 'workspace';
  /** Owning trait for kind `'event'` (per-trait event-id namespace). */
  parent?: TraitId;
}

export interface IdentityLedger {
  schemaVersion: 1;
  entries: Record<string, LedgerEntry>;
}

/** Resolve a name to its id via exact `curName` match within `kind`, else null. */
export function ledgerResolveName(
  ledger: IdentityLedger,
  kind: LedgerKind,
  name: string,
): string | null {
  for (const [id, entry] of Object.entries(ledger.entries)) {
    if (entry.kind === kind && entry.curName === name) return id;
  }
  return null;
}

/** Immutable rename: returns a new ledger with the id's `curName` + `renames` updated; renaming to the current name is a no-op. */
export function ledgerRename(
  ledger: IdentityLedger,
  id: string,
  to: string,
  at: string,
): IdentityLedger {
  const entry = ledger.entries[id];
  if (entry === undefined || entry.curName === to) return ledger;
  const updated: LedgerEntry = {
    ...entry,
    curName: to,
    renames: [...entry.renames, { from: entry.curName, to, at }],
  };
  return { ...ledger, entries: { ...ledger.entries, [id]: updated } };
}

/** Current display name for an id, or null when the id is not in the ledger. */
export function ledgerCurName(ledger: IdentityLedger, id: string): string | null {
  return ledger.entries[id]?.curName ?? null;
}

// ============================================================================
// Zod schemas — the `.orb` load-time activation surface (Rabit V4, Phase 4)
// ============================================================================

/**
 * Prefix-checked, kind-tagged id schemas. Each narrows a validated string to
 * its branded id type via the module's own kind guard, so a schema that reads
 * `TraitIdSchema.optional()` yields `TraitId | undefined` with no cast. The
 * guard is the single source of prefix truth (`ID_PREFIXES`); the schema is a
 * thin zod wrapper over it.
 */
export const OrbitalIdSchema = z
  .string()
  .refine(isOrbitalId, { message: `Expected an orbital id (prefix "${ID_PREFIXES.orbital}")` });
export const EntityIdSchema = z
  .string()
  .refine(isEntityId, { message: `Expected an entity id (prefix "${ID_PREFIXES.entity}")` });
export const TraitIdSchema = z
  .string()
  .refine(isTraitId, { message: `Expected a trait id (prefix "${ID_PREFIXES.trait}")` });
export const EventIdSchema = z
  .string()
  .refine(isEventId, { message: `Expected an event id (prefix "${ID_PREFIXES.event}")` });
export const PageIdSchema = z
  .string()
  .refine(isPageId, { message: `Expected a page id (prefix "${ID_PREFIXES.page}")` });
export const ServiceIdSchema = z
  .string()
  .refine(isServiceId, { message: `Expected a service id (prefix "${ID_PREFIXES.service}")` });
export const ThemeIdSchema = z
  .string()
  .refine(isThemeId, { message: `Expected a theme id (prefix "${ID_PREFIXES.theme}")` });
export const PaletteEntryIdSchema = z
  .string()
  .refine(isPaletteEntryId, { message: `Expected a palette-entry id (prefix "${ID_PREFIXES.palette}")` });

export const LedgerKindSchema = z.enum([
  'orbital',
  'entity',
  'trait',
  'event',
  'page',
  'service',
  'theme',
]);

export const LedgerEntrySchema = z.object({
  id: z.string(),
  kind: LedgerKindSchema,
  bakedName: z.string(),
  curName: z.string(),
  renames: z.array(
    z.object({ from: z.string(), to: z.string(), at: z.string() }),
  ),
  owner: z.enum(['std', 'io', 'workspace']),
  parent: TraitIdSchema.optional(),
});

export const IdentityLedgerSchema = z.object({
  schemaVersion: z.literal(1),
  entries: z.record(LedgerEntrySchema),
});

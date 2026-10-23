/**
 * Authenticated user context — what `@user.x` resolves against.
 *
 * The canonical shape for the `user` binding root, shared by both execution
 * paths: the JS interpreter resolves `@user.id` through
 * `EvaluationContext.user`, and the compiled shell emits `user?.id` against the
 * `UserContext` its `@app/shared` re-exports from here.
 *
 * `id` is the field the behavior library reads for ownership scoping and `role`
 * the field it reads for capability gating. Auth providers that name the subject
 * `uid` must normalize at their boundary — {@link normalizeUserContext} does that.
 *
 * @packageDocumentation
 */

import { z } from 'zod';
import { FieldValueSchema, type FieldValue } from './entity.js';
import { JsonValueSchema } from './json.js';
import type { Claim, Viewer } from '../generated/kernel-wire.js';

export type { Claim, Viewer };

/**
 * What a host's auth provider has resolved the viewer to be — from session
 * resolution only, never from an interactive sign-in action: `pending` until
 * the session is known; `anonymous` / `authenticated` once it is; `failed`
 * when connecting or resolving the session failed; `unavailable` when the host
 * has no sign-in configured. An `access: authenticated` page mounts only on
 * `authenticated`.
 */
export type ViewerAuthority = 'pending' | 'anonymous' | 'authenticated' | 'failed' | 'unavailable';

/**
 * The `@user` binding: a {@link Viewer} held flat. Its named fields are the viewer's; each claim is a key holding its
 * JSON value, readable as `@user.<claim>`. The Rust twin of the conversion is `orbital_core_base::viewer`
 * (`Viewer::from_user` / `Viewer::to_user`).
 */
export interface UserContext extends Omit<Viewer, 'claims'> {
  [key: string]: FieldValue | undefined;
}

const ClaimSchema: z.ZodType<Claim> = z.object({ name: z.string(), value: JsonValueSchema });

/** Zod twin of the generated {@link Viewer}: the record a `.lolo` program names as `Viewer`. */
export const ViewerSchema: z.ZodType<Viewer> = z.object({
  id: z.string(),
  email: z.string().optional(),
  name: z.string().optional(),
  role: z.string().optional(),
  permissions: z.array(z.string()).optional(),
  claims: z.array(ClaimSchema),
});

/**
 * The identity of an unauthenticated viewer. A resolvable object rather than
 * `undefined` so a role predicate evaluates to a definite `false` instead of
 * comparing against nothing.
 */
export const ANONYMOUS_USER: UserContext = {
  id: 'anonymous',
  role: 'anonymous',
  permissions: [],
};

/** Provider-shaped identity claims, before normalization. */
export interface RawUserClaims {
  id?: string;
  uid?: string;
  email?: string | null;
  name?: string;
  displayName?: string | null;
  /** Absent or `null` when the token carries none, as the kernel's `Viewer.role` (`Option`). */
  role?: string | null;
  permissions?: string[] | null;
  [key: string]: FieldValue | undefined;
}

/** Zod twin of `RawUserClaims` — the wire shape of `OrbitalEventRequest.user`. */
export const RawUserClaimsSchema: z.ZodType<RawUserClaims> = z
  .object({
    id: z.string().optional(),
    uid: z.string().optional(),
    email: z.string().nullable().optional(),
    name: z.string().optional(),
    displayName: z.string().nullable().optional(),
    role: z.string().nullable().optional(),
    permissions: z.array(z.string()).nullable().optional(),
  })
  .catchall(FieldValueSchema.optional());

/** Claim keys a `null` leaves absent, as the kernel's `Viewer` reads them (`Option`). */
const NONE_WHEN_NULL_CLAIM_KEYS: readonly string[] = ['role', 'permissions'];

/** Claim keys {@link normalizeUserContext} derives rather than copies verbatim. */
const DERIVED_CLAIM_KEYS: readonly string[] = ['id', 'name', 'displayName', 'email'];

/**
 * Normalize provider claims into a {@link UserContext}.
 *
 * Firebase (and most OIDC providers) name the subject `uid` and the display name
 * `displayName`, while every `.lolo` behavior reads `@user.id` / `@user.name`.
 * Without this normalization `@user.id` is `undefined` against a fully
 * authenticated request and every ownership filter silently matches no rows.
 * `uid` is preserved so `@user.uid` keeps working.
 *
 * Returns `undefined` for absent or subject-less claims so callers can
 * distinguish "no auth ran" from "anonymous"; use {@link ANONYMOUS_USER} where a
 * definite identity is required.
 */
export function normalizeUserContext(
  claims: RawUserClaims | null | undefined,
): UserContext | undefined {
  if (!claims) return undefined;
  const id = claims.id ?? claims.uid;
  if (typeof id !== 'string' || id.length === 0) return undefined;

  const user: UserContext = { id };
  for (const [key, value] of Object.entries(claims)) {
    if (value === undefined || DERIVED_CLAIM_KEYS.includes(key)) continue;
    if (value === null && NONE_WHEN_NULL_CLAIM_KEYS.includes(key)) continue;
    user[key] = value;
  }

  const name = claims.name ?? claims.displayName;
  if (typeof name === 'string' && name.length > 0) user.name = name;
  if (typeof claims.email === 'string' && claims.email.length > 0) user.email = claims.email;

  return user;
}

/**
 * Turn a row of an app's `[identity]` entity into a viewer.
 *
 * There is no separate persona shape: an identity row IS the persona
 * (`Almadar_LOLO_Identity.md` §4.3), so this only guards the one field the
 * behavior library requires — a non-empty string `id` — and passes every other
 * declared field through as a `@user.<field>` claim. Rows without a usable id
 * yield `undefined` rather than a persona nobody can own rows as.
 */
export function personaFromIdentityRow(
  row: Record<string, FieldValue | undefined>,
): UserContext | undefined {
  const id = row['id'];
  if (typeof id !== 'string' || id.length === 0) return undefined;
  const persona: UserContext = { id };
  for (const [key, value] of Object.entries(row)) {
    if (key === 'id' || value === undefined) continue;
    persona[key] = value;
  }
  return persona;
}

/** Look a persona up in a roster by id, or by role when no id matches. */
export function findPersonaInRoster(
  roster: readonly UserContext[],
  idOrRole: string,
): UserContext | undefined {
  return (
    roster.find((p) => p.id === idOrRole) ??
    roster.find((p) => p.role === idOrRole)
  );
}

/**
 * Resolve a persona spec — a bare id/role (`Person Id 3`, `moderator`) or a full
 * JSON `UserContext` — into a viewer. This is the `ALMADAR_PERSONA` contract,
 * shared by every host that presents an app as somebody.
 *
 * The roster is the app's OWN declared personas — the seeded rows of its
 * `[identity]` entity (`Almadar_LOLO_Identity.md` §4.3) — supplied by the host
 * that has them in hand (the runtime's live store on the interpreter path, the
 * schema-derived seed rows on the compiled path). There is no global roster:
 * an app without an `[identity]` entity resolves only JSON-form specs.
 *
 * Throws on anything unresolvable rather than returning `undefined`: "no persona"
 * and "persona silently ignored" look identical on screen, so a bad spec must
 * fail at boot instead of rendering as nobody.
 */
export function resolvePersonaSpec(spec: string, roster: readonly UserContext[]): UserContext {
  const raw = spec.trim();
  if (!raw.startsWith('{')) {
    const declared = findPersonaInRoster(roster, raw);
    if (!declared) {
      const known = roster.map((p) => `${p.id}/${p.role ?? '-'}`).join(', ');
      throw new Error(
        `Persona "${raw}" is not a declared persona id or role. ` +
          (roster.length > 0
            ? `Known: ${known}`
            : 'This app declares no [identity] entity, so only the JSON persona form is accepted.'),
      );
    }
    return declared;
  }
  let claims: RawUserClaims;
  try {
    claims = JSON.parse(raw);
  } catch {
    throw new Error(`Persona is not valid JSON: ${raw}`);
  }
  const user = normalizeUserContext(claims);
  if (!user) {
    throw new Error(`Persona needs an "id" (or "uid"): ${raw}`);
  }
  return user;
}

/**
 * What a server hands the program-independent web client at startup (`/client.json`), beside `program.client.orb`:
 * the program's locale and text direction and its themes with the default theme and mode. The TypeScript shell writes it
 * for `orb compile` and `orb serve` alike, beside the kernel's language data (`/language.json`).
 */
import { z } from 'zod';
import type { JsonValue } from './json.js';

export const ClientThemeSchema = z
  .object({
    name: z.string().min(1),
    displayName: z.string(),
    hasLightMode: z.boolean(),
    hasDarkMode: z.boolean(),
  })
  .strict();

export const ClientManifestSchema = z
  .object({
    locale: z.string().min(1),
    direction: z.enum(['ltr', 'rtl']),
    themes: z.array(ClientThemeSchema),
    defaultTheme: z.string().min(1).nullable(),
    defaultMode: z.enum(['light', 'dark']),
  })
  .strict();

export type ClientTheme = z.infer<typeof ClientThemeSchema>;
export type ClientManifest = z.infer<typeof ClientManifestSchema>;

/** The manifest, or a throw naming what is wrong with it. */
export function parseClientManifest(value: JsonValue): ClientManifest {
  return ClientManifestSchema.parse(value);
}

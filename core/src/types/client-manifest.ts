/**
 * What a server hands the program-independent web client at startup (`/client.json`): the program's locale and text
 * direction, its themes with the default theme and mode, and where the client program and the kernel's language data
 * are (`program`, `language`: paths under the client root, named by their content so a host caches them as immutable).
 * The TypeScript shell writes it for `orb compile` and `orb serve` alike.
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
    program: z.string().min(1),
    language: z.string().min(1),
  })
  .strict();

export type ClientTheme = z.infer<typeof ClientThemeSchema>;
export type ClientManifest = z.infer<typeof ClientManifestSchema>;

/** The manifest, or a throw naming what is wrong with it. */
export function parseClientManifest(value: JsonValue): ClientManifest {
  return ClientManifestSchema.parse(value);
}

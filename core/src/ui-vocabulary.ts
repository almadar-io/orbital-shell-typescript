/**
 * The UI vocabulary the lints check against: the valid slots, the base item-action props, the Lucide icon names, the
 * built-in theme keys, the delivery-only binding roots and the `@event.source` keys. `tsup` writes it to
 * `dist/language/ui-vocabulary.json` (`orbLanguage.uiVocabulary`); `orb` and the `.lolo` lints read the same file.
 *
 * @packageDocumentation
 */
import { z } from 'zod';
import { UI_SLOTS } from './types/effect';

export const UiVocabularySchema = z.strictObject({
  slots: z.array(z.string().min(1)),
  itemActionBaseProps: z.array(z.string().min(1)),
  lucideIcons: z.array(z.string().min(1)),
  themeKeys: z.array(z.string().min(1)),
  deliveryRoots: z.array(z.string().min(1)),
  eventSourceKeys: z.array(z.string().min(1)),
});

export type UiVocabulary = z.infer<typeof UiVocabularySchema>;

export interface ThemePresetKeys {
  name: string;
  tokens: Record<string, unknown>;
  variants?: { dark?: unknown };
}

export const ITEM_ACTION_BASE_PROPS: readonly string[] = [
  'label',
  'event',
  'icon',
  'variant',
  'disabled',
  'hidden',
  'confirm',
  'payload',
  'navigatesTo',
];

export const DELIVERY_ROOTS: readonly string[] = ['event', 'prevEvents', 'prevStates', 'fromState', 'toState'];

export const EVENT_SOURCE_KEYS: readonly string[] = [
  'orbital',
  'orbitalId',
  'trait',
  'traitId',
  'eventId',
  'transition',
  'tick',
  'fromBridge',
  'dispatched',
  'originClientId',
  'instanceKey',
];

/** `<name>-light` when the preset carries tokens, `<name>-dark` when it has a dark variant. */
export function themeKeys(presets: readonly ThemePresetKeys[]): string[] {
  const keys: string[] = [];
  for (const preset of presets) {
    if (Object.keys(preset.tokens).length > 0) keys.push(`${preset.name}-light`);
    if (preset.variants?.dark !== undefined) keys.push(`${preset.name}-dark`);
  }
  return keys.sort();
}

export function buildUiVocabulary(presets: readonly ThemePresetKeys[], lucideIconsText: string): UiVocabulary {
  return UiVocabularySchema.parse({
    slots: [...UI_SLOTS],
    itemActionBaseProps: [...ITEM_ACTION_BASE_PROPS],
    lucideIcons: lucideIconsText.split('\n').map((l) => l.trim()).filter((l) => l !== ''),
    themeKeys: themeKeys(presets),
    deliveryRoots: [...DELIVERY_ROOTS],
    eventSourceKeys: [...EVENT_SOURCE_KEYS],
  });
}

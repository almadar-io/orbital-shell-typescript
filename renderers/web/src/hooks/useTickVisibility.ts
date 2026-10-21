import { useCallback, useEffect } from 'react';
import { getTraitPresence } from '../core';

/**
 * Whether a `[visible]` tick may fire now: its trait group is not off screen (LOLO §11).
 * Watches the group while mounted so `TraitScopeProvider` tracks the group's output.
 */
export function useTickVisibility(traits: readonly string[]): () => boolean {
  const key = traits.join('\u0000');
  useEffect(() => getTraitPresence().watch(key.split('\u0000')), [key]);
  return useCallback(() => getTraitPresence().state(key.split('\u0000')) !== 'off-screen', [key]);
}

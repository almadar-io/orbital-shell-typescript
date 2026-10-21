import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { Avl3DContext, useAvl3DConfig, useAvl3DPalette } from '../avl-3d-context';
import { AVL_3D_COLORS } from '../../lib/avl-3d-layout';

/** A fully-populated resolved palette, matching AVL_3D_COLORS' exact key set. */
function makeTestPalette(): Record<keyof typeof AVL_3D_COLORS, string> {
  const keys = Object.keys(AVL_3D_COLORS) as Array<keyof typeof AVL_3D_COLORS>;
  return keys.reduce((acc, key) => {
    acc[key] = `resolved(${key})`;
    return acc;
  }, {} as Record<keyof typeof AVL_3D_COLORS, string>);
}

describe('useAvl3DPalette', () => {
  it('is null with no provider — three.js consumers must not render until a real palette arrives', () => {
    const { result } = renderHook(() => useAvl3DPalette());
    expect(result.current).toBeNull();
  });

  it('returns the resolved palette a provider supplies', () => {
    const palette = makeTestPalette();
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <Avl3DContext.Provider value={{ modelOverrides: {}, effectsEnabled: true, palette }}>
        {children}
      </Avl3DContext.Provider>
    );
    const { result } = renderHook(() => useAvl3DPalette(), { wrapper });
    expect(result.current).toEqual(palette);
    expect(result.current?.entityCore).toBe('resolved(entityCore)');
  });

  it('leaves the rest of useAvl3DConfig (modelOverrides/effectsEnabled) untouched by the palette addition', () => {
    const { result } = renderHook(() => useAvl3DConfig());
    expect(result.current).toEqual({ modelOverrides: {}, effectsEnabled: true, palette: null });
  });
});

/**
 * Collapsing or expanding a region must not remount `main`: a remount restarts whatever runs there
 * (a guest program re-runs INIT for every trait). The region containers keep one element structure.
 */
import React, { useEffect } from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DockLayout } from '../DockLayout';

function Counted({ mounts }: { mounts: { n: number } }): React.ReactElement {
  useEffect(() => {
    mounts.n += 1;
  }, [mounts]);
  return <div data-testid="main">main</div>;
}

type Region = 'sidebar' | 'secondary' | 'bottom';

function layout(region: Region, collapsed: boolean, mounts: { n: number }): React.ReactElement {
  const main = <Counted mounts={mounts} />;
  if (region === 'sidebar') return <DockLayout main={main} sidebar={<div data-testid="panel">tree</div>} sidebarCollapsed={collapsed} />;
  if (region === 'secondary') return <DockLayout main={main} secondarySidebar={<div data-testid="panel">machine</div>} secondarySidebarCollapsed={collapsed} />;
  return <DockLayout main={main} bottomPanel={<div data-testid="panel">console</div>} bottomPanelCollapsed={collapsed} />;
}

describe('DockLayout keeps main mounted across collapse and expand', () => {
  for (const region of ['sidebar', 'secondary', 'bottom'] as const) {
    it(`${region}: collapsing then expanding mounts main once`, () => {
      const mounts = { n: 0 };
      const { rerender } = render(layout(region, false, mounts));
      rerender(layout(region, true, mounts));
      rerender(layout(region, false, mounts));
      rerender(layout(region, true, mounts));
      expect(screen.getByTestId('main')).toBeInTheDocument();
      expect(mounts.n).toBe(1);
    });

    it(`control: ${region} collapsed shows no panel content and expanded shows it`, () => {
      const mounts = { n: 0 };
      const { rerender } = render(layout(region, true, mounts));
      expect(screen.queryByTestId('panel')).not.toBeInTheDocument();
      rerender(layout(region, false, mounts));
      expect(screen.getByTestId('panel')).toBeInTheDocument();
    });
  }
});

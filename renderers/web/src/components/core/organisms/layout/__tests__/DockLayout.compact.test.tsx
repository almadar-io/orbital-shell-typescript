/**
 * DockLayout's compact variant — the studio on a phone or tablet: `main` fills
 * the screen; the rail's items live behind a hamburger (a left drawer that
 * opens on the menu, then the picked item's panel); the right panel and the
 * bottom panel open as drawers from the top bar. Every shell gets it by
 * laying out through DockLayout.
 */
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { DockLayout, useDockLayout, useCompactLayout } from '../DockLayout';
import { renderHook } from '@testing-library/react';

function Rail(): React.ReactElement {
  const { compact, showPanel, closeMenu } = useDockLayout();
  return (
    <div data-testid="rail" data-compact={String(compact)}>
      <button type="button" data-testid="rail-item-files" onClick={() => showPanel()}>Files</button>
      <button type="button" data-testid="rail-item-dialog" onClick={() => closeMenu()}>Dialog</button>
    </div>
  );
}

const regions = {
  main: <div data-testid="main" />,
  rail: <Rail />,
  sidebar: <div data-testid="sidebar" />,
  secondarySidebar: <div data-testid="secondary" />,
  bottomPanel: <div data-testid="bottom" />,
};

afterEach(() => { vi.unstubAllGlobals(); });

describe('DockLayout compact', () => {
  it('main fills the screen; no rail column, side panels or collapse gutters', () => {
    render(<DockLayout {...regions} compact />);
    expect(screen.getByTestId('main')).toBeInTheDocument();
    for (const id of ['rail', 'sidebar', 'secondary', 'bottom']) expect(screen.queryByTestId(id)).not.toBeInTheDocument();
    expect(screen.queryByTestId('dock-collapse-sidebar')).not.toBeInTheDocument();
    expect(screen.queryByTestId('dock-collapse-secondary-sidebar')).not.toBeInTheDocument();
  });

  it('the hamburger opens the menu (the rail, in compact form); picking an item shows its panel; back returns to the menu', () => {
    render(<DockLayout {...regions} compact />);
    fireEvent.click(screen.getByTestId('dock-menu'));
    expect(screen.getByTestId('rail').getAttribute('data-compact')).toBe('true');
    expect(screen.queryByTestId('sidebar')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('rail-item-files'));
    expect(screen.getByTestId('sidebar')).toBeInTheDocument();
    expect(screen.queryByTestId('rail')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('dock-drawer-back'));
    expect(screen.getByTestId('rail')).toBeInTheDocument();
  });

  it('an item that opens no panel closes the menu', () => {
    render(<DockLayout {...regions} compact />);
    fireEvent.click(screen.getByTestId('dock-menu'));
    fireEvent.click(screen.getByTestId('rail-item-dialog'));
    expect(screen.queryByTestId('rail-item-files')).not.toBeInTheDocument();
  });

  it("with no rail, the hamburger opens the side panel itself (the builder's chat)", () => {
    render(<DockLayout main={<div />} sidebar={<div data-testid="chat" />} compact />);
    fireEvent.click(screen.getByTestId('dock-menu'));
    expect(screen.getByTestId('chat')).toBeInTheDocument();
    expect(screen.queryByTestId('dock-drawer-back')).not.toBeInTheDocument();
  });

  it('the right panel opens as a drawer from its top-bar button, named by the host', () => {
    render(<DockLayout {...regions} compact secondarySidebarLabel="Inspector" secondarySidebarIcon="sliders-horizontal" />);
    const open = screen.getByTestId('dock-open-secondary-sidebar');
    expect(open.getAttribute('aria-label')).toBe('Inspector');
    fireEvent.click(open);
    expect(screen.getByTestId('secondary')).toBeInTheDocument();
  });

  it('a control inside main can open the right panel drawer (the canvas agent button)', () => {
    function OpenChat(): React.ReactElement {
      const { showSecondary } = useDockLayout();
      return <button type="button" data-testid="open-chat" onClick={() => showSecondary()}>Chat</button>;
    }
    render(<DockLayout {...regions} main={<OpenChat />} compact />);
    expect(screen.queryByTestId('secondary')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('open-chat'));
    expect(screen.getByTestId('secondary')).toBeInTheDocument();
  });

  it('control: on desktop showSecondary is a no-op (the host owns the right panel)', () => {
    function OpenChat(): React.ReactElement {
      const { showSecondary } = useDockLayout();
      return <button type="button" data-testid="open-chat" onClick={() => showSecondary()}>Chat</button>;
    }
    render(<DockLayout {...regions} main={<OpenChat />} compact={false} secondarySidebarCollapsed />);
    fireEvent.click(screen.getByTestId('open-chat'));
    expect(screen.queryByTestId('secondary')).not.toBeInTheDocument();
  });

  it('the bottom panel opens from its top-bar button', () => {
    render(<DockLayout {...regions} compact />);
    fireEvent.click(screen.getByTestId('dock-open-bottom-panel'));
    expect(screen.getByTestId('bottom')).toBeInTheDocument();
  });

  it('the host can put its own actions in the top bar (e.g. Run)', () => {
    render(<DockLayout {...regions} compact topBarActions={<button type="button" data-testid="run">Run</button>} />);
    expect(screen.getByTestId('dock-top-bar').contains(screen.getByTestId('run'))).toBe(true);
  });

  it('top-bar actions are compact-only: the desktop frame has no top bar', () => {
    render(<DockLayout {...regions} compact={false} topBarActions={<button type="button" data-testid="run">Run</button>} />);
    expect(screen.queryByTestId('dock-top-bar')).not.toBeInTheDocument();
    expect(screen.queryByTestId('run')).not.toBeInTheDocument();
  });

  it('a region that is not there has no button', () => {
    render(<DockLayout main={<div />} compact />);
    expect(screen.queryByTestId('dock-menu')).not.toBeInTheDocument();
    expect(screen.queryByTestId('dock-open-secondary-sidebar')).not.toBeInTheDocument();
    expect(screen.queryByTestId('dock-open-bottom-panel')).not.toBeInTheDocument();
  });

  it('narrower than 1024px is compact by default; wider is the desktop frame', () => {
    const stubWidth = (narrow: boolean) => vi.stubGlobal('matchMedia', (q: string) => ({
      matches: narrow && q.includes('max-width'), media: q, addEventListener: () => undefined, removeEventListener: () => undefined,
      onchange: null, addListener: () => undefined, removeListener: () => undefined, dispatchEvent: () => false,
    }));
    stubWidth(true);
    const { unmount } = render(<DockLayout {...regions} />);
    expect(screen.getByTestId('dock-menu')).toBeInTheDocument();
    unmount();
    stubWidth(false);
    render(<DockLayout {...regions} />);
    expect(screen.queryByTestId('dock-menu')).not.toBeInTheDocument();
    expect(screen.getByTestId('rail').getAttribute('data-compact')).toBe('false');
    act(() => undefined);
  });
});

describe('useCompactLayout', () => {
  it('is the one compact threshold: narrower than 1024px', () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q === '(max-width: 1023.98px)', media: q, addEventListener: () => undefined, removeEventListener: () => undefined }));
    expect(renderHook(() => useCompactLayout()).result.current).toBe(true);
    vi.unstubAllGlobals();
  });
});

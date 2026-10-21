/**
 * DockLayout Component Tests
 *
 * Covers region presence/absence, collapse props hiding regions, and that
 * the two resizable boundaries wire controlled ratio through to SplitPane.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DockLayout } from '../DockLayout';

vi.mock('../SplitPane', () => ({
  SplitPane: (props: {
    direction?: string;
    ratio?: number;
    onRatioChange?: (ratio: number) => void;
    left: React.ReactNode;
    right: React.ReactNode;
    className?: string;
  }) => (
    <div
      data-testid={`split-pane-${props.direction}`}
      data-ratio={props.ratio}
      data-has-on-ratio-change={String(typeof props.onRatioChange === 'function')}
    >
      <div data-testid={`split-pane-${props.direction}-left`}>{props.left}</div>
      <div data-testid={`split-pane-${props.direction}-right`}>{props.right}</div>
    </div>
  ),
}));

describe('DockLayout', () => {
  it('renders only the required main region when no optional regions are provided', () => {
    render(<DockLayout main={<div data-testid="main">Main</div>} />);

    expect(screen.getByTestId('main')).toBeInTheDocument();
    expect(screen.queryByTestId('split-pane-horizontal')).not.toBeInTheDocument();
    expect(screen.queryByTestId('split-pane-vertical')).not.toBeInTheDocument();
  });

  it('renders only the regions that are provided (no empty gutters)', () => {
    render(
      <DockLayout
        rail={<div data-testid="rail">Rail</div>}
        main={<div data-testid="main">Main</div>}
        statusBar={<div data-testid="status-bar">Status</div>}
      />
    );

    expect(screen.getByTestId('rail')).toBeInTheDocument();
    expect(screen.getByTestId('main')).toBeInTheDocument();
    expect(screen.getByTestId('status-bar')).toBeInTheDocument();
    expect(screen.queryByTestId('sidebar')).not.toBeInTheDocument();
    expect(screen.queryByTestId('bottom-panel')).not.toBeInTheDocument();
    expect(screen.queryByTestId('secondary-sidebar')).not.toBeInTheDocument();
  });

  it('renders sidebar, bottomPanel, and secondarySidebar when all regions are provided', () => {
    render(
      <DockLayout
        rail={<div data-testid="rail">Rail</div>}
        sidebar={<div data-testid="sidebar">Sidebar</div>}
        main={<div data-testid="main">Main</div>}
        bottomPanel={<div data-testid="bottom-panel">Bottom</div>}
        statusBar={<div data-testid="status-bar">Status</div>}
        secondarySidebar={<div data-testid="secondary-sidebar">Secondary</div>}
      />
    );

    expect(screen.getByTestId('rail')).toBeInTheDocument();
    expect(screen.getByTestId('sidebar')).toBeInTheDocument();
    expect(screen.getByTestId('main')).toBeInTheDocument();
    expect(screen.getByTestId('bottom-panel')).toBeInTheDocument();
    expect(screen.getByTestId('status-bar')).toBeInTheDocument();
    expect(screen.getByTestId('secondary-sidebar')).toBeInTheDocument();
    expect(screen.getByTestId('split-pane-horizontal')).toBeInTheDocument();
    expect(screen.getByTestId('split-pane-vertical')).toBeInTheDocument();
  });

  it('hides the sidebar when sidebarCollapsed is true, even though sidebar content is provided', () => {
    render(
      <DockLayout
        sidebar={<div data-testid="sidebar">Sidebar</div>}
        sidebarCollapsed
        main={<div data-testid="main">Main</div>}
      />
    );

    expect(screen.queryByTestId('sidebar')).not.toBeInTheDocument();
    expect(screen.queryByTestId('split-pane-horizontal')).not.toBeInTheDocument();
  });

  it('hides the bottom panel when bottomPanelCollapsed is true', () => {
    render(
      <DockLayout
        main={<div data-testid="main">Main</div>}
        bottomPanel={<div data-testid="bottom-panel">Bottom</div>}
        bottomPanelCollapsed
      />
    );

    expect(screen.queryByTestId('bottom-panel')).not.toBeInTheDocument();
    expect(screen.queryByTestId('split-pane-vertical')).not.toBeInTheDocument();
  });

  it('hides the secondary sidebar when secondarySidebarCollapsed is true', () => {
    render(
      <DockLayout
        main={<div data-testid="main">Main</div>}
        secondarySidebar={<div data-testid="secondary-sidebar">Secondary</div>}
        secondarySidebarCollapsed
      />
    );

    expect(screen.queryByTestId('secondary-sidebar')).not.toBeInTheDocument();
  });

  it('passes the controlled sidebarWidth ratio and onSidebarWidthChange through to SplitPane', () => {
    const onSidebarWidthChange = vi.fn();
    render(
      <DockLayout
        sidebar={<div>Sidebar</div>}
        main={<div>Main</div>}
        sidebarWidth={35}
        onSidebarWidthChange={onSidebarWidthChange}
      />
    );

    const splitPane = screen.getByTestId('split-pane-horizontal');
    expect(splitPane).toHaveAttribute('data-ratio', '35');
    expect(splitPane).toHaveAttribute('data-has-on-ratio-change', 'true');
  });

  it('converts bottomPanelHeight into the top-pane ratio passed to the vertical SplitPane', () => {
    render(
      <DockLayout
        main={<div>Main</div>}
        bottomPanel={<div>Bottom</div>}
        bottomPanelHeight={30}
        onBottomPanelHeightChange={vi.fn()}
      />
    );

    const splitPane = screen.getByTestId('split-pane-vertical');
    expect(splitPane).toHaveAttribute('data-ratio', '70');
    expect(splitPane).toHaveAttribute('data-has-on-ratio-change', 'true');
  });
});

describe('DockLayout — every panel collapses and expands the same way', () => {
  const panels = (extra: Partial<React.ComponentProps<typeof DockLayout>> = {}) => (
    <DockLayout
      main={<div data-testid="main" />}
      sidebar={<div data-testid="sidebar" />}
      secondarySidebar={<div data-testid="secondary" />}
      bottomPanel={<div data-testid="bottom" />}
      {...extra}
    />
  );

  it('each open panel has a named collapse control; clicking it hides the panel and leaves an expand control', () => {
    render(panels());
    for (const [region, content] of [['sidebar', 'sidebar'], ['secondary-sidebar', 'secondary'], ['bottom-panel', 'bottom']] as const) {
      const collapse = screen.getByTestId(`dock-collapse-${region}`);
      expect(collapse.getAttribute('aria-label')).toBeTruthy();
      expect(collapse.getAttribute('aria-expanded')).toBe('true');
      fireEvent.click(collapse);
      expect(screen.queryByTestId(content)).not.toBeInTheDocument();
      const expand = screen.getByTestId(`dock-collapse-${region}`);
      expect(expand.getAttribute('aria-expanded')).toBe('false');
      fireEvent.click(expand);
      expect(screen.getByTestId(content)).toBeInTheDocument();
    }
  });

  it('controlled: the toggle reports the change and the host decides', () => {
    const onSidebarCollapsedChange = vi.fn();
    const { rerender } = render(panels({ sidebarCollapsed: false, onSidebarCollapsedChange }));
    fireEvent.click(screen.getByTestId('dock-collapse-sidebar'));
    expect(onSidebarCollapsedChange).toHaveBeenCalledWith(true);
    expect(screen.getByTestId('sidebar')).toBeInTheDocument();
    rerender(panels({ sidebarCollapsed: true, onSidebarCollapsedChange }));
    expect(screen.queryByTestId('sidebar')).not.toBeInTheDocument();
  });

  it('a region that was not given has no control', () => {
    render(<DockLayout main={<div />} sidebar={<div />} />);
    expect(screen.getByTestId('dock-collapse-sidebar')).toBeInTheDocument();
    expect(screen.queryByTestId('dock-collapse-secondary-sidebar')).not.toBeInTheDocument();
    expect(screen.queryByTestId('dock-collapse-bottom-panel')).not.toBeInTheDocument();
  });
});

describe('DockLayout — the rail', () => {
  it('never scrolls sideways, and sizes to the rail it holds (its content is in the theme\'s rem scale)', () => {
    render(<DockLayout main={<div />} rail={<div data-testid="rail" />} />);
    const column = screen.getByTestId('rail').parentElement as HTMLElement;
    expect(column.className).toMatch(/overflow-x-hidden/);
    expect(column.className).toMatch(/overflow-y-auto/);
    expect(column.style.width).toBe('');
  });

  it('an explicit railWidth still fixes the column', () => {
    render(<DockLayout main={<div />} rail={<div data-testid="rail" />} railWidth={64} />);
    expect((screen.getByTestId('rail').parentElement as HTMLElement).style.width).toBe('64px');
  });
});

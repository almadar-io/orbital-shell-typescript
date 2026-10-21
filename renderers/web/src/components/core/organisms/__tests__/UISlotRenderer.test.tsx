/**
 * Tests for UISlotRenderer component
 *
 * Tests the slot rendering system including:
 * - Layout slots (main, sidebar)
 * - Portal slots (modal, drawer, toast, overlay, center)
 * - HUD slots (hud-top, hud-bottom)
 * - Content rendering and dismissal
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { UISlotRenderer, UISlotComponent, SlotContentRenderer } from '../UISlotRenderer';
import { UISlotProvider } from '../../../../providers/UISlotContext';

// Wrapper component with provider
function TestWrapper({ children }: { children: React.ReactNode }) {
  return <UISlotProvider>{children}</UISlotProvider>;
}

describe('UISlotRenderer', () => {
  beforeEach(() => {
    // Clean up any portal roots from previous tests
    const portalRoot = document.getElementById('ui-slot-portal-root');
    if (portalRoot) {
      portalRoot.remove();
    }
  });

  describe('rendering', () => {
    it('should render without crashing', () => {
      render(
        <TestWrapper>
          <UISlotRenderer />
        </TestWrapper>
      );

      expect(document.querySelector('.ui-slot-renderer')).toBeInTheDocument();
    });

    it('should render layout slot placeholders', () => {
      render(
        <TestWrapper>
          <UISlotRenderer />
        </TestWrapper>
      );

      expect(document.getElementById('slot-sidebar')).toBeInTheDocument();
      expect(document.getElementById('slot-main')).toBeInTheDocument();
    });

    it('should not render HUD slots by default', () => {
      render(
        <TestWrapper>
          <UISlotRenderer />
        </TestWrapper>
      );

      expect(document.getElementById('slot-hud-top')).not.toBeInTheDocument();
      expect(document.getElementById('slot-hud-bottom')).not.toBeInTheDocument();
    });

    it('should render HUD slots when includeHud is true', () => {
      render(
        <TestWrapper>
          <UISlotRenderer includeHud />
        </TestWrapper>
      );

      expect(document.getElementById('slot-hud-top')).toBeInTheDocument();
      expect(document.getElementById('slot-hud-bottom')).toBeInTheDocument();
    });

    it('should not render floating slot by default', () => {
      render(
        <TestWrapper>
          <UISlotRenderer />
        </TestWrapper>
      );

      expect(document.getElementById('slot-floating')).not.toBeInTheDocument();
    });

    it('should render floating slot when includeFloating is true', () => {
      render(
        <TestWrapper>
          <UISlotRenderer includeFloating />
        </TestWrapper>
      );

      expect(document.getElementById('slot-floating')).toBeInTheDocument();
    });

    it('should apply custom className', () => {
      render(
        <TestWrapper>
          <UISlotRenderer className="custom-class" />
        </TestWrapper>
      );

      expect(document.querySelector('.custom-class')).toBeInTheDocument();
    });
  });

});

// Note: Tests for slot content, portal slots, and dismissal functionality
// are covered by the useUISlots hook tests. The UISlotRenderer component
// integration with the slot system is verified through manual testing
// and the basic rendering tests above.

describe('SlotContentRenderer', () => {
  // G-RUNTIME-037: the stale-V1 `entity: "Name"` guard must follow the
  // pattern's DECLARED `entity` type, not the prop name — filter-group (and
  // 7 other patterns) declare `entity: string` (an entity NAME).
  it('accepts a string entity on a pattern whose entity prop is declared string (filter-group)', () => {
    const content = {
      id: 'filter',
      pattern: 'filter-group',
      props: { entity: 'FilterTarget', filters: [] },
      priority: 0,
    };
    expect(() =>
      render(
        <TestWrapper>
          <SlotContentRenderer content={content} onDismiss={() => {}} />
        </TestWrapper>,
      ),
    ).not.toThrow();
  });

  it('still rejects a string entity on a data-bound pattern (data-list)', () => {
    const content = {
      id: 'list',
      pattern: 'data-list',
      props: { entity: 'Task' },
      priority: 0,
    };
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() =>
      render(
        <TestWrapper>
          <SlotContentRenderer content={content} onDismiss={() => {}} />
        </TestWrapper>,
      ),
    ).toThrow(/Received string 'entity: "Task"'/);
    spy.mockRestore();
  });

  it('should render children when provided', () => {
    const content = {
      id: 'test-id',
      pattern: 'test-pattern',
      props: { children: <div data-testid="test-child">Child Content</div> },
      priority: 0,
    };

    render(<SlotContentRenderer content={content} onDismiss={() => {}} />);

    expect(screen.getByTestId('test-child')).toBeInTheDocument();
  });

  it('should render pattern info when no children', () => {
    const content = {
      id: 'test-id',
      pattern: 'my-test-pattern',
      props: {},
      priority: 0,
    };

    render(<SlotContentRenderer content={content} onDismiss={() => {}} />);

    // Unknown patterns show "Unknown pattern:" prefix
    expect(screen.getByText(/Unknown pattern: my-test-pattern/)).toBeInTheDocument();
  });

  it('lifts a bare @trait.X string payload to a TraitFrame (not the unknown-pattern fallback)', () => {
    // `(render-ui main "@trait.X")` — a whole-slot trait-embed reference —
    // reaches the slot as an empty pattern whose props ARE the string.
    const content = {
      id: 'test-id',
      pattern: '',
      props: '@trait.SomeChartTrait',
      priority: 0,
      sourceTrait: 'HostTrait',
    };

    render(
      <TestWrapper>
        <SlotContentRenderer content={content} onDismiss={() => {}} />
      </TestWrapper>,
    );

    // Must NOT paint the unknown-pattern placeholder…
    expect(screen.queryByText(/Unknown pattern:/)).not.toBeInTheDocument();
    // …and the TraitFrame must have looked up the referenced trait (the
    // frame renders nothing for an unknown/unmounted trait, silently).
  });

  it('renders an admitted avl pattern (avl-state-machine) as its component, not the placeholder', async () => {
    const content = {
      id: 'avl-id',
      pattern: 'avl-state-machine',
      props: {
        trait: {
          name: 'Approval',
          linkedEntity: 'Expense',
          states: [{ name: 'draft', isInitial: true, isTerminal: false }, { name: 'approved', isInitial: false, isTerminal: true }],
          transitions: [{ from: 'draft', to: 'approved', event: 'APPROVE', effects: [], index: 0 }],
          emittedEvents: [],
          listenedEvents: [],
        },
        activeState: 'draft',
      },
      priority: 0,
    };

    render(
      <TestWrapper>
        <SlotContentRenderer content={content} onDismiss={() => {}} />
      </TestWrapper>,
    );

    expect(screen.queryByText(/Unknown pattern:/)).not.toBeInTheDocument();
    expect(await screen.findByTestId('avl-state-machine')).toBeInTheDocument();
  });

  it('keeps the unknown-pattern fallback for genuinely unknown patterns', () => {
    const content = {
      id: 'test-id',
      pattern: 'not-a-real-pattern',
      props: {},
      priority: 0,
    };

    render(<SlotContentRenderer content={content} onDismiss={() => {}} />);

    expect(screen.getByText(/Unknown pattern: not-a-real-pattern/)).toBeInTheDocument();
  });

  it('should include sourceTrait in fallback display', () => {
    const content = {
      id: 'test-id',
      pattern: 'test-pattern',
      props: {},
      priority: 0,
      sourceTrait: 'TestTrait',
    };

    render(<SlotContentRenderer content={content} onDismiss={() => {}} />);

    expect(screen.getByText(/TestTrait/)).toBeInTheDocument();
  });

  it('should set data attributes on wrapper', () => {
    const content = {
      id: 'test-id',
      pattern: 'test-pattern',
      props: {},
      priority: 0,
    };

    const { container } = render(<SlotContentRenderer content={content} onDismiss={() => {}} />);

    const wrapper = container.querySelector('.slot-content');
    expect(wrapper).toHaveAttribute('data-pattern', 'test-pattern');
    expect(wrapper).toHaveAttribute('data-id', 'test-id');
  });
});

describe('SlotContentRenderer: patterns inside a declared item array', () => {
  const renderContent = (pattern: string, props: Record<string, unknown>) =>
    render(
      <TestWrapper>
        <SlotContentRenderer content={{ id: pattern, pattern, props: props as never, priority: 0 }} onDismiss={() => {}} />
      </TestWrapper>,
    );

  it('renders a pattern given as an accordion item\'s content (node-typed), not the raw object', () => {
    renderContent('accordion', {
      items: [{ id: 'shown', title: 'Shown (1)', defaultOpen: true, content: { type: 'typography', variant: 'body', content: 'Nested pattern body' } }],
    });
    expect(screen.getByText('Nested pattern body')).toBeInTheDocument();
    expect(screen.getByText('Shown (1)')).toBeInTheDocument();
  });

  it('renders a pattern given as a tab\'s content', () => {
    renderContent('tabs', {
      items: [{ id: 'a', label: 'First', content: { type: 'typography', variant: 'body', content: 'Tab body' } }],
    });
    expect(screen.getByText('Tab body')).toBeInTheDocument();
  });

  it('control: a field that is not node-typed keeps its data, even when its value names a pattern', () => {
    renderContent('accordion', {
      items: [{ id: 'x', title: 'Plain', defaultOpen: true, content: 'Just text' }],
    });
    expect(screen.getByText('Just text')).toBeInTheDocument();
  });
});

describe('UISlotComponent', () => {
  it('should render empty placeholder for layout slots without content', () => {
    render(
      <TestWrapper>
        <UISlotComponent slot="main" />
      </TestWrapper>
    );

    const slot = document.getElementById('slot-main');
    expect(slot).toBeInTheDocument();
    expect(slot).toHaveClass('ui-slot');
    expect(slot).toHaveClass('ui-slot-main');
  });

  it('should return null for portal slots without content', () => {
    const { container } = render(
      <TestWrapper>
        <UISlotComponent slot="modal" portal />
      </TestWrapper>
    );

    // Portal slot with no content should not render anything
    expect(container.firstChild).toBeNull();
  });

  it('should apply custom className', () => {
    render(
      <TestWrapper>
        <UISlotComponent slot="sidebar" className="custom-sidebar" />
      </TestWrapper>
    );

    const slot = document.getElementById('slot-sidebar');
    expect(slot).toHaveClass('custom-sidebar');
  });
});

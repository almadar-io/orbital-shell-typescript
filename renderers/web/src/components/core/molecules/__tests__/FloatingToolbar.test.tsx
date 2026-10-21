/**
 * FloatingToolbar Component Tests
 *
 * Tests item rendering, declarative event/action emission on click, and
 * disabled/active handling.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FloatingToolbar, type FloatingToolbarItem } from '../FloatingToolbar';
import { EventBusProvider } from '../../../../core';
import { useEventBus } from '../../../../core';

const TestWrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <EventBusProvider debug={false}>{children}</EventBusProvider>
);

const items: FloatingToolbarItem[] = [
  { id: 'select', icon: 'mouse-pointer', label: 'Select', event: 'TOOL_SELECT' },
  { id: 'pan', icon: 'hand', label: 'Pan', action: 'TOOL_PAN' },
];

describe('FloatingToolbar', () => {
  it('renders an item for each entry', () => {
    render(
      <TestWrapper>
        <FloatingToolbar items={items} />
      </TestWrapper>
    );

    expect(screen.getByTestId('floating-toolbar-item-select')).toBeInTheDocument();
    expect(screen.getByTestId('floating-toolbar-item-pan')).toBeInTheDocument();
  });

  it('uses each item label as the default aria-label', () => {
    render(
      <TestWrapper>
        <FloatingToolbar items={items} />
      </TestWrapper>
    );

    expect(screen.getByTestId('floating-toolbar-item-select')).toHaveAttribute('aria-label', 'Select');
    expect(screen.getByTestId('floating-toolbar-item-pan')).toHaveAttribute('aria-label', 'Pan');
  });

  it('emits UI:{event} with the item id when an item with `event` is clicked', () => {
    const listener = vi.fn();
    const EventListener: React.FC = () => {
      const eventBus = useEventBus();
      React.useEffect(() => eventBus.on('UI:TOOL_SELECT', listener), [eventBus]);
      return null;
    };

    render(
      <TestWrapper>
        <EventListener />
        <FloatingToolbar items={items} />
      </TestWrapper>
    );

    fireEvent.click(screen.getByTestId('floating-toolbar-item-select'));

    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'UI:TOOL_SELECT',
        payload: { actionId: 'select' },
      })
    );
  });

  it('emits UI:{action} (via the Button atom) when an item with `action` is clicked', () => {
    const listener = vi.fn();
    const EventListener: React.FC = () => {
      const eventBus = useEventBus();
      React.useEffect(() => eventBus.on('UI:TOOL_PAN', listener), [eventBus]);
      return null;
    };

    render(
      <TestWrapper>
        <EventListener />
        <FloatingToolbar items={items} />
      </TestWrapper>
    );

    fireEvent.click(screen.getByTestId('floating-toolbar-item-pan'));

    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'UI:TOOL_PAN' })
    );
  });

  it('does not fire click behavior for a disabled item', () => {
    const listener = vi.fn();
    const EventListener: React.FC = () => {
      const eventBus = useEventBus();
      React.useEffect(() => eventBus.on('UI:TOOL_SELECT', listener), [eventBus]);
      return null;
    };

    render(
      <TestWrapper>
        <EventListener />
        <FloatingToolbar
          items={[{ id: 'select', icon: 'mouse-pointer', label: 'Select', event: 'TOOL_SELECT', disabled: true }]}
        />
      </TestWrapper>
    );

    const button = screen.getByTestId('floating-toolbar-item-select');
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(listener).not.toHaveBeenCalled();
  });

  it('marks an active item with aria-pressed', () => {
    render(
      <TestWrapper>
        <FloatingToolbar
          items={[{ id: 'select', icon: 'mouse-pointer', label: 'Select', active: true }]}
        />
      </TestWrapper>
    );

    expect(screen.getByTestId('floating-toolbar-item-select')).toHaveAttribute('aria-pressed', 'true');
  });

  it('applies the top-right position classes', () => {
    render(
      <TestWrapper>
        <FloatingToolbar items={items} position="top-right" />
      </TestWrapper>
    );

    expect(screen.getByTestId('floating-toolbar-item-select').closest('.fixed')).toHaveClass('top-6', 'right-6');
  });

  it('renders passthrough children after a divider', () => {
    render(
      <TestWrapper>
        <FloatingToolbar items={items}>
          <div data-testid="custom-cell">Custom</div>
        </FloatingToolbar>
      </TestWrapper>
    );

    expect(screen.getByTestId('custom-cell')).toBeInTheDocument();
    expect(screen.getByRole('separator')).toBeInTheDocument();
  });
});

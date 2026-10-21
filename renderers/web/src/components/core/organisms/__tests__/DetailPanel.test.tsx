/**
 * DetailPanel Component Tests
 *
 * DetailPanel receives pre-resolved data via its `entity` prop (bound from
 * `@payload.data` / `@payload.row` on the state machine). The three tests
 * that asserted bus-driven `selectedEntity` swapping on `UI:VIEW`/`UI:SELECT`/
 * `UI:CLOSE` were removed 2026-08-19: that mechanism was deleted in G13
 * (2026-04-24) along with `useEntityDetail` — the tests outlived the behavior
 * by five months because the component test glob was orphaned from the
 * vitest config.
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { DetailPanel } from '../DetailPanel';
import { EventBusProvider } from '../../../../core';
import { useEventBus } from '../../../../core';

// Test wrapper with providers
const createTestWrapper = (initialRoute = '/') => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });

  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialRoute]}>
        <EventBusProvider debug={false}>
          <Routes>
            <Route path="*" element={children} />
          </Routes>
        </EventBusProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
};

describe('DetailPanel', () => {
  const mockProduct = {
    id: '1',
    name: 'Premium Laptop',
    description: 'A high-performance laptop',
    price: 1299,
    category: 'Electronics',
    sku: 'LAPTOP-001',
    inStock: true,
  };

  it('renders with explicit data prop', () => {
    const TestWrapper = createTestWrapper();

    render(
      <TestWrapper>
        <DetailPanel
          entity={mockProduct}
          fields={[{ name: 'name', variant: 'h3' }, { name: 'price', format: 'number' }, 'category']}
        />
      </TestWrapper>
    );

    expect(screen.getByText('Premium Laptop')).toBeInTheDocument();
    expect(screen.getByText('1,299')).toBeInTheDocument();
  });

  it('shows the not-found empty state without an entity', () => {
    const TestWrapper = createTestWrapper();

    render(
      <TestWrapper>
        <DetailPanel
          fields={['name', 'price', 'category']}
          fieldNames={['name', 'price', 'category']}
        />
      </TestWrapper>
    );

    expect(screen.getByText('Not found')).toBeInTheDocument();
  });

  it('renders the entity prop and ignores bus events (V2 data flow)', async () => {
    const TestWrapper = createTestWrapper();
    const explicitData = { ...mockProduct, name: 'Explicit Product' };

    let emitSelect: (entity: typeof mockProduct) => void = () => {};
    const EventController: React.FC = () => {
      const eventBus = useEventBus();
      emitSelect = (entity) => {
        eventBus.emit('UI:SELECT', { row: entity });
      };
      return null;
    };

    render(
      <TestWrapper>
        <EventController />
        <DetailPanel
          entity={explicitData}
          fields={[{ name: 'name', variant: 'h3' }, 'price']}
        />
      </TestWrapper>
    );

    expect(screen.getByText('Explicit Product')).toBeInTheDocument();

    act(() => {
      emitSelect(mockProduct);
    });

    expect(screen.getByText('Explicit Product')).toBeInTheDocument();
    expect(screen.queryByText('Premium Laptop')).not.toBeInTheDocument();
  });
});

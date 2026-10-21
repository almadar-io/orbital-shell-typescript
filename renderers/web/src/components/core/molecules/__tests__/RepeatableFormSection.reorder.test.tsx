import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RepeatableFormSection, type RepeatableItem } from '../RepeatableFormSection';
import { EventBusProvider } from '../../../../core';

const ITEMS: RepeatableItem[] = [{ id: 'a', name: 'Alpha' }, { id: 'b', name: 'Beta' }, { id: 'c', name: 'Gamma' }];

function renderSection(props: Partial<React.ComponentProps<typeof RepeatableFormSection>> = {}) {
  return render(
    <EventBusProvider debug={false}>
      <RepeatableFormSection
        sectionType="people"
        title="People"
        items={ITEMS}
        renderItem={(item) => <span>{String(item.name)}</span>}
        {...props}
      />
    </EventBusProvider>,
  );
}

describe('RepeatableFormSection reorder', () => {
  it('moving an entry down calls onReorder(from, to)', () => {
    const onReorder = vi.fn();
    renderSection({ allowReorder: true, onReorder });
    fireEvent.click(screen.getAllByRole('button', { name: 'Move down' })[0]);
    expect(onReorder).toHaveBeenCalledWith(0, 1);
  });

  it('moving an entry up calls onReorder(from, to)', () => {
    const onReorder = vi.fn();
    renderSection({ allowReorder: true, onReorder });
    fireEvent.click(screen.getAllByRole('button', { name: 'Move up' })[2]);
    expect(onReorder).toHaveBeenCalledWith(2, 1);
  });

  it('disables the moves that would leave the list', () => {
    renderSection({ allowReorder: true, onReorder: vi.fn() });
    const up = screen.getAllByRole('button', { name: 'Move up' });
    const down = screen.getAllByRole('button', { name: 'Move down' });
    expect(up.map((b) => (b as HTMLButtonElement).disabled)).toEqual([true, false, false]);
    expect(down.map((b) => (b as HTMLButtonElement).disabled)).toEqual([false, false, true]);
  });

  it('control: no reorder controls without allowReorder', () => {
    renderSection({ onReorder: vi.fn() });
    expect(screen.queryByRole('button', { name: 'Move up' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Move down' })).toBeNull();
  });

  it('control: no reorder controls when read-only', () => {
    renderSection({ allowReorder: true, readOnly: true, onReorder: vi.fn() });
    expect(screen.queryByRole('button', { name: 'Move up' })).toBeNull();
  });

  it('names the icon-only remove button', () => {
    renderSection({});
    expect(screen.getAllByRole('button', { name: 'Remove' }).length).toBe(3);
  });

  it('translates the minimum-items warning', () => {
    renderSection({ items: [], minItems: 2 });
    expect(screen.getByText('At least 2 items required')).toBeTruthy();
  });
});

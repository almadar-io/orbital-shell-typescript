import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Select } from '../Select';
import { EventBusProvider } from '../../../core';

const OPTIONS = [
  { value: 'todo', label: 'To do' },
  { value: 'done', label: 'Done' },
];

function renderSelect(props: Partial<React.ComponentProps<typeof Select>>) {
  return render(
    <EventBusProvider debug={false}>
      <Select label="Move to" options={OPTIONS} {...props} />
    </EventBusProvider>,
  );
}

describe('Select placeholder', () => {
  it('shows the placeholder, not the first option, when there is no value', () => {
    renderSelect({ placeholder: 'Move to…', action: 'MOVE' });
    const select = screen.getByLabelText('Move to') as HTMLSelectElement;
    expect(select.value).toBe('');
    expect(select.selectedOptions[0].textContent).toBe('Move to…');
  });

  it('shows the given value over the placeholder', () => {
    renderSelect({ placeholder: 'Move to…', action: 'MOVE', value: 'done' });
    expect((screen.getByLabelText('Move to') as HTMLSelectElement).value).toBe('done');
  });

  it('without a placeholder the browser default (first option) stands', () => {
    renderSelect({ action: 'MOVE' });
    expect((screen.getByLabelText('Move to') as HTMLSelectElement).value).toBe('todo');
  });
});

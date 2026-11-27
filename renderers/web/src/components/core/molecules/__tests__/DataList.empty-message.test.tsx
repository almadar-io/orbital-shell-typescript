/**
 * A list that declares `emptyMessage: ""` says nothing when it has no rows: the chat rail's channel browser
 * showed a bare "No items" between Channels and Direct messages once every public channel was joined.
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DataList, type DataListField } from '../DataList';
import { EventBusProvider } from '../../../../core';

const fields: readonly DataListField[] = [{ name: 'label', variant: 'h4' }];

function mount(props: Partial<React.ComponentProps<typeof DataList>>): ReturnType<typeof render> {
  return render(<DataList entity={[]} fields={fields} {...props} />, {
    wrapper: ({ children }) => <EventBusProvider>{children}</EventBusProvider>,
  });
}

describe('DataList empty message', () => {
  it('an empty-string message renders no empty state', () => {
    const { container } = mount({ emptyMessage: '' });
    expect(screen.queryByText(/no items/i)).toBeNull();
    expect(container.textContent).toBe('');
  });

  it('control: no message falls back to the generic empty state', () => {
    mount({});
    expect(screen.getByText(/no items/i)).toBeInTheDocument();
  });

  it('control: a declared message is shown', () => {
    mount({ emptyMessage: 'No channels to join' });
    expect(screen.getByText('No channels to join')).toBeInTheDocument();
  });

  it('edge: an empty-string message still shows a declared title', () => {
    mount({ emptyMessage: '', emptyTitle: 'Nothing yet' });
    expect(screen.getByText('Nothing yet')).toBeInTheDocument();
  });
});

import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CommandPalette } from '../CommandPalette';
import { RichTextEditor } from '../RichTextEditor';
import { EventBusProvider } from '../../../../core';

describe('focus rings', () => {
  it('a command palette option shows a focus-visible ring', () => {
    render(
      <EventBusProvider debug={false}>
        <CommandPalette open onOpenChange={() => {}} commands={[{ id: 'a', label: 'Alpha' }]} />
      </EventBusProvider>,
    );
    expect(screen.getByTestId('command-palette-item-a').className).toContain('focus-visible:ring-ring');
  });

  it('the rich text surface shows a focus-visible ring', () => {
    Object.assign(document, { execCommand: () => true });
    render(<EventBusProvider debug={false}><RichTextEditor /></EventBusProvider>);
    expect(screen.getByRole('textbox').className).toContain('focus-visible:ring-ring');
  });
});

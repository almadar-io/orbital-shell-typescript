/**
 * CommandPalette Component Tests
 *
 * Tests filtering, keyboard navigation + selection, Escape-to-close,
 * grouped rendering, and the empty state.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CommandPalette, dispatchCommandPaletteCommand, type CommandPaletteCommand } from '../CommandPalette';
import { EventBusProvider } from '../../../../core';
import { useEventBus } from '../../../../core';

const TestWrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <EventBusProvider debug={false}>{children}</EventBusProvider>
);

const commands: CommandPaletteCommand[] = [
  { id: 'open-file', label: 'Open File', shortcut: '⌘O', group: 'File' },
  { id: 'save-file', label: 'Save File', shortcut: '⌘S', group: 'File' },
  { id: 'toggle-theme', label: 'Toggle Theme', group: 'View' },
  { id: 'go-to-line', label: 'Go to Line', keywords: ['navigate', 'jump'] },
];

describe('CommandPalette', () => {
  it('renders nothing when closed', () => {
    render(
      <TestWrapper>
        <CommandPalette open={false} onOpenChange={vi.fn()} commands={commands} />
      </TestWrapper>
    );

    expect(screen.queryByTestId('command-palette')).not.toBeInTheDocument();
  });

  it('renders every command when open', () => {
    render(
      <TestWrapper>
        <CommandPalette open onOpenChange={vi.fn()} commands={commands} />
      </TestWrapper>
    );

    for (const command of commands) {
      expect(screen.getByTestId(`command-palette-item-${command.id}`)).toBeInTheDocument();
    }
  });

  it('narrows the list as the query changes', () => {
    render(
      <TestWrapper>
        <CommandPalette open onOpenChange={vi.fn()} commands={commands} />
      </TestWrapper>
    );

    fireEvent.change(screen.getByTestId('command-palette-input'), { target: { value: 'save' } });

    expect(screen.getByTestId('command-palette-item-save-file')).toBeInTheDocument();
    expect(screen.queryByTestId('command-palette-item-open-file')).not.toBeInTheDocument();
    expect(screen.queryByTestId('command-palette-item-toggle-theme')).not.toBeInTheDocument();
  });

  it('matches against keywords as well as the label', () => {
    render(
      <TestWrapper>
        <CommandPalette open onOpenChange={vi.fn()} commands={commands} />
      </TestWrapper>
    );

    fireEvent.change(screen.getByTestId('command-palette-input'), { target: { value: 'jump' } });

    expect(screen.getByTestId('command-palette-item-go-to-line')).toBeInTheDocument();
    expect(screen.queryByTestId('command-palette-item-open-file')).not.toBeInTheDocument();
  });

  it('shows the empty state label when nothing matches', () => {
    render(
      <TestWrapper>
        <CommandPalette
          open
          onOpenChange={vi.fn()}
          commands={commands}
          emptyLabel="Nothing found"
        />
      </TestWrapper>
    );

    fireEvent.change(screen.getByTestId('command-palette-input'), { target: { value: 'zzz-no-match' } });

    expect(screen.getByTestId('command-palette-empty')).toHaveTextContent('Nothing found');
  });

  it('renders group headers when commands declare a group', () => {
    render(
      <TestWrapper>
        <CommandPalette open onOpenChange={vi.fn()} commands={commands} />
      </TestWrapper>
    );

    expect(screen.getByText('File')).toBeInTheDocument();
    expect(screen.getByText('View')).toBeInTheDocument();
  });

  it('moves the highlight with ArrowDown/ArrowUp and wraps at the ends', () => {
    render(
      <TestWrapper>
        <CommandPalette open onOpenChange={vi.fn()} commands={commands} />
      </TestWrapper>
    );

    const input = screen.getByTestId('command-palette-input');
    expect(screen.getByTestId('command-palette-item-open-file')).toHaveAttribute('aria-selected', 'true');

    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(screen.getByTestId('command-palette-item-save-file')).toHaveAttribute('aria-selected', 'true');

    fireEvent.keyDown(input, { key: 'ArrowUp' });
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(screen.getByTestId('command-palette-item-go-to-line')).toHaveAttribute('aria-selected', 'true');
  });

  it('resets the highlight to the first row when the query changes', () => {
    render(
      <TestWrapper>
        <CommandPalette open onOpenChange={vi.fn()} commands={commands} />
      </TestWrapper>
    );

    const input = screen.getByTestId('command-palette-input');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.change(input, { target: { value: 'file' } });

    expect(screen.getByTestId('command-palette-item-open-file')).toHaveAttribute('aria-selected', 'true');
  });

  it('selects the highlighted command on Enter and closes the palette', () => {
    const onSelect = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <TestWrapper>
        <CommandPalette open onOpenChange={onOpenChange} commands={commands} onSelect={onSelect} />
      </TestWrapper>
    );

    const input = screen.getByTestId('command-palette-input');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'save-file' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('selects a command on click', () => {
    const onSelect = vi.fn();
    render(
      <TestWrapper>
        <CommandPalette open onOpenChange={vi.fn()} commands={commands} onSelect={onSelect} />
      </TestWrapper>
    );

    fireEvent.click(screen.getByTestId('command-palette-item-toggle-theme'));

    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'toggle-theme' }));
  });

  it('emits UI:{event} with the commandId when a command declares `event`', () => {
    const listener = vi.fn();
    const EventListener: React.FC = () => {
      const eventBus = useEventBus();
      React.useEffect(() => eventBus.on('UI:PALETTE_PICK', listener), [eventBus]);
      return null;
    };

    render(
      <TestWrapper>
        <EventListener />
        <CommandPalette
          open
          onOpenChange={vi.fn()}
          commands={[{ id: 'pick', label: 'Pick Me', event: 'PALETTE_PICK' }]}
        />
      </TestWrapper>
    );

    fireEvent.click(screen.getByTestId('command-palette-item-pick'));

    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'UI:PALETTE_PICK', payload: { commandId: 'pick' } })
    );
  });

  it('emits UI:{action} with actionPayload when a command declares `action`', () => {
    const listener = vi.fn();
    const EventListener: React.FC = () => {
      const eventBus = useEventBus();
      React.useEffect(() => eventBus.on('UI:PALETTE_ACTION', listener), [eventBus]);
      return null;
    };

    render(
      <TestWrapper>
        <EventListener />
        <CommandPalette
          open
          onOpenChange={vi.fn()}
          commands={[{ id: 'act', label: 'Act', action: 'PALETTE_ACTION', actionPayload: { foo: 'bar' } }]}
        />
      </TestWrapper>
    );

    fireEvent.click(screen.getByTestId('command-palette-item-act'));

    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'UI:PALETTE_ACTION', payload: { foo: 'bar' } })
    );
  });

  it('does not select a disabled command', () => {
    const onSelect = vi.fn();
    render(
      <TestWrapper>
        <CommandPalette
          open
          onOpenChange={vi.fn()}
          commands={[{ id: 'blocked', label: 'Blocked', disabled: true }]}
          onSelect={onSelect}
        />
      </TestWrapper>
    );

    fireEvent.click(screen.getByTestId('command-palette-item-blocked'));

    expect(onSelect).not.toHaveBeenCalled();
  });

  it('closes on Escape', () => {
    const onOpenChange = vi.fn();
    render(
      <TestWrapper>
        <CommandPalette open onOpenChange={onOpenChange} commands={commands} />
      </TestWrapper>
    );

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

describe('dispatchCommandPaletteCommand', () => {
  it('emits UI:{event} with the commandId for an event-only command', () => {
    const emit = vi.fn();
    const onSelect = vi.fn();
    const command: CommandPaletteCommand = { id: 'pick', label: 'Pick Me', event: 'PALETTE_PICK' };

    dispatchCommandPaletteCommand(command, { emit, onSelect });

    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith('UI:PALETTE_PICK', { commandId: 'pick' });
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(command);
  });

  it('emits UI:{action} with actionPayload for an action-only command', () => {
    const emit = vi.fn();
    const onSelect = vi.fn();
    const command: CommandPaletteCommand = {
      id: 'act',
      label: 'Act',
      action: 'PALETTE_ACTION',
      actionPayload: { foo: 'bar' },
    };

    dispatchCommandPaletteCommand(command, { emit, onSelect });

    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith('UI:PALETTE_ACTION', { foo: 'bar' });
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(command);
  });

  it('emits both event and action, in that order, when a command declares both', () => {
    const emit = vi.fn();
    const command: CommandPaletteCommand = {
      id: 'both',
      label: 'Both',
      event: 'PALETTE_PICK',
      action: 'PALETTE_ACTION',
      actionPayload: { foo: 'bar' },
    };

    dispatchCommandPaletteCommand(command, { emit });

    expect(emit).toHaveBeenCalledTimes(2);
    expect(emit).toHaveBeenNthCalledWith(1, 'UI:PALETTE_PICK', { commandId: 'both' });
    expect(emit).toHaveBeenNthCalledWith(2, 'UI:PALETTE_ACTION', { foo: 'bar' });
  });

  it('calls onSelect exactly once with the command', () => {
    const onSelect = vi.fn();
    const command: CommandPaletteCommand = { id: 'plain', label: 'Plain' };

    dispatchCommandPaletteCommand(command, { emit: vi.fn(), onSelect });

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(command);
  });

  it('does nothing for a disabled command', () => {
    const emit = vi.fn();
    const onSelect = vi.fn();
    const command: CommandPaletteCommand = {
      id: 'blocked',
      label: 'Blocked',
      disabled: true,
      event: 'PALETTE_PICK',
    };

    dispatchCommandPaletteCommand(command, { emit, onSelect });

    expect(emit).not.toHaveBeenCalled();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('regression: selecting a row in the rendered palette dispatches identically', () => {
    const listener = vi.fn();
    const onSelect = vi.fn();
    const EventListener: React.FC = () => {
      const eventBus = useEventBus();
      React.useEffect(() => eventBus.on('UI:PALETTE_PICK', listener), [eventBus]);
      return null;
    };

    render(
      <TestWrapper>
        <EventListener />
        <CommandPalette
          open
          onOpenChange={vi.fn()}
          commands={[{ id: 'pick', label: 'Pick Me', event: 'PALETTE_PICK' }]}
          onSelect={onSelect}
        />
      </TestWrapper>
    );

    fireEvent.click(screen.getByTestId('command-palette-item-pick'));

    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'UI:PALETTE_PICK', payload: { commandId: 'pick' } })
    );
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'pick' }));
  });
});

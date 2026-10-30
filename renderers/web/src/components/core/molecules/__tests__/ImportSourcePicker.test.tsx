/**
 * ImportSourcePicker Component Tests
 *
 * Tests for source option rendering and selection callbacks.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toPayloadValue } from '@almadar/core';
import { ImportSourcePicker, type ImportSourceOption } from '../import/ImportSourcePicker';
import { EventBusProvider } from '../../../../core';
import { MemoryRouter } from 'react-router-dom';

const TestWrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <MemoryRouter>
    <EventBusProvider debug={false}>{children}</EventBusProvider>
  </MemoryRouter>
);

const sources: ImportSourceOption[] = [
  { id: 'paste', label: 'Paste text', description: 'Paste raw content', icon: 'clipboard' },
  { id: 'markdown', label: 'Markdown files', kind: 'file', accept: '.md', multiple: true },
];

describe('ImportSourcePicker', () => {
  it('renders source options with labels and descriptions', () => {
    render(
      <TestWrapper>
        <ImportSourcePicker sources={sources} title="Import from" />
      </TestWrapper>
    );

    expect(screen.getByText('Import from')).toBeTruthy();
    expect(screen.getByText('Paste text')).toBeTruthy();
    expect(screen.getByText('Paste raw content')).toBeTruthy();
    expect(screen.getByText('Markdown files')).toBeTruthy();
  });

  it('calls onSelect with the source id when an action option is clicked', () => {
    const onSelect = vi.fn();
    render(
      <TestWrapper>
        <ImportSourcePicker sources={sources} onSelect={onSelect} />
      </TestWrapper>
    );

    fireEvent.click(screen.getByText('Paste text'));
    expect(onSelect).toHaveBeenCalledWith('paste');
  });

  it('calls onFilesSelected when a file option resolves files', async () => {
    const onFilesSelected = vi.fn();
    render(
      <TestWrapper>
        <ImportSourcePicker sources={sources} onFilesSelected={onFilesSelected} />
      </TestWrapper>
    );

    fireEvent.click(screen.getByText('Markdown files'));
    const input = screen.getByTestId('import-source-file-input');
    const file = new File(['# Notes'], 'notes.md', { type: 'text/markdown' });
    await userEvent.upload(input, file);

    await waitFor(() => expect(onFilesSelected).toHaveBeenCalledTimes(1));
    expect(onFilesSelected.mock.calls[0][0]).toEqual([
      { name: 'notes.md', size: 7, type: 'text/markdown', text: '# Notes' },
    ]);
  });

  it('delivers picked files as plain JSON records a program event can carry (no File objects)', async () => {
    const onFilesSelected = vi.fn();
    render(
      <TestWrapper>
        <ImportSourcePicker sources={sources} onFilesSelected={onFilesSelected} />
      </TestWrapper>
    );
    fireEvent.click(screen.getByText('Markdown files'));
    const input = screen.getByTestId('import-source-file-input');
    await userEvent.upload(input, [
      new File(['# One'], 'one.md', { type: 'text/markdown' }),
      new File(['# Two'], 'two.md', { type: 'text/markdown' }),
    ]);
    await waitFor(() => expect(onFilesSelected).toHaveBeenCalledTimes(1));
    const files = onFilesSelected.mock.calls[0][0];
    expect(files.map((f: { name: string }) => f.name)).toEqual(['one.md', 'two.md']);
    expect(files.every((f: object) => !(f instanceof File))).toBe(true);
    expect(toPayloadValue(files)).toEqual(files);
  });

  it('control: cancelling the picker (no files) emits nothing', () => {
    const onFilesSelected = vi.fn();
    render(
      <TestWrapper>
        <ImportSourcePicker sources={sources} onFilesSelected={onFilesSelected} />
      </TestWrapper>
    );
    fireEvent.change(screen.getByTestId('import-source-file-input'), { target: { files: [] } });
    expect(onFilesSelected).not.toHaveBeenCalled();
  });

  it('renders the moreSources slot', () => {
    render(
      <TestWrapper>
        <ImportSourcePicker sources={sources} moreSources={<div>Notion (coming soon)</div>} />
      </TestWrapper>
    );

    expect(screen.getByText('Notion (coming soon)')).toBeTruthy();
  });
});

/**
 * TagInput Component Tests
 *
 * Controlled `value: string[]` editor — tests add (Enter),
 * remove (Badge X), Backspace-removes-last, and duplicate suppression.
 */
import React, { useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TagInput } from '../TagInput';

function Wrapper({
  initial = [],
  unique = true,
  disabled = false,
}: {
  initial?: ReadonlyArray<string>;
  unique?: boolean;
  disabled?: boolean;
}) {
  const [value, setValue] = useState<ReadonlyArray<string>>(initial);
  return (
    <TagInput
      value={value}
      onChange={setValue}
      placeholder="Add tag…"
      unique={unique}
      disabled={disabled}
    />
  );
}

describe('TagInput', () => {
  it('renders an empty input with the placeholder', () => {
    render(<Wrapper />);
    expect(screen.getByPlaceholderText('Add tag…')).toBeInTheDocument();
  });

  it('commits a tag on Enter and clears the input', () => {
    render(<Wrapper />);
    const input = screen.getByPlaceholderText('Add tag…') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'apples' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByText('apples')).toBeInTheDocument();
    expect(input.value).toBe('');
  });

  it('renders an X remove button on each chip', () => {
    render(<Wrapper initial={['a', 'b']} />);
    expect(screen.getByLabelText('Remove a')).toBeInTheDocument();
    expect(screen.getByLabelText('Remove b')).toBeInTheDocument();
  });

  it('removes a chip when its X is clicked', () => {
    render(<Wrapper initial={['a', 'b', 'c']} />);
    fireEvent.click(screen.getByLabelText('Remove b'));
    expect(screen.queryByText('b')).not.toBeInTheDocument();
    expect(screen.getByText('a')).toBeInTheDocument();
    expect(screen.getByText('c')).toBeInTheDocument();
  });

  it('Backspace on empty input removes the last chip', () => {
    render(<Wrapper initial={['a', 'b']} />);
    const input = screen.getByPlaceholderText('Add tag…');
    fireEvent.keyDown(input, { key: 'Backspace' });
    expect(screen.queryByText('b')).not.toBeInTheDocument();
    expect(screen.getByText('a')).toBeInTheDocument();
  });

  it('does not commit duplicate values when unique is true', () => {
    render(<Wrapper initial={['apples']} />);
    const input = screen.getByPlaceholderText('Add tag…');
    fireEvent.change(input, { target: { value: 'apples' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getAllByText('apples')).toHaveLength(1);
  });

  it('allows duplicates when unique is false', () => {
    render(<Wrapper initial={['apples']} unique={false} />);
    const input = screen.getByPlaceholderText('Add tag…');
    fireEvent.change(input, { target: { value: 'apples' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getAllByText('apples')).toHaveLength(2);
  });

  it('trims whitespace before committing', () => {
    render(<Wrapper />);
    const input = screen.getByPlaceholderText('Add tag…') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '   apples   ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByText('apples')).toBeInTheDocument();
  });

  it('does not commit empty / whitespace-only entries', () => {
    const onChange = vi.fn();
    render(<TagInput value={[]} onChange={onChange} placeholder="Add tag…" />);
    const input = screen.getByPlaceholderText('Add tag…');
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('omits the X remove button when disabled', () => {
    render(<Wrapper initial={['a']} disabled />);
    expect(screen.queryByLabelText('Remove a')).not.toBeInTheDocument();
  });
});

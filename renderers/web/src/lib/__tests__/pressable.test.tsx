import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { pressableProps, rowActivationProps } from '../../core';

function Surface({ onPress, disabled, label = 'Open' }: { onPress?: (e: React.MouseEvent<HTMLElement>) => void; disabled?: boolean; label?: string }) {
  const press = pressableProps(onPress, { disabled });
  return <div {...press} aria-label={label}>{label}</div>;
}

describe('pressableProps', () => {
  it('makes a surface a focusable button', () => {
    render(<Surface onPress={vi.fn()} />);
    const el = screen.getByRole('button', { name: 'Open' });
    expect(el.getAttribute('tabindex')).toBe('0');
  });

  it.each(['Enter', ' '])('activates on %j', (key) => {
    const onPress = vi.fn();
    render(<Surface onPress={onPress} />);
    fireEvent.keyDown(screen.getByRole('button'), { key });
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(onPress.mock.calls[0][0].type).toBe('click');
  });

  it('activates on click', () => {
    const onPress = vi.fn();
    render(<Surface onPress={onPress} />);
    fireEvent.click(screen.getByRole('button'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('control: other keys do nothing', () => {
    const onPress = vi.fn();
    render(<Surface onPress={onPress} />);
    fireEvent.keyDown(screen.getByRole('button'), { key: 'a' });
    expect(onPress).not.toHaveBeenCalled();
  });

  it('control: a key press from a nested control is left to that control', () => {
    const onPress = vi.fn();
    function Nested() {
      const press = pressableProps(onPress);
      return <div {...press}><input aria-label="inner" /></div>;
    }
    render(<Nested />);
    fireEvent.keyDown(screen.getByLabelText('inner'), { key: ' ' });
    expect(onPress).not.toHaveBeenCalled();
  });

  it('disabled: announced, out of the tab order, inert', () => {
    const onPress = vi.fn();
    render(<Surface onPress={onPress} disabled />);
    const el = screen.getByRole('button');
    expect(el.getAttribute('aria-disabled')).toBe('true');
    expect(el.getAttribute('tabindex')).toBe('-1');
    fireEvent.click(el);
    fireEvent.keyDown(el, { key: 'Enter' });
    expect(onPress).not.toHaveBeenCalled();
  });

  it('control: without a handler it adds nothing', () => {
    render(<Surface />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('rowActivationProps', () => {
  function Row({ onActivate }: { onActivate?: (e: React.MouseEvent<HTMLElement>) => void }) {
    return (
      <div role="table">
        <div role="row" aria-label="Row" {...rowActivationProps(onActivate)}>
          <div role="cell"><input aria-label="cell input" /></div>
        </div>
      </div>
    );
  }

  it('keeps the row role, adds a tab stop, Enter activates with a click', () => {
    const onActivate = vi.fn();
    render(<Row onActivate={onActivate} />);
    const row = screen.getByRole('row');
    expect(row.getAttribute('tabindex')).toBe('0');
    fireEvent.keyDown(row, { key: 'Enter' });
    expect(onActivate).toHaveBeenCalledTimes(1);
    expect(onActivate.mock.calls[0][0].type).toBe('click');
  });

  it('control: Enter inside a cell control is left to the control', () => {
    const onActivate = vi.fn();
    render(<Row onActivate={onActivate} />);
    fireEvent.keyDown(screen.getByLabelText('cell input'), { key: 'Enter' });
    expect(onActivate).not.toHaveBeenCalled();
  });

  it('control: no handler, no tab stop', () => {
    render(<Row />);
    expect(screen.getByRole('row').getAttribute('tabindex')).toBeNull();
  });
});

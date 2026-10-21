// @vitest-environment jsdom
/**
 * A draggable's attributes spread straight onto a core `Box`: their `role` is
 * a declared ARIA role (dnd-kit types it as any string), so the spread
 * type-checks against `A11yProps` and the tile is still announced as a button.
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DndContext } from '@dnd-kit/core';
import type { AriaRole } from '@almadar/core';
import { useCanvasDraggable } from '../useCanvasDnd';
import { Box } from '../../core';

function Tile({ onRole }: { onRole: (role: AriaRole | undefined) => void }): React.ReactElement {
  const { setNodeRef, attributes, listeners, style } = useCanvasDraggable({ id: 'tile-a', payload: { kind: 'pattern', data: { type: 'button' } } });
  onRole(attributes.role);
  return <Box ref={setNodeRef} {...attributes} {...listeners} style={style} data-testid="tile">tile</Box>;
}

describe('useCanvasDraggable attributes', () => {
  it('carry an ARIA role the Box accepts, rendered as a button', () => {
    let role: AriaRole | undefined;
    render(<DndContext><Tile onRole={(r) => { role = r; }} /></DndContext>);
    expect(role).toBe('button');
    expect(screen.getByTestId('tile').getAttribute('role')).toBe('button');
  });
});

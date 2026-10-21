import { describe, it, expect } from 'vitest';
import { DIAGRAM_TONES } from '@almadar/core';
import * as AlgorithmCanvasModule from '../AlgorithmCanvas';

const LITERAL = /#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(|\bvar\(|color-mix\(/i;

const COLOR_EXPORT_NAMES = [
  'DEFAULT_BAR_COLOR',
  'DEFAULT_CELL_COLOR',
  'DEFAULT_POINTER_COLOR',
  'RANGE_COLOR_DEFAULT',
  'SLOT_EMPTY_FILL',
  'SLOT_EMPTY_STROKE',
  'SLOT_FILLED_STROKE',
  'SLOT_HIGHLIGHT_DEFAULT',
  'SLOT_VALUE_TEXT_COLOR',
  'FRAME_ACTIVE_COLOR',
  'FRAME_RETURNING_COLOR',
  'FRAME_DONE_COLOR',
  'FRAME_LABEL_COLOR',
  'FRAME_DETAIL_COLOR',
  'BUCKET_INDEX_FILL',
  'BUCKET_INDEX_STROKE',
  'BUCKET_INDEX_TEXT',
  'BUCKET_ENTRY_TEXT',
  'BUCKET_ENTRY_DEFAULT',
  'BUCKET_ENTRY_HIGHLIGHT',
  'BUCKET_ENTRY_PROBING',
  'AXIS_LABEL_COLOR',
  'CORNER_TEXT_COLOR',
] as const;

describe('AlgorithmCanvas color constants are role tones, never a literal', () => {
  it.each(COLOR_EXPORT_NAMES)('%s is a DiagramTone name', (name) => {
    const value = AlgorithmCanvasModule[name];
    expect(DIAGRAM_TONES, `${name}: ${value}`).toContain(value);
    expect(value).not.toMatch(LITERAL);
  });

  it('control: the literal matcher catches a hex, var() and color-mix()', () => {
    for (const bad of ['#3b82f6', 'var(--color-primary)', 'color-mix(in srgb, red 20%, blue)']) expect(bad).toMatch(LITERAL);
  });

  it('state semantics: bars default to a series tone, pointers to highlight, done frames to muted', () => {
    expect(AlgorithmCanvasModule.DEFAULT_BAR_COLOR).toBe('series-1');
    expect(AlgorithmCanvasModule.DEFAULT_POINTER_COLOR).toBe('highlight');
    expect(AlgorithmCanvasModule.FRAME_DONE_COLOR).toBe('muted');
  });
});

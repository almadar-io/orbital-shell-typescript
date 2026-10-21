import { describe, expect, it } from 'vitest';
import { decodeNodePlacements, decodePreviewNodeData, decodeSelectedPattern } from '../../src/lib/avl-prop-decoders';

const node = {
  orbitalName: 'Notes',
  traitName: 'NoteBrowse',
  patterns: [{ slot: 'main', pattern: { type: 'stack', children: [] } }],
  eventSources: [{ event: 'SAVE', patternType: 'button', path: '0', positionHint: 1 }],
  stateRole: 'initial',
};

describe('G-CROSS-131 typed prop decoders (ui)', () => {
  it('decodes a preview node, leaving absent optional fields undefined', () => {
    const decoded = decodePreviewNodeData(node);
    expect(decoded.orbitalName).toBe('Notes');
    expect(decoded.patterns[0].slot).toBe('main');
    expect(decoded.eventSources[0].event).toBe('SAVE');
    expect(decoded.stateRole).toBe('initial');
    expect(decoded.guard).toBeUndefined();
  });

  it('control: rejects a node without its required fields or with an unknown role', () => {
    expect(() => decodePreviewNodeData({ traitName: 'X', patterns: [], eventSources: [] })).toThrow(/orbitalName/);
    expect(() => decodePreviewNodeData({ ...node, stateRole: 'boss' })).toThrow(/stateRole/);
    expect(() => decodePreviewNodeData([node])).toThrow(/object/);
  });

  it('decodes a selected pattern with its node, rect and focus', () => {
    const decoded = decodeSelectedPattern({
      patternType: 'button',
      nodeData: node,
      rect: { top: 1, left: 2, width: 3, height: 4 },
      focus: { level: 'node', orbital: 'Notes', label: 'Save button' },
    });
    expect(decoded.nodeData.orbitalName).toBe('Notes');
    expect(decoded.rect).toEqual({ top: 1, left: 2, width: 3, height: 4 });
    expect(decoded.focus?.level).toBe('node');
  });

  it('control: rejects a focus with an unknown level', () => {
    expect(() => decodeSelectedPattern({ patternType: 'button', nodeData: node, focus: { level: 'galaxy', orbital: 'N', label: 'x' } })).toThrow(/level/);
  });

  it('decodes node placements and rejects a non-numeric coordinate', () => {
    expect(decodeNodePlacements({ a: { x: 1, y: 2 }, b: { x: 3, y: 4, width: 200 } })).toEqual({ a: { x: 1, y: 2, width: undefined }, b: { x: 3, y: 4, width: 200 } });
    expect(() => decodeNodePlacements({ a: { x: '1', y: 2 } })).toThrow(/x/);
  });
});

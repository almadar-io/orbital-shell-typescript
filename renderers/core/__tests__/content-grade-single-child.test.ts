/**
 * A composite whose `children` is one child node, not an array, is a content
 * body: `{ type: container, children: { type: stack, … } }` is how a lesson
 * page paints its whole view. Twin of the compiled path's
 * `sync::content::is_content_body_pattern`.
 */
import { describe, it, expect } from 'vitest';
import { isContentBodyPattern, type RenderUiPayload } from '../src/patterns/content-grade.js';

describe('isContentBodyPattern', () => {
  it('counts a single child object as content', () => {
    const payload: RenderUiPayload = { type: 'container', children: { type: 'stack', children: [] } };
    expect(isContentBodyPattern(payload)).toBe(true);
  });

  it('control: an empty children array is not content', () => {
    const payload: RenderUiPayload = { type: 'container', children: [] };
    expect(isContentBodyPattern(payload)).toBe(false);
  });
});

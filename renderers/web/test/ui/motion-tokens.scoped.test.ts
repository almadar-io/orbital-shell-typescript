/**
 * Motion timing is read where the animation plays: a subtree that sets its own
 * tokens (a demo frame in presentation motion) times its animations by them, and
 * the rest of the page keeps the root's.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { motionTiming } from '../../src/core';

let frame: HTMLElement;
beforeEach(() => {
  document.documentElement.style.setProperty('--duration-slow', '400ms');
  document.documentElement.style.setProperty('--easing-emphasized', 'cubic-bezier(0.2, 0, 0, 1)');
  frame = document.createElement('div');
  document.body.appendChild(frame);
});
afterEach(() => frame.remove());

describe('motionTiming reads the tokens in scope', () => {
  it('a subtree that sets its own tokens is timed by them', () => {
    frame.style.setProperty('--duration-slow', '600ms');
    frame.style.setProperty('--easing-emphasized', 'cubic-bezier(0.4, 0, 0.2, 1)');
    const inner = document.createElement('span');
    frame.appendChild(inner);
    expect(motionTiming('--duration-slow', '--easing-emphasized', inner)).toEqual({ duration: 600, easing: 'cubic-bezier(0.4, 0, 0.2, 1)' });
  });

  it('control: without an element the root\'s tokens apply', () => {
    frame.style.setProperty('--duration-slow', '600ms');
    expect(motionTiming('--duration-slow', '--easing-emphasized')).toEqual({ duration: 400, easing: 'cubic-bezier(0.2, 0, 0, 1)' });
  });
});

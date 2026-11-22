import { describe, it, expect, beforeEach } from 'vitest';
import { getOrCreatePortalRoot, PRERENDERED_MARK } from '../portalRoot';

describe('getOrCreatePortalRoot adopts a prerendered portal root', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('clears the children of a root the prerender marked and drops the mark', () => {
    document.body.innerHTML = `<div id="ui-slot-portal-root" ${PRERENDERED_MARK}=""><div id="slot-center">static</div></div>`;
    const root = getOrCreatePortalRoot();
    expect(root.children).toHaveLength(0);
    expect(root.hasAttribute(PRERENDERED_MARK)).toBe(false);
  });

  it('control: an unmarked existing root keeps its children', () => {
    document.body.innerHTML = '<div id="ui-slot-portal-root"><div id="slot-center">live</div></div>';
    const root = getOrCreatePortalRoot();
    expect(root.children).toHaveLength(1);
  });

  it('clears only once: what mounts after adoption stays', () => {
    document.body.innerHTML = `<div id="ui-slot-portal-root" ${PRERENDERED_MARK}=""><div>static</div></div>`;
    const root = getOrCreatePortalRoot();
    root.appendChild(document.createElement('div'));
    expect(getOrCreatePortalRoot().children).toHaveLength(1);
  });

  it('creates a fresh root when none exists', () => {
    const root = getOrCreatePortalRoot();
    expect(root.id).toBe('ui-slot-portal-root');
    expect(root.parentElement).toBe(document.body);
  });
});

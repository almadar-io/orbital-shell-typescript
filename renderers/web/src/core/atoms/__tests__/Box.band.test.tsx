import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { Box } from '../../index';

describe('Box band props', () => {
  it('renders no band layers by default', () => {
    const { container } = render(<Box>content</Box>);
    expect(container.querySelector('[data-band-layer]')).toBeNull();
    expect(container.firstElementChild?.className.split(' ')).not.toContain('band');
  });

  it('adds a hidden bottom edge layer and the band class', () => {
    const { container } = render(<Box paddingY="xl" edgeBottom="curve">content</Box>);
    const root = container.firstElementChild as HTMLElement;
    const edge = container.querySelector('.band-edge-bottom');
    expect(root.className.split(' ')).toContain('band');
    expect(edge).not.toBeNull();
    expect(edge?.getAttribute('aria-hidden')).toBe('true');
    expect(container.querySelector('.band-edge-top')).toBeNull();
  });

  it('adds a top edge layer only for edgeTop', () => {
    const { container } = render(<Box edgeTop="wave">content</Box>);
    expect(container.querySelector('.band-edge-top')).not.toBeNull();
    expect(container.querySelector('.band-edge-bottom')).toBeNull();
  });

  it('puts the backdrop first and the content last', () => {
    const { container } = render(<Box backdrop={<span>scene</span>}>content</Box>);
    const root = container.firstElementChild as HTMLElement;
    expect(root.querySelector('.band-backdrop')?.textContent).toBe('scene');
    expect(root.firstElementChild?.className).toContain('band-backdrop');
    expect(root.lastChild?.textContent).toBe('content');
  });

  it('adds the texture layer only when asked', () => {
    expect(render(<Box texture>x</Box>).container.querySelector('.band-texture')).not.toBeNull();
    expect(render(<Box>x</Box>).container.querySelector('.band-texture')).toBeNull();
  });

  it('maps the new backgrounds to band classes', () => {
    const a = render(<Box bg="gradient">x</Box>).container.firstElementChild as HTMLElement;
    const b = render(<Box bg="inverse">x</Box>).container.firstElementChild as HTMLElement;
    expect(a.className).toContain('band-gradient');
    expect(b.className).toContain('band-inverse');
  });

  it('leaves padding to the className when the band declares no padding prop', () => {
    const root = render(<Box className="py-16 md:py-24" edgeBottom="curve">x</Box>).container.firstElementChild as HTMLElement;
    expect(root.style.paddingBottom).toBe('');
    expect(root.querySelector('.band-edge-bottom')).not.toBeNull();
  });

  it('control: a band with paddingY grows its padding by the edge', () => {
    const root = render(<Box paddingY="xl" edgeBottom="wave">x</Box>).container.firstElementChild as HTMLElement;
    expect(root.getAttribute('style') ?? '').toContain('padding-bottom');
  });

  it('keeps a plain box unchanged when maxWidth is set', () => {
    const root = render(<Box maxWidth="40rem">x</Box>).container.firstElementChild as HTMLElement;
    expect(root.style.maxWidth).toBe('40rem');
    expect(root.style.paddingBottom).toBe('');
  });
});

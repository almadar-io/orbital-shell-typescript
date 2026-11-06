// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { Camera } from 'lucide-react';
import { EmptyState } from '../../src/components/core/molecules/EmptyState';
import { Chart } from '../../src/components/core/molecules/Chart';
import { MapView } from '../../src/components/core/molecules/MapView';

const centers: unknown[] = [];

vi.mock('react-leaflet', () => {
  const Nothing = () => null;
  return {
    MapContainer: ({ center }: { center: unknown }) => {
      centers.push(center);
      return <div data-testid="leaflet" />;
    },
    TileLayer: Nothing,
    Marker: Nothing,
    Polyline: Nothing,
    Popup: Nothing,
    useMap: () => ({ setView: () => undefined, on: () => undefined, off: () => undefined }),
  };
});
vi.mock('leaflet/dist/leaflet.css', () => ({}));

afterEach(() => {
  cleanup();
  centers.length = 0;
});

describe('EmptyState icon forms', () => {
  it('renders an icon passed as a forwardRef component object', () => {
    expect(typeof Camera).toBe('object');
    const { container } = render(<EmptyState icon={Camera} title="None" />);
    expect(container.querySelector('svg')).not.toBeNull();
  });

  it('control: no icon renders no svg', () => {
    const { container } = render(<EmptyState title="None" />);
    expect(container.querySelector('svg')).toBeNull();
  });
});

describe('MapView centre', () => {
  it('null centre falls back to the declared default instead of crashing', async () => {
    render(<MapView centerLat={null} centerLng={null} />);
    await waitFor(() => expect(screen.getByTestId('leaflet')).toBeTruthy());
    expect(centers[0]).toEqual([51.505, -0.09]);
  });

  it('control: a given centre is used as is', async () => {
    render(<MapView centerLat={10} centerLng={20} />);
    await waitFor(() => expect(screen.getByTestId('leaflet')).toBeTruthy());
    expect(centers[0]).toEqual([10, 20]);
  });
});

describe('Chart scatter colour', () => {
  const fills = (color: string | undefined) => {
    const { container } = render(
      <Chart chartType="scatter" scatterData={[{ x: 1, y: 2, color }, { x: 2, y: 3 }]} />,
    );
    return [...container.querySelectorAll('circle')].map((c) => c.getAttribute('fill'));
  };

  it('an empty colour falls back to the palette', () => {
    expect(fills('')).toEqual(['var(--color-primary)', 'var(--color-success)']);
  });

  it('control: a given colour is kept', () => {
    expect(fills('red')[0]).toBe('red');
  });
});

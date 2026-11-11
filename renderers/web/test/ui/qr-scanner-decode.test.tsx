// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import type { EventPayload } from '@almadar/core';
import { QrScanner } from '../../src/components/core/molecules/QrScanner';
import { EventBusProvider, useEventBus } from '../../src/core';

type Detected = { rawValue: string; format: string };

function mount(frames: Detected[][] | null) {
  const scans: EventPayload[] = [];
  const errors: Error[] = [];
  function Grabber() {
    const bus = useEventBus();
    React.useEffect(() => bus.on('UI:SCANNED', (e) => { scans.push(e.payload ?? {}); }), [bus]);
    return null;
  }
  const stop = vi.fn();
  Object.defineProperty(globalThis.navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop }] })) },
  });
  HTMLMediaElement.prototype.play = vi.fn(async () => {});
  let frame = 0;
  if (frames) {
    vi.stubGlobal('BarcodeDetector', class {
      async detect() {
        const found = frames[Math.min(frame, frames.length - 1)];
        frame += 1;
        return found;
      }
    });
  }
  render(
    <EventBusProvider debug={false}>
      <Grabber />
      <QrScanner scanEvent="SCANNED" onError={(e) => errors.push(e)} />
    </EventBusProvider>,
  );
  const tick = async () => { await act(async () => { await vi.advanceTimersByTimeAsync(200); }); };
  return { scans, errors, tick };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('QrScanner decodes what the camera sees (G-ORBITAL-SHELL-TYPESCRIPT-042)', () => {
  it('a code in the frame fires the scan event once with its text and format', async () => {
    vi.useFakeTimers();
    const { scans, tick } = mount([[{ rawValue: 'https://almadar.io/t/1', format: 'qr_code' }]]);
    await tick();
    await tick();
    await tick();
    expect(scans.length).toBe(1);
    expect(scans[0].text).toBe('https://almadar.io/t/1');
    expect(scans[0].format).toBe('QR_CODE');
    expect(typeof scans[0].timestamp).toBe('number');
  });

  it('a second code, or the same code shown again after it left the frame, fires again', async () => {
    vi.useFakeTimers();
    const a = [{ rawValue: 'a', format: 'qr_code' }];
    const b = [{ rawValue: 'b', format: 'qr_code' }];
    const { scans, tick } = mount([a, a, b, [], a]);
    for (let i = 0; i < 6; i += 1) await tick();
    expect(scans.map((s) => s.text)).toEqual(['a', 'b', 'a']);
  });

  it('control: an empty frame fires nothing', async () => {
    vi.useFakeTimers();
    const { scans, errors, tick } = mount([[]]);
    await tick();
    await tick();
    expect(scans).toEqual([]);
    expect(errors).toEqual([]);
  });

  it('a browser with no barcode detector reports it once instead of scanning nothing in silence', async () => {
    vi.useFakeTimers();
    const { scans, errors, tick } = mount(null);
    await tick();
    await tick();
    expect(scans).toEqual([]);
    expect(errors.length).toBe(1);
  });
});

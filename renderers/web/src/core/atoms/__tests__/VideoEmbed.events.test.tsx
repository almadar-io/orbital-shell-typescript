import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import type { EventPayload } from '@almadar/core';
import { VideoEmbed } from '../../index';
import { EventBusProvider } from '../../index';
import { useEventBus } from '../../index';

interface PlayerOptions {
  videoId: string;
  playerVars: { autoplay: number; controls: number; start: number; rel: number };
  events: { onReady: () => void; onError: (event: { data: number }) => void; onStateChange: (event: { data: number }) => void };
}

const created: PlayerOptions[] = [];
let destroyed = 0;

class FakePlayer {
  constructor(_host: HTMLElement, options: PlayerOptions) {
    created.push(options);
  }
  destroy(): void {
    destroyed += 1;
  }
}

function Recorder({ into }: { into: { name: string; payload: EventPayload }[] }): null {
  const { on } = useEventBus();
  React.useEffect(() => {
    const offs = ['UI:READY', 'UI:FAILED', 'UI:STARTED'].map((name) => on(name, (e) => { into.push({ name, payload: e.payload ?? {} }); }));
    return () => offs.forEach((off) => off());
  }, [on, into]);
  return null;
}

function mount(node: React.ReactNode, seen: { name: string; payload: EventPayload }[]) {
  return render(<EventBusProvider debug={false}><Recorder into={seen} />{node}</EventBusProvider>);
}

afterEach(() => {
  cleanup();
  created.length = 0;
  destroyed = 0;
  delete window.YT;
});

describe('VideoEmbed (YouTube id)', () => {
  it('builds the player with the declared knobs and fires readyEvent when the player reports ready', async () => {
    window.YT = { Player: FakePlayer };
    const seen: { name: string; payload: EventPayload }[] = [];
    mount(<VideoEmbed videoId="dQw4w9WgXcQ" autoplay start={12} readyEvent="READY" errorEvent="FAILED" />, seen);
    await waitFor(() => expect(created).toHaveLength(1));
    expect(created[0].videoId).toBe('dQw4w9WgXcQ');
    expect(created[0].playerVars).toEqual({ autoplay: 1, controls: 1, start: 12, rel: 0 });
    expect(seen).toEqual([]);
    created[0].events.onReady();
    expect(seen).toEqual([{ name: 'UI:READY', payload: { source: 'dQw4w9WgXcQ' } }]);
  });

  it('fires errorEvent with the message and the player code when the player errors', async () => {
    window.YT = { Player: FakePlayer };
    const seen: { name: string; payload: EventPayload }[] = [];
    mount(<VideoEmbed videoId="gone" readyEvent="READY" errorEvent="FAILED" />, seen);
    await waitFor(() => expect(created).toHaveLength(1));
    created[0].events.onError({ data: 100 });
    expect(seen).toHaveLength(1);
    expect(seen[0].name).toBe('UI:FAILED');
    expect(seen[0].payload).toEqual({ error: 'The video was not found or is private', code: '100' });
  });

  it('fires playEvent each time the player begins playing, and only then', async () => {
    window.YT = { Player: FakePlayer };
    const seen: { name: string; payload: EventPayload }[] = [];
    mount(<VideoEmbed videoId="abc" playEvent="STARTED" />, seen);
    await waitFor(() => expect(created).toHaveLength(1));
    created[0].events.onStateChange({ data: 3 });
    created[0].events.onStateChange({ data: 2 });
    expect(seen).toEqual([]);
    created[0].events.onStateChange({ data: 1 });
    created[0].events.onStateChange({ data: 1 });
    expect(seen).toEqual([
      { name: 'UI:STARTED', payload: { source: 'abc' } },
      { name: 'UI:STARTED', payload: { source: 'abc' } },
    ]);
  });

  it('control: without declared events nothing is emitted', async () => {
    window.YT = { Player: FakePlayer };
    const seen: { name: string; payload: EventPayload }[] = [];
    mount(<VideoEmbed videoId="abc" />, seen);
    await waitFor(() => expect(created).toHaveLength(1));
    created[0].events.onReady();
    created[0].events.onError({ data: 2 });
    created[0].events.onStateChange({ data: 1 });
    expect(seen).toEqual([]);
  });

  it('destroys the player when it unmounts', async () => {
    window.YT = { Player: FakePlayer };
    const view = mount(<VideoEmbed videoId="abc" />, []);
    await waitFor(() => expect(created).toHaveLength(1));
    view.unmount();
    expect(destroyed).toBe(1);
  });
});

describe('VideoEmbed (plain URL)', () => {
  it('fires readyEvent when the page loads; a frame has no failure signal, so errorEvent stays silent', () => {
    const seen: { name: string; payload: EventPayload }[] = [];
    mount(<VideoEmbed src="https://player.example/embed/1" title="Lesson" readyEvent="READY" errorEvent="FAILED" />, seen);
    const frame = screen.getByTitle('Lesson');
    expect(frame.getAttribute('src')).toBe('https://player.example/embed/1');
    fireEvent.load(frame);
    expect(seen).toEqual([{ name: 'UI:READY', payload: { source: 'https://player.example/embed/1' } }]);
    fireEvent.error(frame);
    expect(seen).toHaveLength(1);
  });

  it('edge: no id and no src renders an empty frame and emits nothing', () => {
    const seen: { name: string; payload: EventPayload }[] = [];
    const view = mount(<VideoEmbed readyEvent="READY" />, seen);
    expect(view.container.querySelector('iframe')).toBeNull();
    expect(screen.getByText('No video selected')).toBeTruthy();
    expect(seen).toEqual([]);
  });
});

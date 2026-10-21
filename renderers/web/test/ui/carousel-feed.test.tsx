// @vitest-environment jsdom
/**
 * Carousel as a full-screen vertical feed (Rawi): vertical snap, keyboard paging per
 * orientation, and a load-more request a few cards before the end.
 */
import React from 'react';
import { act } from 'react';
import { afterEach, describe, it, expect } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { EventBusProvider } from '../../src/core';
import { useEventBus, type EventBusContextType } from '../../src/core';
import { Carousel, type CarouselProps } from '../../src/components/core/molecules/Carousel';

afterEach(() => cleanup());

const ITEMS = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];

function mount(props: Partial<CarouselProps>) {
  let bus!: EventBusContextType;
  function BusGrabber() {
    bus = useEventBus();
    return null;
  }
  const view = render(
    <EventBusProvider debug={false}>
      <BusGrabber />
      <Carousel items={ITEMS} renderItem={(item) => <span>{item.id}</span>} {...props} />
    </EventBusProvider>,
  );
  const heard: { type: string; index: number }[] = [];
  for (const type of ['UI:SLIDE', 'UI:MORE']) {
    bus.on(type, (event) => {
      const index = typeof event.payload?.index === 'number' ? event.payload.index : -1;
      heard.push({ type, index });
    });
  }
  const region = view.getByRole('region');
  return { view, region, heard };
}

describe('Carousel orientation', () => {
  it('vertical: a column track that snaps on the y axis', () => {
    const { region } = mount({ orientation: 'vertical' });
    const track = region.firstElementChild;
    if (!(track instanceof HTMLElement)) throw new Error('no track');
    expect(track.style.scrollSnapType).toBe('y mandatory');
    expect(track.style.flexDirection).toBe('column');
  });

  it('control: the default is a row that snaps on the x axis', () => {
    const { region } = mount({});
    const track = region.firstElementChild;
    if (!(track instanceof HTMLElement)) throw new Error('no track');
    expect(track.style.scrollSnapType).toBe('x mandatory');
    expect(track.style.flexDirection).toBe('row');
  });

  it('fullHeight: every slide fills the carousel height', () => {
    const { region } = mount({ orientation: 'vertical', fullHeight: true });
    const slides = Array.from(region.firstElementChild?.children ?? []);
    expect(slides).toHaveLength(4);
    expect(slides.every((s) => s instanceof HTMLElement && s.style.height === '100%')).toBe(true);
  });
});

describe('Carousel fullHeight in a page that scrolls', () => {
  it('vertical fullHeight bounds the feed to the viewport below its top edge', () => {
    const { region } = mount({ orientation: 'vertical', fullHeight: true });
    expect(region.style.height).toBe('calc(100svh - 0px)');
  });

  it('control: horizontal fullHeight keeps filling its parent', () => {
    const { region } = mount({ fullHeight: true });
    expect(region.style.height).toBe('');
  });
});

describe('Carousel keyboard paging', () => {
  it('vertical: ArrowDown and PageDown go to the next card, ArrowUp back', () => {
    const { region, heard } = mount({ orientation: 'vertical', slideChangeEvent: 'SLIDE' });
    act(() => {
      fireEvent.keyDown(region, { key: 'ArrowDown' });
    });
    act(() => {
      fireEvent.keyDown(region, { key: 'PageDown' });
    });
    act(() => {
      fireEvent.keyDown(region, { key: 'ArrowUp' });
    });
    expect(heard.filter((h) => h.type === 'UI:SLIDE').map((h) => h.index)).toEqual([1, 2, 1]);
  });

  it('control: horizontal ignores ArrowDown and pages with ArrowRight', () => {
    const { region, heard } = mount({ slideChangeEvent: 'SLIDE' });
    act(() => {
      fireEvent.keyDown(region, { key: 'ArrowDown' });
    });
    act(() => {
      fireEvent.keyDown(region, { key: 'ArrowRight' });
    });
    expect(heard.filter((h) => h.type === 'UI:SLIDE').map((h) => h.index)).toEqual([1]);
  });

  it('edge: paging past the last card stays on it without looping', () => {
    const { region, heard } = mount({ orientation: 'vertical', slideChangeEvent: 'SLIDE' });
    for (let i = 0; i < 6; i++) {
      act(() => {
        fireEvent.keyDown(region, { key: 'ArrowDown' });
      });
    }
    expect(heard.filter((h) => h.type === 'UI:SLIDE').map((h) => h.index).at(-1)).toBe(3);
  });
});

describe('Carousel native scroll', () => {
  function scrollTo(region: HTMLElement, top: number) {
    const track = region.firstElementChild;
    if (!(track instanceof HTMLElement)) throw new Error('no track');
    Object.defineProperty(track, 'offsetHeight', { configurable: true, value: 500 });
    track.scrollTop = top;
    act(() => {
      fireEvent.scroll(track);
    });
  }

  it('announces the card a snap-scroll settles on', () => {
    const { region, heard } = mount({ orientation: 'vertical', slideChangeEvent: 'SLIDE' });
    scrollTo(region, 500);
    expect(heard.filter((h) => h.type === 'UI:SLIDE').map((h) => h.index)).toEqual([1]);
  });

  it('control: a position between two cards announces nothing', () => {
    const { region, heard } = mount({ orientation: 'vertical', slideChangeEvent: 'SLIDE' });
    scrollTo(region, 250);
    expect(heard.filter((h) => h.type === 'UI:SLIDE')).toHaveLength(0);
  });

  it('control: the scroll that follows a keyboard page does not announce the card twice', () => {
    const { region, heard } = mount({ orientation: 'vertical', slideChangeEvent: 'SLIDE' });
    act(() => {
      fireEvent.keyDown(region, { key: 'ArrowDown' });
    });
    scrollTo(region, 500);
    expect(heard.filter((h) => h.type === 'UI:SLIDE').map((h) => h.index)).toEqual([1]);
  });
});

describe('Carousel load more', () => {
  it('asks once when the viewer is loadMoreAhead cards from the end', () => {
    const { region, heard } = mount({ orientation: 'vertical', loadMoreEvent: 'MORE', loadMoreAhead: 1, hasMore: true });
    act(() => {
      fireEvent.keyDown(region, { key: 'ArrowDown' });
    });
    expect(heard.filter((h) => h.type === 'UI:MORE')).toHaveLength(0);
    act(() => {
      fireEvent.keyDown(region, { key: 'ArrowDown' });
    });
    act(() => {
      fireEvent.keyDown(region, { key: 'ArrowDown' });
    });
    expect(heard.filter((h) => h.type === 'UI:MORE')).toHaveLength(1);
  });

  it('control: no request when there is no more, or one is already loading', () => {
    for (const props of [{ hasMore: false }, { hasMore: true, isLoadingMore: true }]) {
      const { region, heard } = mount({ orientation: 'vertical', loadMoreEvent: 'MORE', loadMoreAhead: 1, ...props });
      for (let i = 0; i < 3; i++) {
        act(() => {
          fireEvent.keyDown(region, { key: 'ArrowDown' });
        });
      }
      expect(heard.filter((h) => h.type === 'UI:MORE')).toHaveLength(0);
      cleanup();
    }
  });

  it('asks again once more cards arrived and the viewer nears the new end', () => {
    let bus!: EventBusContextType;
    function BusGrabber() {
      bus = useEventBus();
      return null;
    }
    const tree = (items: { id: string }[]) => (
      <EventBusProvider debug={false}>
        <BusGrabber />
        <Carousel items={items} orientation="vertical" loadMoreEvent="MORE" loadMoreAhead={1} hasMore renderItem={(item) => <span>{item.id}</span>} />
      </EventBusProvider>
    );
    const view = render(tree(ITEMS));
    let more = 0;
    bus.on('UI:MORE', () => {
      more += 1;
    });
    const region = view.getByRole('region');
    for (let i = 0; i < 3; i++) {
      act(() => {
        fireEvent.keyDown(region, { key: 'ArrowDown' });
      });
    }
    expect(more).toBe(1);
    view.rerender(tree([...ITEMS, { id: 'e' }, { id: 'f' }]));
    act(() => {
      fireEvent.keyDown(view.getByRole('region'), { key: 'ArrowDown' });
    });
    expect(more).toBe(2);
  });
});

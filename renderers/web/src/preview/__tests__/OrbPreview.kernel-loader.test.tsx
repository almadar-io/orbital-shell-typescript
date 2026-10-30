/**
 * A host hands `OrbPreview` the kernel loader, and the preview runs its circuits on the kernel (which installs the
 * render evaluator). With neither a loader nor a `KernelEngineProvider` above it, the preview refuses to run.
 */
import 'fake-indexeddb/auto';
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import type { OrbitalSchema } from '@almadar/core';
import { OrbPreview } from '../OrbPreview';
import { I18nProvider, createTranslate } from '../../core';
import { KernelLoaderMissingError } from '../../providers/KernelEngineContext';
import { clientProgram } from '../../test-support/lolo-program';
import { KERNEL_AVAILABLE, loadFreshClientKernel, loadTestKernel } from '../../test-support/kernel-engine';

// The provider's own contract: the shared setup's test kernel is not used here.
vi.unmock('../../providers/KernelEngineContext');

const greeterProgram = `app books [
  version: "1.0.0"
]

orbital Books {
  entity Invoice [runtime] {
    id : string!
  }

  trait Greeter -> Invoice {
    initial: idle

    state idle {
      INIT -> idle
        (render-ui main { type: "typography", content: "hello kernel" })
    }
  }

  page "/" as Home -> Greeter
}
`;

const schema = (name: string): OrbitalSchema => ({ ...clientProgram(greeterProgram), name });

const describeKernel = KERNEL_AVAILABLE ? describe : describe.skip;

describeKernel('OrbPreview — kernelLoader', () => {
  it('loads the kernel for the preview when the host supplies a loader', async () => {
    const loader = vi.fn(() => loadTestKernel());
    render(<OrbPreview schema={schema(`kernel-loader-${Math.random()}`)} isolated kernelLoader={loader} />);
    await waitFor(() => expect(loader).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('hello kernel')).toBeTruthy();
  }, 20_000);

  it('control: with no loader and no provider the preview refuses to run, naming the missing loader', () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => render(<OrbPreview schema={schema(`kernel-loader-${Math.random()}`)} isolated />)).toThrow(KernelLoaderMissingError);
    quiet.mockRestore();
  });
});

const boardProgram = `app board [
  version: "1.0.0"
]

orbital Board {
  entity Task [persistent: tasks, browser] {
    id : string!
    title : string = ""
    owner : Person
    instances [
      { id: "t-1", title: "Write the brief", owner: "p-1" }
    ]
  }

  entity Person [persistent: people, browser] {
    id : string!
    name : string = ""
    instances [
      { id: "p-1", name: "Maja" }
    ]
  }

  trait TaskGrid -> Task {
    initial: idle

    state idle {
      INIT -> idle
        (fetch Task { emit: { success: LOADED } })
      LOADED -> idle
        (render-ui main { type: "stack", children: [
          { type: "typography", content: "board ready" },
          { type: "data-grid", entity: @payload.data, fields: [{ name: "title" }, { name: "owner" }] }
        ] })
    }

    emits {
      LOADED -> internal {
        data : [Task]
      }
    }
  }

  page "/" as Home -> TaskGrid
}
`;

const board = (name: string): OrbitalSchema => ({ ...clientProgram(boardProgram), name });

describeKernel('OrbPreview — a kernel the loader installed the language into', () => {
  it('opens the kernel over browser-stored rows without installing the language again', async () => {
    const loader = vi.fn(loadFreshClientKernel);
    render(<OrbPreview schema={board(`language-loader-${Math.random()}`)} isolated kernelLoader={loader} />);
    expect(await screen.findByText('board ready', undefined, { timeout: 15_000 })).toBeTruthy();
    expect(loader).toHaveBeenCalledTimes(1);
  }, 20_000);
});

const greetingProgram = `app site [
  version: "1.0.0",
  locales: [en]
]

orbital Site {
  entity SiteView [runtime] {
    id : string!
  }

  trait Hero -> SiteView {
    initial: idle

    state idle {
      INIT -> idle
        (render-ui main { type: "typography", content: (i18n/t "hero.title") })
    }
  }

  page "/" as Home -> Hero
}
`;

const greeting = (name: string): OrbitalSchema => ({ ...clientProgram(greetingProgram, { 'locales/en/site.json': JSON.stringify({ 'hero.title': 'Hello' }) }), name });

describeKernel('OrbPreview — the client kernel paints i18n/t', () => {
  it('from the catalog of the viewer the host provides', async () => {
    const messages = { 'site:hero.title': 'Hello from the catalog' };
    render(
      <I18nProvider value={{ locale: 'en', direction: 'ltr', t: createTranslate(messages), messages }}>
        <OrbPreview schema={greeting(`i18n-${Math.random()}`)} isolated kernelLoader={loadFreshClientKernel} />
      </I18nProvider>,
    );
    expect(await screen.findByText('Hello from the catalog', undefined, { timeout: 15_000 })).toBeTruthy();
  }, 20_000);

  it('control: with no catalog the message paints empty, never the declared key or another locale', async () => {
    render(<OrbPreview schema={greeting(`i18n-${Math.random()}`)} isolated kernelLoader={loadFreshClientKernel} />);
    const main = await screen.findByTestId('ui-slot-main', undefined, { timeout: 15_000 });
    await waitFor(() => expect(main.getAttribute('data-slot-mode')).toBe('content'));
    expect(main.textContent).toBe('');
    expect(screen.queryByText('Hello from the catalog')).toBeNull();
  }, 20_000);
});

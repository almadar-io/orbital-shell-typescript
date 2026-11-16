/**
 * A browser-stored entity (`[persistent: x, browser]`) on the runtime path with no
 * server: the written-out rows load from IndexedDB, an added row is stored
 * there, and it is still there when the preview mounts again.
 */
import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import type { OrbitalSchema } from '@almadar/core';
import { OrbPreview } from '../OrbPreview';
import { I18nProvider, createTranslate } from '../../core';
import { clientProgram } from '../../test-support/lolo-program';

const books = `
app books [
  version: "1.0.0",
  locales: [en, ar]
]

orbital Books {
  entity Invoice [persistent: invoices, browser] {
    @create none "A test ledger: it signs no one in, so every visitor may add an invoice."
    @read none "A test ledger: it signs no one in, so every visitor reads every invoice."
    id : string!
    client : string = ""
    instances [
      { id: "INV-1042", client: "Noor Logistics" },
      { id: "INV-1043", client: "Bled Studio" }
    ]
    instances ar [
      { id: "INV-1042", client: "نور للخدمات اللوجستية" },
      { id: "INV-1043", client: "استوديو بليد" }
    ]
  }

  trait InvoiceList -> Invoice {
    initial: loading

    state loading {
      INIT -> loading
        (fetch Invoice { limit: 50, emit: { success: LOADED, failure: LOAD_FAILED } })
      LOAD_FAILED -> loading
        (render-ui main { type: "typography", variant: "body", content: "The invoices failed to load" })
      LOADED -> browsing
        (render-ui main { type: "stack", direction: "vertical", gap: "md", children: [
          { type: "button", label: "Add invoice", action: "ADD" },
          { type: "data-grid", entity: @payload.data, fields: [{ name: "client", label: "Client" }] }
        ] })
    }

    state browsing {
      INIT -> loading
        (fetch Invoice { limit: 50, emit: { success: LOADED, failure: LOAD_FAILED } })
      ADD -> browsing
        (persist create Invoice { client: "Kozolec d.o.o." } { emit: { success: ADDED, failure: ADD_FAILED } })
      ADD_FAILED -> browsing
        (render-ui main { type: "typography", variant: "body", content: "The invoice was not added" })
      ADDED -> loading
        (fetch Invoice { limit: 50, emit: { success: LOADED, failure: LOAD_FAILED } })
    }

    emits {
      LOADED -> internal {
        data : [Invoice]
      }
      ADDED -> internal {
        id : string
      }
      LOAD_FAILED -> internal {
        error : string
      }
      ADD_FAILED -> internal {
        error : string
      }
    }
  }

  page "/" as Home -> InvoiceList
}
`;

function schema(name: string): OrbitalSchema {
  return { ...clientProgram(books), name };
}

describe('OrbPreview — browser-stored entity, no server', () => {
  it('shows the written-out rows, stores an added row, and keeps it across a remount', async () => {
    const app = schema(`books-${Math.random()}`);
    const first = render(<OrbPreview schema={app} isolated />);
    expect(await screen.findByText('Noor Logistics')).toBeTruthy();
    fireEvent.click(await screen.findByRole('button', { name: 'Add invoice' }));
    expect(await screen.findByText('Kozolec d.o.o.')).toBeTruthy();
    first.unmount();

    render(<OrbPreview schema={app} isolated />);
    expect(await screen.findByText('Kozolec d.o.o.')).toBeTruthy();
    expect(screen.getByText('Bled Studio')).toBeTruthy();
  }, 20_000);

  it('an Arabic viewer gets the Arabic rows, in its own store', async () => {
    const app = schema(`books-${Math.random()}`);
    render(
      <I18nProvider value={{ locale: 'ar', direction: 'rtl', t: createTranslate({}) }}>
        <OrbPreview schema={app} isolated />
      </I18nProvider>,
    );
    expect(await screen.findByText('نور للخدمات اللوجستية')).toBeTruthy();
    expect(screen.queryByText('Noor Logistics')).toBeNull();
  });
});

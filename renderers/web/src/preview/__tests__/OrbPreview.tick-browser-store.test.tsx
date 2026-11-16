/**
 * A client tick whose effects write a browser-stored entity (drift D-1): the tick's `persist` goes
 * to the browser store as a `runTick` leg instead of being dropped, so the row it writes is there
 * for the next fetch.
 */
import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import type { OrbitalSchema } from '@almadar/core';
import { OrbPreview } from '../OrbPreview';
import { clientProgram } from '../../test-support/lolo-program';

const program = (tick: string, failure: { arm: string; emit: string }) => `app ticks [
  version: "1.0.0"
]

orbital Books {
  entity Invoice [persistent: invoices, browser] {
    @create none "A test ledger: it signs no one in, so every visitor may add an invoice."
    @read none "A test ledger: it signs no one in, so every visitor reads every invoice."
    @update none "A test ledger: it signs no one in, so every visitor may change an invoice."
    id : string!
    client : string = ""
    instances [
      { id: "INV-1042", client: "Noor Logistics" }
    ]
  }

  entity Beat [runtime] {
    id : string!
  }

  trait InvoiceList -> Invoice {
    initial: loading

    state loading {
      INIT -> loading
        (fetch Invoice { limit: 50, emit: { success: LOADED, failure: LOAD_FAILED } })
      LOAD_FAILED -> loading
        (render-ui main { type: "typography", variant: "body", content: "The invoices failed to load" })
      LOADED -> browsing
        (render-ui main { type: "data-grid", entity: @payload.data, fields: [{ name: "client", label: "Client" }] })
    }

    state browsing {
      INIT -> loading
        (fetch Invoice { limit: 50, emit: { success: LOADED, failure: LOAD_FAILED } })
      RELOAD -> loading
        (fetch Invoice { limit: 50, emit: { success: LOADED, failure: LOAD_FAILED } })
    }

    listens {
      RELOAD {
        id : string
      }
      Autosave.ADDED -> RELOAD
    }

    emits {
      LOADED -> internal {
        data : [Invoice]
      }
      LOAD_FAILED -> internal {
        error : string
      }
    }
  }

  trait Autosave -> Beat [client] {
    initial: running

    state running {
      INIT -> running
${failure.arm}    }

${tick}    emits {
      ADDED -> external {
        id : string
      }
${failure.emit}    }
  }

  page "/" as Home -> InvoiceList, Autosave
}
`;

const writes = `    ticks {
      autosave every 40ms
        (persist upsert Invoice { id: "INV-TICK", client: "Ticked Co" } { emit: { success: ADDED, failure: SAVE_FAILED } })
    }

`;
const saveFailed = {
  arm: `      SAVE_FAILED -> running
        (render-ui main { type: "typography", variant: "body", content: "Autosave failed" })
`,
  emit: `      SAVE_FAILED -> internal {
        error : string
      }
`,
};
const noFailure = { arm: '', emit: '' };

const writesNothing = `    ticks {
      autosave every 40ms
        (emit ADDED { id: "none" })
    }

`;

function schema(name: string, tick: string, failure: { arm: string; emit: string }): OrbitalSchema {
  return { ...clientProgram(program(tick, failure)), name };
}

describe('OrbPreview — a tick writing a browser-stored entity', () => {
  it('stores the row the tick writes, and the refetch shows it', async () => {
    render(<OrbPreview schema={schema(`tick-books-${Math.random()}`, writes, saveFailed)} isolated />);
    expect(await screen.findByText('Noor Logistics')).toBeTruthy();
    expect(await screen.findByText('Ticked Co', {}, { timeout: 15_000 })).toBeTruthy();
  }, 30_000);

  it('control: a tick that writes no row leaves the list as it was', async () => {
    render(<OrbPreview schema={schema(`tick-books-${Math.random()}`, writesNothing, noFailure)} isolated />);
    expect(await screen.findByText('Noor Logistics')).toBeTruthy();
    await new Promise((r) => setTimeout(r, 300));
    expect(screen.queryByText('Ticked Co')).toBeNull();
  }, 30_000);
});

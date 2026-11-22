/**
 * A browser-stored list reloaded by a sibling form's save through a listens route (the Orb docs notes example,
 * G-CROSS-789): the delivered RELOAD's fetch answers, so the list returns to ready with the saved row.
 */
import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { OrbitalSchema } from '@almadar/core';
import { OrbPreview } from '../OrbPreview';
import { clientProgram } from '../../test-support/lolo-program';

const notes = `
app notes [
  version: "1.0.0"
]

orbital NotesOrbital {
  entity Note [persistent: notes, browser] {
    @create none "A test list: it signs no one in, so every visitor may add a note."
    @read none "A test list: it signs no one in, so every visitor reads every note."
    id : string!
    title : string!
    instances [
      { id: "N-1", title: "First note" }
    ]
  }

  trait NoteList -> Note [client] {
    initial: loading

    state loading {
      INIT -> loading
        (fetch Note { limit: 100, emit: { success: NotesLoaded, failure: NotesFailed } })
      NotesLoaded -> ready
        (render-ui main { type: data-list, entity: ?data, fields: [{ name: "title", label: "Title", variant: h4 }] })
      NotesFailed -> ready
        (render-ui main { type: alert, variant: error, message: ?error })
    }

    state ready {
      INIT -> loading
        (fetch Note { limit: 100, emit: { success: NotesLoaded, failure: NotesFailed } })
      RELOAD -> loading
        (fetch Note { limit: 100, emit: { success: NotesLoaded, failure: NotesFailed } })
    }

    emits {
      NotesLoaded {
        data : [Note]!
      }
      NotesFailed {
        error : string
      }
    }

    listens {
      NoteForm.NOTE_SAVED -> RELOAD
    }
  }

  trait NoteForm -> Note [client] {
    initial: editing

    state editing {
      INIT -> editing
        (render-ui main { type: form-section, fields: [{ name: "title", label: "title" }], submitEvent: SAVE, mode: create, entity: {} })
      SAVE -> editing
        (persist create Note ?data { emit: { failure: NoteSaveFailed } })
        (emit NOTE_SAVED)
        (render-ui main { type: form-section, fields: [{ name: "title", label: "title" }], submitEvent: SAVE, mode: create, entity: {} })
      NoteSaveFailed -> editing
        (notify error (default ?error ""))
    }

    emits {
      NOTE_SAVED
      NoteSaveFailed {
        error : string
      }
    }

    listens {
      SAVE {
        data : @entity!
      }
    }
  }

  trait NotesStage -> Note [client] {
    initial: idle

    state idle {
      INIT -> idle
        (render-ui main { type: stack, direction: vertical, gap: lg, children: [@trait.NoteList, @trait.NoteForm] })
    }
  }

  page "/notes" as Notes -> NotesStage
}
`;

const SAVE_REPAINT = '        (render-ui main { type: form-section, fields: [{ name: "title", label: "title" }], submitEvent: SAVE, mode: create, entity: {} })\n      NoteSaveFailed';

function schema(name: string, saveRepaintsForm = true): OrbitalSchema {
  const source = saveRepaintsForm ? notes : notes.replace(SAVE_REPAINT, '      NoteSaveFailed');
  if (!saveRepaintsForm && source === notes) throw new Error('the SAVE arm no longer repaints the form as written here');
  return { ...clientProgram(source), name };
}

describe('OrbPreview — a sibling save reloads a browser-stored list', () => {
  it('shows the saved note in the list without a remount', async () => {
    render(<OrbPreview schema={schema(`notes-${Math.random()}`)} isolated />);
    expect(await screen.findByText('First note')).toBeTruthy();
    fireEvent.change(await screen.findByLabelText(/title/), { target: { value: 'Second note' } });
    fireEvent.click(await screen.findByRole('button', { name: /save/i }));
    expect(await screen.findByText('Second note', {}, { timeout: 8000 })).toBeTruthy();
  }, 20_000);

  it('each save leaves the form empty, the second as well as the first', async () => {
    render(<OrbPreview schema={schema(`notes-${Math.random()}`)} isolated />);
    expect(await screen.findByText('First note')).toBeTruthy();
    for (const title of ['Second note', 'Third note']) {
      const field = await screen.findByLabelText<HTMLInputElement>(/title/);
      fireEvent.change(field, { target: { value: title } });
      fireEvent.click(await screen.findByRole('button', { name: /save/i }));
      expect(await screen.findByText(title, {}, { timeout: 8000 })).toBeTruthy();
      await waitFor(() => expect(screen.getByLabelText<HTMLInputElement>(/title/).value).toBe(''));
    }
  }, 30_000);

  it('control: a SAVE arm that does not repaint the form keeps what the viewer typed', async () => {
    render(<OrbPreview schema={schema(`notes-${Math.random()}`, false)} isolated />);
    expect(await screen.findByText('First note')).toBeTruthy();
    fireEvent.change(await screen.findByLabelText<HTMLInputElement>(/title/), { target: { value: 'Kept note' } });
    fireEvent.click(await screen.findByRole('button', { name: /save/i }));
    expect(await screen.findByText('Kept note', { selector: 'h4, h4 *' }, { timeout: 8000 })).toBeTruthy();
    expect(screen.getByLabelText<HTMLInputElement>(/title/).value).toBe('Kept note');
  }, 20_000);

  it('control: a typed title the viewer has not saved stays while the page re-renders', async () => {
    render(<OrbPreview schema={schema(`notes-${Math.random()}`)} isolated />);
    expect(await screen.findByText('First note')).toBeTruthy();
    fireEvent.change(await screen.findByLabelText<HTMLInputElement>(/title/), { target: { value: 'Draft' } });
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(screen.getByLabelText<HTMLInputElement>(/title/).value).toBe('Draft');
  });

  it('control: the seeded note shows on first load', async () => {
    render(<OrbPreview schema={schema(`notes-${Math.random()}`)} isolated />);
    expect(await screen.findByText('First note')).toBeTruthy();
    expect(screen.queryByText('Second note')).toBeNull();
  });
});

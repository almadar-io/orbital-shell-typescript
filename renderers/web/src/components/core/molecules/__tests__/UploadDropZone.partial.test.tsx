import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { UploadDropZone } from '../UploadDropZone';
import { EventBusProvider } from '../../../../core';

function pick(files: File[], props: Partial<React.ComponentProps<typeof UploadDropZone>>) {
  const onFiles = vi.fn();
  render(
    <EventBusProvider debug={false}>
      <UploadDropZone maxFiles={10} onFiles={onFiles} {...props} />
    </EventBusProvider>,
  );
  const input = document.querySelector('input[type="file"]');
  if (!(input instanceof HTMLInputElement)) throw new Error('no file input');
  fireEvent.change(input, { target: { files } });
  return onFiles;
}

const pdf = (name: string, body = 'x') => new File([body], name, { type: 'application/pdf' });
const docx = (name: string) =>
  new File(['x'], name, { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });

describe('UploadDropZone partial acceptance', () => {
  it('an extension in accept matches whatever case the file name uses', () => {
    const mp3 = (name: string) => new File(['x'], name, { type: '' });
    const onFiles = pick([mp3('Track.MP3'), mp3('mix.Mp3')], { accept: '.mp3,.wav' });
    expect(onFiles.mock.calls[0][0].map((f: File) => f.name)).toEqual(['Track.MP3', 'mix.Mp3']);
    expect(document.body.textContent ?? '').not.toMatch(/invalid/i);
  });

  it('control: an extension that is not in accept is still refused in any case', () => {
    const onFiles = pick([new File(['x'], 'Track.AIFF', { type: '' })], { accept: '.mp3,.wav' });
    expect(onFiles).not.toHaveBeenCalled();
    expect(document.body.textContent ?? '').toContain('Track.AIFF');
  });

  it('keeps valid files and names the rejected one', () => {
    const onFiles = pick([pdf('a.pdf'), docx('b.docx'), pdf('c.pdf')], { accept: 'application/pdf' });
    expect(onFiles).toHaveBeenCalledTimes(1);
    expect(onFiles.mock.calls[0][0].map((f: File) => f.name)).toEqual(['a.pdf', 'c.pdf']);
    const text = document.body.textContent ?? '';
    expect(text).toContain('b.docx');
    expect(text).not.toContain('a.pdf');
  });

  it('names every rejected file', () => {
    pick([pdf('a.pdf'), docx('b.docx'), docx('c.docx')], { accept: 'application/pdf' });
    const text = document.body.textContent ?? '';
    expect(text).toContain('b.docx');
    expect(text).toContain('c.docx');
  });

  it('control: all valid emits all with no error', () => {
    const onFiles = pick([pdf('a.pdf'), pdf('b.pdf')], { accept: 'application/pdf' });
    expect(onFiles.mock.calls[0][0]).toHaveLength(2);
    expect(screen.queryByText(/could not be added/i)).toBeNull();
    expect(document.body.textContent ?? '').not.toMatch(/invalid|too large/i);
  });

  it('all invalid emits nothing and shows the error', () => {
    const onFiles = pick([docx('b.docx'), docx('c.docx')], { accept: 'application/pdf' });
    expect(onFiles).not.toHaveBeenCalled();
    expect(document.body.textContent ?? '').toContain('b.docx');
    expect(document.body.textContent ?? '').toContain('c.docx');
  });

  it('size limit keeps the small files and names the large one', () => {
    const onFiles = pick([pdf('small.pdf', 'x'), pdf('big.pdf', 'x'.repeat(100))], { maxSize: 10 });
    expect(onFiles.mock.calls[0][0].map((f: File) => f.name)).toEqual(['small.pdf']);
    expect(document.body.textContent ?? '').toContain('big.pdf');
    expect(document.body.textContent ?? '').not.toContain('small.pdf');
  });

  it('max count keeps the first N and names the rest', () => {
    const onFiles = pick([pdf('a.pdf'), pdf('b.pdf'), pdf('c.pdf')], { maxFiles: 2 });
    expect(onFiles.mock.calls[0][0].map((f: File) => f.name)).toEqual(['a.pdf', 'b.pdf']);
    expect(document.body.textContent ?? '').toContain('c.pdf');
  });
});

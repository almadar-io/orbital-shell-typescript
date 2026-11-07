import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const emulator = vi.hoisted(() => ({ host: undefined as string | undefined }));
const roster = vi.hoisted(() => ({ personas: [] as { id: string; name?: string; role?: string }[] }));

vi.mock('../../../../config/auth', () => ({
  authEmulatorHost: () => Promise.resolve(emulator.host),
}));
vi.mock('../../AuthContext', () => ({
  useAuthContext: () => ({ user: null }),
}));
vi.mock('@almadar/shell-web/auth/react', () => ({
  useDevPersonas: () => ({ personas: roster.personas, signInAs: () => Promise.resolve() }),
}));
vi.mock('@almadar/shell-web/core', () => ({
  HStack: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Typography: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  Select: ({ options }: { options: { value: string; label: string }[] }) => (
    <select aria-label="persona">
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  ),
}));

import { PersonaSwitcher } from '../PersonaSwitcher';

describe('G-ORBITAL-SHELL-TYPESCRIPT-029 PersonaSwitcher', () => {
  beforeEach(() => {
    emulator.host = undefined;
    roster.personas = [];
  });

  it('on the Auth emulator with a roster it offers each persona', async () => {
    emulator.host = 'localhost:9099';
    roster.personas = [{ id: 'a', name: 'Ada', role: 'admin' }, { id: 'b', name: 'Bo', role: 'member' }];
    render(<PersonaSwitcher />);
    await waitFor(() => expect(screen.getByLabelText('persona')).toBeTruthy());
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Ada — admin', 'Bo — member']);
  });

  it('control: on the emulator with an empty roster it shows nothing', async () => {
    emulator.host = 'localhost:9099';
    const { container } = render(<PersonaSwitcher />);
    await waitFor(() => expect(container.innerHTML).toBe(''));
  });

  it('control: off the emulator it shows nothing even with a roster', async () => {
    roster.personas = [{ id: 'a', name: 'Ada', role: 'admin' }];
    const { container } = render(<PersonaSwitcher />);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(container.innerHTML).toBe('');
  });
});

/**
 * Dev persona switch — view the app as each identity its `[identity]` entity declares.
 *
 * Shown only when the page signs in on the Auth emulator (`authEmulatorHost()`: the served
 * `init.json`'s `authEmulatorHost`, or `VITE_FIREBASE_AUTH_EMULATOR_HOST`), so it never appears, or
 * calls the server, in a real deployment or a client-only site. Choosing a
 * persona signs in as that emulated user: a real ID token, so `@user` resolves as in production.
 */

import React, { useEffect, useState } from 'react';
import { HStack, Select, Typography } from '@almadar/shell-web/core';
import { useDevPersonas } from '@almadar/auth/react';
import { useAuthContext } from '../AuthContext';
import { authEmulatorHost } from '../../../config/auth';

const API_BASE: string = import.meta.env.VITE_API_URL ?? '';

function DevPersonaPicker(): React.ReactElement | null {
  const { user } = useAuthContext();
  const { personas, signInAs } = useDevPersonas(API_BASE);
  if (personas.length === 0) return null;

  const options = personas.map((p) => ({
    value: p.id,
    label: `${String(p.name ?? p.id)} — ${String(p.role ?? 'no role')}`,
  }));

  return (
    <HStack gap="sm" align="center">
      <Typography variant="caption" color="muted">
        Viewing as
      </Typography>
      <Select
        options={options}
        value={user?.uid ?? ''}
        placeholder="Signed out"
        onChange={(event) => {
          void signInAs(event.target.value);
        }}
      />
    </HStack>
  );
}

export function PersonaSwitcher(): React.ReactElement | null {
  const [onEmulator, setOnEmulator] = useState(false);
  useEffect(() => {
    void authEmulatorHost().then((host) => setOnEmulator(host !== undefined));
  }, []);
  return onEmulator ? <DevPersonaPicker /> : null;
}

export default PersonaSwitcher;

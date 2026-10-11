// @vitest-environment jsdom
/**
 * The compiled app's half of the system event `UI:SIGN_OUT` (G-PATTERN-SYNC-031): a Sign out
 * inside the app ends the viewer's session through `@almadar/auth`.
 */
import React, { useEffect } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { EventBusProvider } from '@almadar/ui/providers';
import { useEventBus } from '@almadar/ui/hooks';

const signOut = vi.fn(async () => undefined);
vi.mock('../AuthContext', () => ({ useAuthContext: () => ({ signOut }) }));

import { SignOutListener } from '../SignOutListener';

function Emit({ event }: { event: string }): null {
  const bus = useEventBus();
  useEffect(() => { bus.emit(event, {}); }, [bus, event]);
  return null;
}

function mount(event: string): void {
  render(
    <EventBusProvider>
      <SignOutListener />
      <Emit event={event} />
    </EventBusProvider>,
  );
}

describe('SignOutListener', () => {
  it('ends the session on UI:SIGN_OUT', () => {
    signOut.mockClear();
    mount('UI:SIGN_OUT');
    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it('control: another UI event signs nobody out', () => {
    signOut.mockClear();
    mount('UI:NAVIGATE');
    expect(signOut).not.toHaveBeenCalled();
  });
});

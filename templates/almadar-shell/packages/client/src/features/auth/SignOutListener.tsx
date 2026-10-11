import { useEffect } from 'react';
import { useEventBus } from '@almadar/ui/hooks';
import { useAuthContext } from './AuthContext';

/** The host's half of the system event `UI:SIGN_OUT`: a Sign out inside the app ends the viewer's session. */
export function SignOutListener(): null {
  const bus = useEventBus();
  const { signOut } = useAuthContext();
  useEffect(() => bus.on('UI:SIGN_OUT', () => { void signOut(); }), [bus, signOut]);
  return null;
}

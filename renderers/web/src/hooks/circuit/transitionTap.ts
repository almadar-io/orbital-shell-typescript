/**
 * A host that runs a program inside its own view (a split guest's GuestView) hears every transition that program's
 * kernel takes, as the verification observer does, without reaching into the kernel.
 */
import { createContext } from 'react';
import type { TransitionObserver } from '@almadar/shell-runtime/client/trait-types';

export type TransitionTap = TransitionObserver['onTransition'];

export const TransitionTapContext = createContext<TransitionTap | undefined>(undefined);

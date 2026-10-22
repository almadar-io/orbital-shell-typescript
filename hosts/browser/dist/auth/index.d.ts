import { Auth } from 'firebase/auth';
import { JsonObject } from '@almadar/core';

interface BrowserAuthConfig {
    /** A distinct name per signed-in surface, so two apps on one page never share a session. */
    appName: string;
    apiKey: string;
    projectId: string;
    authDomain?: string;
    /** Identity Platform tenant the app's users belong to. */
    tenantId?: string;
    /** `host:port` of the Auth emulator. */
    emulatorHost?: string;
    /** Where the session lives: `local` (survives reloads, the default) or `memory` (this page only). */
    persistence?: 'local' | 'memory';
}
interface SignedInUser {
    uid: string;
    email?: string;
    name?: string;
    photoURL?: string;
    /** The ID token's claims (custom claims such as `role` included). */
    claims: JsonObject;
}
/** One sign-in surface: who is signed in, the ways to sign in, and the ID token every request carries. */
interface BrowserAuth {
    readonly auth: Auth;
    currentUid(): Promise<string | null>;
    signInWithCustomToken(customToken: string): Promise<SignedInUser>;
    signInWithEmail(email: string, password: string): Promise<SignedInUser>;
    signUpWithEmail(email: string, password: string, displayName?: string): Promise<SignedInUser>;
    signInWithGoogle(): Promise<SignedInUser>;
    sendSignInLinkToEmail(email: string, returnUrl: string): Promise<void>;
    isSignInWithEmailLink(link: string): boolean;
    signInWithEmailLink(email: string, link: string): Promise<SignedInUser>;
    /** The current user's ID token (refreshed when near expiry), or undefined when signed out. */
    idToken(): Promise<string | undefined>;
    /** Each change of the signed-in user. `onError` receives a failure to resolve a user's claims. */
    onUserChanged(listener: (user: SignedInUser | null) => void, onError?: (error: Error) => void): () => void;
    signOut(): Promise<void>;
}
declare function connectAuth(config: BrowserAuthConfig): Promise<BrowserAuth>;

export { type BrowserAuth, type BrowserAuthConfig, type SignedInUser, connectAuth };

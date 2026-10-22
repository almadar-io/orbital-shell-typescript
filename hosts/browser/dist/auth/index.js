// src/auth/index.ts
import { initializeApp, getApps } from "firebase/app";
import {
  GoogleAuthProvider,
  browserLocalPersistence,
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  getAuth,
  inMemoryPersistence,
  isSignInWithEmailLink,
  onIdTokenChanged,
  sendSignInLinkToEmail,
  setPersistence,
  signInWithCustomToken,
  signInWithEmailAndPassword,
  signInWithEmailLink,
  signInWithPopup,
  signOut,
  updateProfile
} from "firebase/auth";
import { z } from "zod";
import { JsonValueSchema } from "@almadar/core";
var ClaimsSchema = z.record(JsonValueSchema);
async function signedIn(user) {
  const { claims } = await user.getIdTokenResult();
  return {
    uid: user.uid,
    ...user.email !== null ? { email: user.email } : {},
    ...user.displayName !== null ? { name: user.displayName } : {},
    ...user.photoURL !== null ? { photoURL: user.photoURL } : {},
    claims: ClaimsSchema.parse(JSON.parse(JSON.stringify(claims)))
  };
}
function appFor(config) {
  const existing = getApps().find((app) => app.name === config.appName);
  return existing ?? initializeApp(
    { apiKey: config.apiKey, projectId: config.projectId, ...config.authDomain !== void 0 ? { authDomain: config.authDomain } : {} },
    config.appName
  );
}
async function connectAuth(config) {
  const auth = getAuth(appFor(config));
  if (config.tenantId !== void 0) auth.tenantId = config.tenantId;
  if (config.emulatorHost !== void 0 && auth.emulatorConfig === null) {
    connectAuthEmulator(auth, `http://${config.emulatorHost}`, { disableWarnings: true });
  }
  await setPersistence(auth, config.persistence === "memory" ? inMemoryPersistence : browserLocalPersistence);
  return {
    auth,
    async currentUid() {
      await auth.authStateReady();
      return auth.currentUser?.uid ?? null;
    },
    async signInWithCustomToken(customToken) {
      return signedIn((await signInWithCustomToken(auth, customToken)).user);
    },
    async signInWithEmail(email, password) {
      return signedIn((await signInWithEmailAndPassword(auth, email, password)).user);
    },
    async signUpWithEmail(email, password, displayName) {
      const { user } = await createUserWithEmailAndPassword(auth, email, password);
      if (displayName !== void 0) await updateProfile(user, { displayName });
      return signedIn(user);
    },
    async signInWithGoogle() {
      return signedIn((await signInWithPopup(auth, new GoogleAuthProvider())).user);
    },
    async sendSignInLinkToEmail(email, returnUrl) {
      await sendSignInLinkToEmail(auth, email, { url: returnUrl, handleCodeInApp: true });
    },
    isSignInWithEmailLink(link) {
      return isSignInWithEmailLink(auth, link);
    },
    async signInWithEmailLink(email, link) {
      return signedIn((await signInWithEmailLink(auth, email, link)).user);
    },
    async idToken() {
      return auth.currentUser ? auth.currentUser.getIdToken() : void 0;
    },
    onUserChanged(listener, onError) {
      let generation = 0;
      const stop = onIdTokenChanged(auth, (user) => {
        const current = ++generation;
        if (user === null) listener(null);
        else
          void signedIn(user).then(
            (resolved) => {
              if (current === generation) listener(resolved);
            },
            (err) => {
              if (current === generation) onError?.(err instanceof Error ? err : new Error(String(err)));
            }
          );
      });
      return () => {
        generation++;
        stop();
      };
    },
    async signOut() {
      await signOut(auth);
    }
  };
}
export {
  connectAuth
};

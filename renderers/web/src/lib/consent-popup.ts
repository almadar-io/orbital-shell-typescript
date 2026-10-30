import { consentFromRedirect, HostAskError, type HostConsentAnswer, type HostConsentRequest } from '@almadar/shell-runtime/kernel/host';

export interface ConsentPopup {
  readonly closed: boolean;
  readonly location: { readonly href: string };
  close(): void;
}

export interface ConsentPopupEnv {
  origin: string;
  open(url: string): ConsentPopup | null;
  wait(ms: number): Promise<void>;
}

const POLL_MS = 250;

/** The web host's `auth/consent`: the authorize URL in a popup, answered with the code and state of the redirect back to this origin. */
export function consentByPopup(env: ConsentPopupEnv): (request: HostConsentRequest) => Promise<HostConsentAnswer> {
  return async (request) => {
    const popup = env.open(request.authorizeUrl);
    if (popup === null) throw new HostAskError('unavailable', 'the browser blocked the consent window');
    for (;;) {
      if (popup.closed) throw new HostAskError('cancelled', 'the viewer closed the consent window');
      let href: string | undefined;
      try {
        href = popup.location.href;
      } catch {
        href = undefined;
      }
      if (href !== undefined && href !== 'about:blank' && new URL(href).origin === env.origin) {
        popup.close();
        return consentFromRedirect(href);
      }
      await env.wait(POLL_MS);
    }
  };
}

export function browserConsentEnv(win: Window): ConsentPopupEnv {
  return {
    origin: win.location.origin,
    open: (url) => win.open(url, 'almadar-consent', 'popup,width=520,height=720'),
    wait: (ms) => new Promise((resolve) => win.setTimeout(resolve, ms)),
  };
}

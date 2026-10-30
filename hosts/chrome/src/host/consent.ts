import { consentFromRedirect, HostAskError, type HostConsentAnswer, type HostConsentRequest } from '@almadar/shell-runtime/kernel/host';

/** The one `chrome.identity` call the consent uses. */
export interface ChromeIdentityApi {
  launchWebAuthFlow(details: { url: string; interactive: boolean }): Promise<string | undefined>;
}

/** The extension host's `auth/consent`: the authorize URL through `chrome.identity.launchWebAuthFlow`, answered with the code and state of the returned URL. */
export function chromeConsent(identity: () => ChromeIdentityApi | undefined): (request: HostConsentRequest) => Promise<HostConsentAnswer> {
  return async (request) => {
    const api = identity();
    if (api === undefined) throw new HostAskError('unavailable', 'chrome.identity is not available: the extension needs the identity permission');
    let redirect: string | undefined;
    try {
      redirect = await api.launchWebAuthFlow({ url: request.authorizeUrl, interactive: true });
    } catch (error) {
      throw new HostAskError('denied', error instanceof Error ? error.message : String(error));
    }
    if (redirect === undefined) throw new HostAskError('denied', 'the authorization flow returned no redirect URL');
    return consentFromRedirect(redirect);
  };
}

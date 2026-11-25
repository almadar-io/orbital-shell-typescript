/**
 * The desktop host's sign-in page (RFC 8252 loopback). The native app opens it in the system browser with the
 * loopback `port` it listens on and a one-time `state`; the viewer signs in with Google on a side session, and the page
 * form-POSTs `{ state, idToken, refreshToken }` to `http://127.0.0.1:<port>/callback`, where only that app is
 * listening. No program runs here and the tokens never enter a URL.
 */
import { connectAppAuth } from './config/auth';

const PORT = /^[0-9]{4,5}$/;
const STATE = /^[A-Za-z0-9_-]{22,128}$/;

function show(message: string): void {
  const status = document.getElementById('status');
  if (status !== null) status.textContent = message;
}

function postToApp(port: string, fields: Record<string, string>): void {
  const form = document.createElement('form');
  form.method = 'POST';
  form.action = `http://127.0.0.1:${port}/callback`;
  for (const [name, value] of Object.entries(fields)) {
    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = name;
    input.value = value;
    form.appendChild(input);
  }
  document.body.appendChild(form);
  form.submit();
}

async function start(): Promise<void> {
  const params = new URLSearchParams(window.location.search);
  const port = params.get('port') ?? '';
  const state = params.get('state') ?? '';
  if (!PORT.test(port) || Number(port) < 1024 || Number(port) > 65535 || !STATE.test(state)) {
    show('This sign-in link is not valid. Start signing in again from the app.');
    return;
  }
  const auth = await connectAppAuth();
  if (auth === null) {
    show('Sign-in is not configured for this app.');
    return;
  }
  const button = document.getElementById('sign-in');
  if (button === null) return;
  show('Sign in to continue in the app.');
  button.hidden = false;
  button.addEventListener('click', () => {
    void (async () => {
      button.hidden = true;
      show('Signing in…');
      try {
        const { idToken, refreshToken } = await auth.googleDeviceCredential();
        show('Signed in. You can return to the app.');
        postToApp(port, { state, idToken, refreshToken });
      } catch (error) {
        button.hidden = false;
        show(`Sign-in did not finish: ${error instanceof Error ? error.message : String(error)}`);
      }
    })();
  });
}

void start();

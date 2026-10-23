import { CREDENTIAL_MASTER_KEY_ENV, CREDENTIAL_PREVIOUS_MASTER_KEY_ENV } from './chunk-NAECVIAR.js';

// src/credentials/env-vars.ts
var STORE_BOOTSTRAP_ENV_VARS = /* @__PURE__ */ new Set([CREDENTIAL_MASTER_KEY_ENV, CREDENTIAL_PREVIOUS_MASTER_KEY_ENV]);
function allCredentialEnvVars() {
  return new Set(STORE_BOOTSTRAP_ENV_VARS);
}

export { STORE_BOOTSTRAP_ENV_VARS, allCredentialEnvVars };

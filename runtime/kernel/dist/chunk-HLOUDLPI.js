// src/credentials/scope.ts
function credentialModeFromEnv(env) {
  return env.ALMADAR_INTEGRATIONS_MODE === "mock" || env.USE_MOCK_DATA === "true" ? "mock" : "real";
}
var installedStore = null;
var modeControl = null;
var tenantScope;
function installCredentialScopeStorage(storage) {
  tenantScope = storage;
}
function runWithCredentialScope(store, fn) {
  if (tenantScope === void 0) throw new Error("runWithCredentialScope needs an installed CredentialScopeStorage (a Node host installs it through @almadar/shell-node)");
  return tenantScope.run(store, fn);
}
function installModeControl(control) {
  modeControl = control;
}
function getModeControl() {
  return modeControl;
}
function installCredentialStore(store) {
  installedStore = store;
}
function getInstalledCredentialStore() {
  return installedStore;
}
function getEffectiveCredentialStore() {
  return tenantScope?.getStore() ?? installedStore;
}
function uninstallCredentialStore() {
  installedStore = null;
}
var CREDENTIALS_SOURCE_ENV = "ALMADAR_CREDENTIALS_SOURCE";
var HOST_SETTING_VARS = /* @__PURE__ */ new Set(["ALMADAR_CREDENTIAL_ADMIN_ROLES", CREDENTIALS_SOURCE_ENV, "ALMADAR_INTEGRATIONS_MODE", "USE_MOCK_DATA"]);
function credentialsFromStoreOnly(env) {
  return env[CREDENTIALS_SOURCE_ENV] === "store";
}
function resolveCredentialRef(ref, env = typeof process === "undefined" ? {} : process.env, principal) {
  const tenant = tenantScope?.getStore();
  if (tenant) return tenant.resolve(ref, principal);
  if (principal !== void 0) return installedStore?.resolve(ref, principal);
  const stored = installedStore?.resolve(ref);
  if (stored !== void 0) return stored;
  if (credentialsFromStoreOnly(env) && !HOST_SETTING_VARS.has(ref)) return void 0;
  return env[ref];
}

export { CREDENTIALS_SOURCE_ENV, credentialModeFromEnv, credentialsFromStoreOnly, getEffectiveCredentialStore, getInstalledCredentialStore, getModeControl, installCredentialScopeStorage, installCredentialStore, installModeControl, resolveCredentialRef, runWithCredentialScope, uninstallCredentialStore };

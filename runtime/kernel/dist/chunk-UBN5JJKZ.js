// src/service/service-provider.ts
var ServiceCallError = class extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
    this.name = "ServiceCallError";
  }
  code;
};
var providers = /* @__PURE__ */ new Map();
function registerServiceProvider(service, provider) {
  providers.set(service, provider);
}
function unregisterServiceProvider(service) {
  providers.delete(service);
}
function registeredServices() {
  return [...providers.keys()];
}
async function callRegisteredService(service, action, params, context) {
  const provider = providers.get(service);
  if (provider === void 0) throw new Error(`Unknown integration: ${service}`);
  return provider(action, params ?? {}, context);
}

export { ServiceCallError, callRegisteredService, registerServiceProvider, registeredServices, unregisterServiceProvider };

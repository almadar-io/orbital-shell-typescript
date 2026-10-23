// src/effects/on-device-model.ts
var NO_ON_DEVICE_MODEL = "browser/prompt: no on-device model is wired into this host";
var NO_ON_DEVICE_EMBEDDER = "browser/embed: no on-device embedder is wired into this host";
var OnDeviceModelFailure = class extends Error {
  kind;
  payload;
  constructor(kind, message, key) {
    super(message);
    this.name = "OnDeviceModelFailure";
    this.kind = kind;
    this.payload = { error: message, kind, key };
  }
};
function failureMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
async function promptOnDevice(ports, text, schemaText, key, signal) {
  const model = ports?.model;
  if (model === void 0) throw new OnDeviceModelFailure("unconfigured", NO_ON_DEVICE_MODEL, key);
  let schema;
  try {
    const parsed = JSON.parse(schemaText);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("not an object");
    schema = parsed;
  } catch {
    throw new OnDeviceModelFailure("failed", "browser/prompt: the response schema must be JSON Schema text: a JSON object", key);
  }
  try {
    const state = await model.availability();
    if (state !== "available") throw new OnDeviceModelFailure("unavailable", `The on-device model is ${state}`, key);
    return await model.prompt(text, schema, signal);
  } catch (error) {
    if (error instanceof OnDeviceModelFailure) throw error;
    throw new OnDeviceModelFailure("failed", failureMessage(error), key);
  }
}
async function embedOnDevice(ports, texts, key, signal) {
  if (texts.length === 0) return [];
  const embedder = ports?.embedder;
  if (embedder === void 0) throw new OnDeviceModelFailure("unconfigured", NO_ON_DEVICE_EMBEDDER, key);
  try {
    return await embedder.embed([...texts], signal);
  } catch (error) {
    throw new OnDeviceModelFailure("failed", failureMessage(error), key);
  }
}

export { NO_ON_DEVICE_EMBEDDER, NO_ON_DEVICE_MODEL, OnDeviceModelFailure, embedOnDevice, promptOnDevice };

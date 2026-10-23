import { isEventResponse } from '@almadar/core/kernel-wire';
import { createLogger } from '@almadar/logger';

// src/kernel/frame-applier.ts
var log = createLogger("almadar:shell-web:frame");
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isList(value, item) {
  return Array.isArray(value) && value.every(item);
}
function isSeed(value) {
  return isRecord(value) && typeof value["trait"] === "string" && typeof value["event"] === "string";
}
function isRoutedLeg(value) {
  if (!isRecord(value) || typeof value["orbital"] !== "string") return false;
  const leg = value["leg"];
  return isRecord(leg) && typeof leg["event"] === "string";
}
function isFiredTick(value) {
  return isRecord(value) && typeof value["trait"] === "string" && typeof value["tick"] === "string";
}
function isFrameDispatch(value) {
  if (!isRecord(value)) return false;
  const response = value["response"];
  return typeof value["trait"] === "string" && typeof value["orbital"] === "string" && isSeed(value["seed"]) && response !== void 0 && isEventResponse(response) && isList(value["serverLegs"], isRoutedLeg) && typeof value["mode"] === "string" && Array.isArray(value["awaiting"]) && Array.isArray(value["foldSeeded"]);
}
function isFrameWire(value) {
  if (!isRecord(value)) return false;
  const response = value["response"];
  return isList(value["fired"], isFiredTick) && response !== void 0 && isEventResponse(response) && isList(value["dispatches"], isFrameDispatch) && isList(value["browserLegs"], isRoutedLeg) && typeof value["droppedServerEffects"] === "number" && isList(value["errors"], (entry) => typeof entry === "string");
}
function decodeFrame(json) {
  if (json === void 0) return void 0;
  const value = JSON.parse(json);
  if (!isFrameWire(value)) throw new Error("kernel wire: frame is not a FrameWire");
  return value;
}
var NOTHING = { fired: [], folded: 0, browserLegs: 0, droppedServerEffects: 0, outcomes: [], errors: [] };
var settle = (posted, failure, trait) => posted.then(
  (effects) => effects,
  (err) => {
    log.warn(failure, { trait, error: String(err) });
    return void 0;
  }
);
async function applyFrame(json, kernel, post) {
  const frame = decodeFrame(json);
  if (frame === void 0) return NOTHING;
  for (const message of frame.errors) log.warn("frame-tick-failed", { error: message });
  const last = frame.dispatches.length - 1;
  await kernel.foldLocalResponse(frame.response, false, last < 0);
  for (const [i, dispatch] of frame.dispatches.entries()) await kernel.foldLocalResponse(dispatch.response, true, i === last);
  const outcomes = [{ response: frame.response, mode: "hybridClientOnly" }];
  if (post !== void 0) {
    for (const leg of frame.browserLegs) {
      const tickSettled = settle(post.sendBrowserLeg(leg, frame.response), "tick-browser-leg-failed", leg.leg.targetTrait ?? "");
      outcomes.push({ response: { success: true, transitioned: false, states: {}, emittedEvents: [] }, mode: "hybridClientOnly", tickSettled });
    }
  }
  for (const dispatch of frame.dispatches) {
    if (post === void 0 || dispatch.serverLegs.length === 0 && dispatch.statefulLeg === null) {
      outcomes.push({ response: dispatch.response, mode: dispatch.mode });
      continue;
    }
    outcomes.push({ response: dispatch.response, mode: dispatch.mode, tickSettled: settle(post.postDispatch(dispatch), "tick-post-failed", dispatch.trait) });
  }
  return {
    fired: frame.fired,
    folded: frame.dispatches.length + 1,
    browserLegs: frame.browserLegs.length,
    droppedServerEffects: frame.droppedServerEffects,
    outcomes,
    errors: frame.errors
  };
}

export { applyFrame, decodeFrame, isFrameWire };

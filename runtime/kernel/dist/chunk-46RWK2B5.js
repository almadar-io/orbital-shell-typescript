// src/runtime/time/duration.ts
function parseDurationString(interval) {
  const match = interval.match(/^(\d+)(ms|s|m|h)?$/);
  if (!match) {
    throw new Error(
      `Invalid duration '${interval}': expected a shape like '5ms'/'5s'/'1m'/'1h'`
    );
  }
  const value = parseInt(match[1], 10);
  const unit = match[2] || "ms";
  switch (unit) {
    case "ms":
      return value;
    case "s":
      return value * 1e3;
    case "m":
      return value * 60 * 1e3;
    case "h":
      return value * 60 * 60 * 1e3;
    default:
      return value;
  }
}
function isValidDurationString(interval) {
  return /^(\d+)(ms|s|m|h)?$/.test(interval);
}

export { isValidDurationString, parseDurationString };

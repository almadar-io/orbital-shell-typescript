// src/runtime/time/cron.ts
function parseCronField(field, min, max) {
  const values = /* @__PURE__ */ new Set();
  for (const part of field.split(",")) {
    if (part === "*") {
      for (let i = min; i <= max; i++) values.add(i);
    } else if (part.includes("/")) {
      const [range, stepStr] = part.split("/");
      const step = parseInt(stepStr, 10);
      const start = range === "*" ? min : parseInt(range, 10);
      for (let i = start; i <= max; i += step) values.add(i);
    } else if (part.includes("-")) {
      const [lo, hi] = part.split("-").map(Number);
      for (let i = lo; i <= hi; i++) values.add(i);
    } else {
      values.add(parseInt(part, 10));
    }
  }
  return values;
}
function parseCron(expression) {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new Error(`Invalid cron expression (expected 5 fields): ${expression}`);
  }
  return {
    minute: parseCronField(parts[0], 0, 59),
    hour: parseCronField(parts[1], 0, 23),
    day: parseCronField(parts[2], 1, 31),
    month: parseCronField(parts[3], 1, 12),
    weekday: parseCronField(parts[4], 0, 6)
  };
}
function isValidCronExpression(expression) {
  try {
    parseCron(expression);
    return true;
  } catch {
    return false;
  }
}
function cronMatches(fields, date) {
  return fields.minute.has(date.getMinutes()) && fields.hour.has(date.getHours()) && fields.day.has(date.getDate()) && fields.month.has(date.getMonth() + 1) && fields.weekday.has(date.getDay());
}
function cronMinuteKey(date) {
  return date.getFullYear() * 1e8 + date.getMonth() * 1e6 + date.getDate() * 1e4 + date.getHours() * 100 + date.getMinutes();
}

export { cronMatches, cronMinuteKey, isValidCronExpression, parseCron, parseCronField };

// src/page-facts.ts
var PAGE_FACT_FIELDS = ["hostname", "referrer", "screenWidth"];
function parsePageFactFields(value) {
  if (!Array.isArray(value) || value.length === 0) {
    return { error: "browser/page-facts: the fields must be a non-empty list of hostname, referrer, screenWidth" };
  }
  const fields = [];
  for (const entry of value) {
    const field = PAGE_FACT_FIELDS.find((known) => known === entry);
    if (field === void 0) {
      return { error: `browser/page-facts: ${String(entry)} is not one of ${PAGE_FACT_FIELDS.join(", ")}` };
    }
    if (fields.includes(field)) return { error: `browser/page-facts: ${field} is listed twice` };
    fields.push(field);
  }
  return { fields };
}
function readPageFacts(fields) {
  const facts = { available: false, hostname: "", referrer: "", screenWidth: null };
  if (typeof window === "undefined" || typeof document === "undefined") return facts;
  facts.available = true;
  for (const field of fields) {
    if (field === "hostname") facts.hostname = window.location.hostname;
    else if (field === "referrer") facts.referrer = document.referrer;
    else facts.screenWidth = window.screen?.width ?? null;
  }
  return facts;
}

export {
  parsePageFactFields,
  readPageFacts
};

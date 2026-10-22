// src/host/tabs/template.ts
var REFERENCE = /\{([A-Za-z_][A-Za-z0-9_]*)\}/g;
function templateReferences(template) {
  return Array.from(template.matchAll(REFERENCE), (m) => m[1]);
}
function fillTemplate(template, values) {
  if (templateReferences(template).some((name) => (values[name] ?? "") === "")) return "";
  return template.replace(REFERENCE, (_, name) => values[name]);
}

// src/host/tabs/executor.ts
var PageCommandError = class extends Error {
  constructor(kind, message) {
    super(message);
    this.kind = kind;
    this.name = "PageCommandError";
  }
  kind;
};
var LABEL_ATTR = "data-almadar-page-label";
function observed(fields) {
  const awaits = fields.some((f) => f.required === true);
  return { childList: true, subtree: true, characterData: awaits, attributes: awaits };
}
function windowOf(doc) {
  const view = doc.defaultView;
  if (!view) throw new PageCommandError("invalid", "The page executor needs a document attached to a window");
  return view;
}
function createPageExecutor(doc) {
  const view = windowOf(doc);
  const ids = /* @__PURE__ */ new WeakMap();
  const byId = /* @__PURE__ */ new Map();
  const applied = /* @__PURE__ */ new WeakMap();
  const watches = /* @__PURE__ */ new Map();
  const reported = /* @__PURE__ */ new Map();
  let nextId = 1;
  function idOf(el) {
    const known = ids.get(el);
    if (known !== void 0) return known;
    const id = `el-${nextId++}`;
    ids.set(el, id);
    byId.set(id, new WeakRef(el));
    return id;
  }
  function elementOf(elementId) {
    const el = byId.get(elementId)?.deref();
    if (!el || !el.isConnected) throw new PageCommandError("not-found", `No page element ${elementId}`);
    return el;
  }
  function read(el, fields) {
    const out = {};
    const asUrl = (spec, value) => spec.resolve === true && value !== "" ? new URL(value, doc.baseURI).toString() : value;
    for (const spec of fields) {
      if (spec.template != null) continue;
      const target = spec.selector != null ? el.querySelector(spec.selector) : el;
      if (!target) out[spec.name] = "";
      else if (spec.attr != null) out[spec.name] = asUrl(spec, target.getAttribute(spec.attr) ?? "");
      else out[spec.name] = asUrl(spec, (target.textContent ?? "").trim());
    }
    const readValues = { ...out };
    for (const spec of fields) {
      if (spec.template != null) out[spec.name] = asUrl(spec, fillTemplate(spec.template, readValues));
    }
    return { elementId: idOf(el), fields: out };
  }
  function ready(element, fields) {
    return fields.every((spec) => spec.required !== true || element.fields[spec.name] !== "");
  }
  function readReady(el, fields) {
    const element = read(el, fields);
    return ready(element, fields) ? element : void 0;
  }
  function styled(el) {
    if (!(el instanceof view.HTMLElement)) {
      throw new PageCommandError("invalid", `Page element ${idOf(el)} cannot be styled`);
    }
    return el;
  }
  function restore(el) {
    const prev = applied.get(el);
    if (!prev) return;
    for (const { property, value, priority } of prev.styles) el.style.setProperty(property, value, priority);
    prev.label?.remove();
    applied.delete(el);
  }
  return {
    query(selector, fields, limit) {
      const all = Array.from(doc.querySelectorAll(selector)).flatMap((el) => readReady(el, fields) ?? []);
      return limit !== void 0 ? all.slice(0, limit) : all;
    },
    queryWhenPresent(selector, fields, limit, waitMs) {
      const readAll = () => this.query(selector, fields, limit);
      const present = () => readAll().length > 0;
      if (present()) return Promise.resolve(readAll());
      return new Promise((resolve) => {
        const done = () => {
          observer.disconnect();
          view.clearTimeout(timer);
          resolve(readAll());
        };
        const observer = new view.MutationObserver(() => {
          if (present()) done();
        });
        observer.observe(doc.body, observed(fields));
        const timer = view.setTimeout(done, waitMs);
      });
    },
    watch(watchId, selector, fields, onElement) {
      this.unwatch(watchId);
      const seen = reported.get(watchId) ?? /* @__PURE__ */ new WeakSet();
      reported.set(watchId, seen);
      const report = () => {
        for (const el of Array.from(doc.querySelectorAll(selector))) {
          if (seen.has(el)) continue;
          const element = readReady(el, fields);
          if (element === void 0) continue;
          seen.add(el);
          onElement(element);
        }
      };
      const observer = new view.MutationObserver(report);
      observer.observe(doc.body, observed(fields));
      watches.set(watchId, { observer, seen });
      report();
    },
    unwatch(watchId) {
      const w = watches.get(watchId);
      if (!w) return false;
      w.observer.disconnect();
      watches.delete(watchId);
      return true;
    },
    apply({ elementId, styles, label }) {
      const el = styled(elementOf(elementId));
      restore(el);
      if (styles.length === 0 && label == null) return;
      const prev = {
        styles: styles.map(({ property }) => ({ property, value: el.style.getPropertyValue(property), priority: el.style.getPropertyPriority(property) })),
        label: null
      };
      for (const { property, value } of styles) el.style.setProperty(property, value);
      if (label != null) {
        const tag = doc.createElement("div");
        tag.setAttribute(LABEL_ATTR, "");
        tag.textContent = label;
        el.prepend(tag);
        prev.label = tag;
      }
      applied.set(el, prev);
    },
    applyMany(items) {
      const done = [];
      const missing = [];
      for (const item of items) {
        try {
          this.apply(item);
          done.push(item.elementId);
        } catch (err) {
          if (!(err instanceof PageCommandError) || err.kind !== "not-found") throw err;
          missing.push(item.elementId);
        }
      }
      return { applied: done, missing };
    },
    act(elementId, action, text) {
      const el = elementOf(elementId);
      if (action === "click") {
        if (el instanceof view.HTMLElement) el.click();
        else el.dispatchEvent(new view.MouseEvent("click", { bubbles: true }));
        return;
      }
      if (action === "focus") {
        styled(el).focus();
        return;
      }
      if (text === void 0) throw new PageCommandError("invalid", 'act "type" needs text');
      if (!(el instanceof view.HTMLInputElement || el instanceof view.HTMLTextAreaElement)) {
        throw new PageCommandError("invalid", `Page element ${elementId} does not accept text`);
      }
      const proto = el instanceof view.HTMLInputElement ? view.HTMLInputElement.prototype : view.HTMLTextAreaElement.prototype;
      Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(el, text);
      el.dispatchEvent(new view.Event("input", { bubbles: true }));
      el.dispatchEvent(new view.Event("change", { bubbles: true }));
    }
  };
}

// src/host/tabs/content.ts
function runPageContentScript(runtime, doc, url) {
  const executor = createPageExecutor(doc);
  const run = async (command) => {
    switch (command.kind) {
      case "query": {
        const elements = command.waitMs != null ? await executor.queryWhenPresent(command.selector, command.fields, command.limit ?? void 0, command.waitMs) : executor.query(command.selector, command.fields, command.limit ?? void 0);
        return elements;
      }
      case "watch":
        executor.watch(command.watchId, command.selector, command.fields, (element) => {
          void runtime.sendMessage({ almadarPage: "element", watchId: command.watchId, element, url });
        });
        return null;
      case "unwatch":
        return executor.unwatch(command.watchId);
      case "apply":
        executor.apply(command);
        return true;
      case "applyMany":
        return executor.applyMany(command.items);
      case "act":
        executor.act(command.elementId, command.action, command.text ?? void 0);
        return true;
    }
  };
  runtime.onMessage.addListener((message, _sender, respond) => {
    if (message.almadarPage !== "command") return;
    run(message.command).then(
      (result) => respond({ result }),
      (err) => respond({ error: { kind: err instanceof PageCommandError ? err.kind : "failed", message: err.message } })
    );
    return true;
  });
  void runtime.sendMessage({ almadarPage: "ready", url });
}

export { PageCommandError, createPageExecutor, runPageContentScript };

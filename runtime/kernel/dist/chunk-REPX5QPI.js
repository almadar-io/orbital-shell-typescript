// src/kernel/os-port.ts
function kernelOsCompletions(kernel) {
  const deferring = JSON.parse(kernel.osDeferringOps());
  const streaming = JSON.parse(kernel.osStreamOps());
  return {
    defers: (op) => deferring.includes(op),
    streams: (op) => streaming.includes(op),
    event: (site, key, outcome) => {
      const fired = JSON.parse(kernel.osCompletionEvent(JSON.stringify(site), key, JSON.stringify(outcome)));
      return fired;
    }
  };
}
function kernelOsGrants(matchers, server) {
  return {
    allows: (need) => server().osAllows(JSON.stringify(need)),
    globMatches: (glob, path) => matchers.osGlobMatches(glob, path),
    isPublicAddress: (ip) => matchers.isPublicAddress(ip),
    anchor: (anchors) => {
      const problems = JSON.parse(server().setOsAnchors(JSON.stringify(anchors)));
      return problems;
    },
    resolveArgs: (op, args) => {
      const resolved = JSON.parse(server().osResolveArgs(op, JSON.stringify(args)));
      return resolved;
    }
  };
}
function expandAnchor(anchors, text) {
  const home = text === "~" ? "" : text.startsWith("~/") ? text.slice(2) : void 0;
  const start = text === "." ? "" : text.startsWith("./") ? text.slice(2) : void 0;
  const rest = home ?? start;
  if (rest === void 0) return { kind: "plain" };
  const dir = home !== void 0 ? anchors.home : anchors.start;
  if (dir === void 0) return { kind: "unknown", message: `${text}: this host has no ${home !== void 0 ? "home" : "start"} directory` };
  return { kind: "anchored", path: rest === "" ? dir : `${dir.replace(/\/+$/, "")}/${rest}` };
}
function anchoredForms(anchors, path) {
  const forms = [path];
  const under = (dir, prefix) => {
    if (dir === void 0) return;
    const root = dir.replace(/\/+$/, "");
    if (path === root) forms.push(prefix);
    else if (path.startsWith(`${root}/`)) forms.push(`${prefix}${path.slice(root.length + 1)}`);
  };
  under(anchors.home, "~/");
  under(anchors.start, "./");
  return forms;
}
function anchoredGrants(grants, anchors) {
  return {
    ...grants,
    allows: (need) => need.need === "fs" ? anchoredForms(anchors, need.path).some((path) => grants.allows({ ...need, path })) : grants.allows(need)
  };
}

export { anchoredGrants, expandAnchor, kernelOsCompletions, kernelOsGrants };

// src/program/workspace-host.ts
var installedHost = null;
function installWorkspaceHost(host) {
  installedHost = host;
}
function uninstallWorkspaceHost() {
  installedHost = null;
}
function installedWorkspaceHost() {
  return installedHost;
}
function workspaceOwnerSegment(principal) {
  let out = "";
  for (const byte of new TextEncoder().encode(principal)) {
    const ch = String.fromCharCode(byte);
    out += /[A-Za-z0-9-]/.test(ch) ? ch : `_${byte.toString(16).padStart(2, "0")}`;
  }
  return out;
}

export { installWorkspaceHost, installedWorkspaceHost, uninstallWorkspaceHost, workspaceOwnerSegment };

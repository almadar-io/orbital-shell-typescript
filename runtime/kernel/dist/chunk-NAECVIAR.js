import { credentialStorageKey } from '@almadar/core';

// src/credentials/store.ts
var CREDENTIAL_ENTITY_TYPE = "AlmadarIntegrationCredential";
var CREDENTIAL_MASTER_KEY_ENV = "ALMADAR_CREDENTIAL_MASTER_KEY";
var CREDENTIAL_PREVIOUS_MASTER_KEY_ENV = "ALMADAR_CREDENTIAL_MASTER_KEY_PREVIOUS";
var TAG_BYTES = 16;
var IV_BYTES = 12;
function fromHex(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i += 1) bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}
function toHex(bytes) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
function utf8(text) {
  return new TextEncoder().encode(text);
}
async function sha256Hex(bytes) {
  return toHex(new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", bytes)));
}
function environment(name) {
  return typeof process === "undefined" ? void 0 : process.env[name];
}
var DERIVED_ENTITY_TYPE = "AlmadarKernelDerivedSecret";
function keepsDerived(adapter) {
  return "getById" in adapter && typeof adapter.getById === "function";
}
function derivedId(identity) {
  return sha256Hex(utf8(credentialStorageKey(identity)));
}
function isNonEmptyString(v) {
  return typeof v === "string" && v.length > 0;
}
async function keyIdOf(masterKeyHex) {
  return (await sha256Hex(fromHex(masterKeyHex))).slice(0, 16);
}
var MASTER_KEY_SHAPE = /^[0-9a-fA-F]{64}$/;
var CredentialStore = class {
  adapter;
  masterKeyHex;
  previousKeyHex;
  byIdentity = /* @__PURE__ */ new Map();
  listeners = /* @__PURE__ */ new Set();
  warmed = false;
  constructor(adapter, masterKey, previousMasterKey) {
    this.adapter = adapter;
    const key = masterKey ?? environment(CREDENTIAL_MASTER_KEY_ENV);
    const valid = typeof key === "string" && MASTER_KEY_SHAPE.test(key);
    if (!valid && environment("NODE_ENV") === "production") {
      throw new Error(
        `${CREDENTIAL_MASTER_KEY_ENV} must be a 64-character hex string (32 bytes) in production \u2014 generate one with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
      );
    }
    this.masterKeyHex = valid ? key : void 0;
    const prev = previousMasterKey ?? environment(CREDENTIAL_PREVIOUS_MASTER_KEY_ENV);
    this.previousKeyHex = typeof prev === "string" && MASTER_KEY_SHAPE.test(prev) ? prev : void 0;
  }
  /** True when a valid master key is present (writes and decryption enabled). */
  get enabled() {
    return this.masterKeyHex !== void 0;
  }
  /** Subscribe to credential changes; returns an unsubscribe function. */
  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  notify(principal) {
    for (const listener of this.listeners) listener(principal);
  }
  async encrypt(plaintext, identity) {
    if (!this.masterKeyHex) {
      throw new Error(`${CREDENTIAL_MASTER_KEY_ENV} is not configured \u2014 cannot store credentials`);
    }
    const iv = globalThis.crypto.getRandomValues(new Uint8Array(IV_BYTES));
    const key = await globalThis.crypto.subtle.importKey("raw", fromHex(this.masterKeyHex), "AES-GCM", false, ["encrypt"]);
    const sealed = new Uint8Array(
      await globalThis.crypto.subtle.encrypt(
        { name: "AES-GCM", iv, tagLength: TAG_BYTES * 8, ...identity?.principal !== void 0 ? { additionalData: utf8(credentialStorageKey(identity)) } : {} },
        key,
        utf8(plaintext)
      )
    );
    return {
      ciphertext: toHex(sealed.subarray(0, sealed.length - TAG_BYTES)),
      iv: toHex(iv),
      authTag: toHex(sealed.subarray(sealed.length - TAG_BYTES)),
      keyId: await keyIdOf(this.masterKeyHex)
    };
  }
  async decryptWithKey(keyHex, ciphertext, ivHex, authTagHex, identity) {
    const key = await globalThis.crypto.subtle.importKey("raw", fromHex(keyHex), "AES-GCM", false, ["decrypt"]);
    const body = fromHex(ciphertext);
    const tag = fromHex(authTagHex);
    const joined = new Uint8Array(body.length + tag.length);
    joined.set(body, 0);
    joined.set(tag, body.length);
    const plain = await globalThis.crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromHex(ivHex), tagLength: TAG_BYTES * 8, ...identity?.principal !== void 0 ? { additionalData: utf8(credentialStorageKey(identity)) } : {} },
      key,
      joined
    );
    return new TextDecoder().decode(plain);
  }
  /**
   * Decrypt one row, selecting the key by the row's stamped `keyId` (I-28):
   * current key first, then the rotation-window previous key. Legacy rows
   * (no `keyId`) try current then previous. Returns null when no held key
   * decrypts the row — the row is unreadable, never silently wrong (GCM
   * auth tags make a wrong-key success impossible).
   */
  async decryptRow(ciphertext, ivHex, authTagHex, rowKeyId, identity) {
    if (!this.masterKeyHex) {
      throw new Error(`${CREDENTIAL_MASTER_KEY_ENV} is not configured \u2014 cannot decrypt credentials`);
    }
    const candidates = [];
    if (rowKeyId === void 0 || rowKeyId === await keyIdOf(this.masterKeyHex)) {
      candidates.push(this.masterKeyHex);
    }
    if (this.previousKeyHex !== void 0 && (rowKeyId === void 0 || rowKeyId === await keyIdOf(this.previousKeyHex))) {
      candidates.push(this.previousKeyHex);
    }
    for (const key of candidates) {
      try {
        return await this.decryptWithKey(key, ciphertext, ivHex, authTagHex, identity);
      } catch {
      }
    }
    return null;
  }
  /**
   * Load and decrypt every stored row into memory. Returns the number of
   * resolvable credentials. Without a master key nothing decrypts (rows are
   * left in place, resolution falls through to env).
   */
  async warm() {
    this.byIdentity.clear();
    this.warmed = true;
    if (!this.enabled) return 0;
    const rows = await this.adapter.list(CREDENTIAL_ENTITY_TYPE);
    for (const row of rows) {
      const { id, service, envVar, ciphertext, iv, authTag, principal } = row;
      if (!isNonEmptyString(id) || !isNonEmptyString(service) || !isNonEmptyString(envVar) || typeof ciphertext !== "string" || !isNonEmptyString(iv) || !isNonEmptyString(authTag) || principal !== void 0 && !isNonEmptyString(principal)) {
        continue;
      }
      const value = await this.decryptRow(
        ciphertext,
        iv,
        authTag,
        isNonEmptyString(row.keyId) ? row.keyId : void 0,
        { name: envVar, ...principal !== void 0 ? { principal } : {} }
      );
      if (value === null) continue;
      this.byIdentity.set(credentialStorageKey({ name: envVar, ...principal !== void 0 ? { principal } : {} }), {
        id,
        service,
        envVar,
        value,
        last4: value.slice(-4),
        updatedAt: typeof row.updatedAt === "number" ? row.updatedAt : 0,
        ...isNonEmptyString(row.label) ? { label: row.label } : {},
        ...principal !== void 0 ? { principal } : {}
      });
    }
    return this.byIdentity.size;
  }
  /** Resolve one credential by env-var name (warmed values only). */
  resolve(envVar, principal) {
    return this.byIdentity.get(credentialStorageKey({ name: envVar, ...principal !== void 0 ? { principal } : {} }))?.value;
  }
  /** The non-secret account label stored in the clear beside a credential's ciphertext; undefined when its row carries none. */
  label(envVar, principal) {
    return this.byIdentity.get(credentialStorageKey({ name: envVar, ...principal !== void 0 ? { principal } : {} }))?.label;
  }
  /** All warmed values as an env-shaped map, for merging over the process env. */
  snapshotEnv() {
    const env = {};
    for (const entry of this.byIdentity.values()) {
      if (entry.principal === void 0) env[entry.envVar] = entry.value;
    }
    return env;
  }
  /** Masked entries for display — never includes plaintext. */
  entries(principal) {
    return Array.from(this.byIdentity.values()).filter((entry) => entry.principal === principal).map(({ service, envVar, last4, updatedAt, principal: owner }) => ({ service, envVar, last4, updatedAt, ...owner !== void 0 ? { principal: owner } : {} })).sort((a, b) => a.service.localeCompare(b.service) || a.envVar.localeCompare(b.envVar));
  }
  /**
   * Upsert one credential (encrypts, persists, re-warms the entry, notifies). `label` is a non-secret account name kept
   * in the clear in the row beside the ciphertext; left out, the row's label stays as it is.
   */
  async set(service, envVar, value, principal, label) {
    if (principal !== void 0 && !isNonEmptyString(principal)) throw new Error("credential principal must be a nonempty string");
    if (label !== void 0 && !isNonEmptyString(label)) throw new Error("credential label must be a nonempty string");
    if (!this.warmed) await this.warm();
    const identity = { name: envVar, ...principal !== void 0 ? { principal } : {} };
    const storageKey = credentialStorageKey(identity);
    const { ciphertext, iv, authTag, keyId } = await this.encrypt(value, identity);
    const updatedAt = Date.now();
    const existing = this.byIdentity.get(storageKey);
    const data = { service, envVar, ciphertext, iv, authTag, keyId, updatedAt, ...principal !== void 0 ? { principal } : {}, ...label !== void 0 ? { label } : {} };
    let id;
    if (existing) {
      id = existing.id;
      await this.adapter.update(CREDENTIAL_ENTITY_TYPE, id, data);
    } else {
      ({ id } = await this.adapter.create(CREDENTIAL_ENTITY_TYPE, data));
    }
    const kept = label ?? existing?.label;
    const entry = { id, service, envVar, value, last4: value.slice(-4), updatedAt, ...kept !== void 0 ? { label: kept } : {}, ...principal !== void 0 ? { principal } : {} };
    this.byIdentity.set(storageKey, entry);
    this.notify(principal);
    const { service: s, envVar: e, last4, updatedAt: u } = entry;
    return { service: s, envVar: e, last4, updatedAt: u, ...principal !== void 0 ? { principal } : {} };
  }
  /**
   * Re-encrypt every readable row under the CURRENT master key (I-28).
   * Rotation window: deploy the new key as `ALMADAR_CREDENTIAL_MASTER_KEY`
   * with the old one as `..._PREVIOUS`, call `rotate()`, then retire the
   * previous key. Rows no held key can read are counted, never dropped.
   */
  async rotate() {
    if (!this.masterKeyHex) {
      throw new Error(`${CREDENTIAL_MASTER_KEY_ENV} is not configured \u2014 cannot rotate`);
    }
    const currentKeyId = await keyIdOf(this.masterKeyHex);
    let rotated = 0;
    let alreadyCurrent = 0;
    let unreadable = 0;
    const rows = await this.adapter.list(CREDENTIAL_ENTITY_TYPE);
    for (const row of rows) {
      const { id, service, envVar, ciphertext, iv, authTag, principal } = row;
      if (!isNonEmptyString(id) || !isNonEmptyString(service) || !isNonEmptyString(envVar) || typeof ciphertext !== "string" || !isNonEmptyString(iv) || !isNonEmptyString(authTag) || principal !== void 0 && !isNonEmptyString(principal)) {
        unreadable += 1;
        continue;
      }
      const rowKeyId = isNonEmptyString(row.keyId) ? row.keyId : void 0;
      const identity = { name: envVar, ...principal !== void 0 ? { principal } : {} };
      const value = await this.decryptRow(ciphertext, iv, authTag, rowKeyId, identity);
      if (value === null) {
        unreadable += 1;
        continue;
      }
      if (rowKeyId === currentKeyId) {
        alreadyCurrent += 1;
        continue;
      }
      if (rowKeyId === void 0 && await this.decryptRow(ciphertext, iv, authTag, currentKeyId, identity) !== null) {
        alreadyCurrent += 1;
        await this.adapter.update(CREDENTIAL_ENTITY_TYPE, id, { ...row, keyId: currentKeyId });
        continue;
      }
      const fresh = await this.encrypt(value, identity);
      await this.adapter.update(CREDENTIAL_ENTITY_TYPE, id, {
        service,
        envVar,
        ciphertext: fresh.ciphertext,
        iv: fresh.iv,
        authTag: fresh.authTag,
        keyId: fresh.keyId,
        updatedAt: Date.now(),
        ...principal !== void 0 ? { principal } : {}
      });
      rotated += 1;
    }
    await this.warm();
    this.notify();
    return { rotated, alreadyCurrent, unreadable };
  }
  /** Whether one-use values are shared through the adapter: a master key and an adapter that reads a row by id. */
  get sharesDerived() {
    return this.enabled && keepsDerived(this.adapter);
  }
  /** Keep `value` encrypted in the adapter until `expiresAt` (epoch ms) so any instance on the same store can take it once. */
  async holdDerived(name, value, expiresAt, principal) {
    const adapter = this.adapter;
    if (!this.enabled || !keepsDerived(adapter)) throw new Error("this host cannot share one-use values through its credential store");
    const identity = { name, ...principal !== void 0 ? { principal } : {} };
    const id = await derivedId(identity);
    const { ciphertext, iv, authTag, keyId } = await this.encrypt(value, identity);
    const fields = { envVar: name, ciphertext, iv, authTag, keyId, expiresAt, ...principal !== void 0 ? { principal } : {} };
    if (await adapter.getById(DERIVED_ENTITY_TYPE, id) !== null) await adapter.update(DERIVED_ENTITY_TYPE, id, fields);
    else await adapter.create(DERIVED_ENTITY_TYPE, { id, ...fields });
  }
  /**
   * Remove and return a held value. Where the adapter has a conditional delete only the instance whose delete
   * lands gets the value; elsewhere the delete is unconditional, so two instances racing for one state can both
   * read it. An expired value is consumed and not returned.
   */
  async takeDerived(name, principal, now) {
    const adapter = this.adapter;
    if (!this.enabled || !keepsDerived(adapter)) return void 0;
    const identity = { name, ...principal !== void 0 ? { principal } : {} };
    const id = await derivedId(identity);
    const row = await adapter.getById(DERIVED_ENTITY_TYPE, id);
    if (row === null) return void 0;
    const conditional = adapter.writeCapabilities?.(DERIVED_ENTITY_TYPE)?.conditional === true;
    const outcome = conditional ? await adapter.writeWhere?.({ kind: "delete", entityType: DERIVED_ENTITY_TYPE, id }) : void 0;
    if (outcome !== void 0) {
      if (outcome.kind !== "deleted") return void 0;
    } else {
      await adapter.delete(DERIVED_ENTITY_TYPE, id);
    }
    const { ciphertext, iv, authTag, expiresAt } = row;
    if (typeof expiresAt !== "number" || expiresAt <= now) return void 0;
    if (typeof ciphertext !== "string" || !isNonEmptyString(iv) || !isNonEmptyString(authTag)) return void 0;
    return await this.decryptRow(ciphertext, iv, authTag, isNonEmptyString(row.keyId) ? row.keyId : void 0, identity) ?? void 0;
  }
  /** Delete one credential row; resolution falls back to env afterwards. */
  async remove(envVar, principal) {
    if (!this.warmed) await this.warm();
    const storageKey = credentialStorageKey({ name: envVar, ...principal !== void 0 ? { principal } : {} });
    const existing = this.byIdentity.get(storageKey);
    if (!existing) return false;
    await this.adapter.delete(CREDENTIAL_ENTITY_TYPE, existing.id);
    this.byIdentity.delete(storageKey);
    this.notify(principal);
    return true;
  }
};

export { CREDENTIAL_ENTITY_TYPE, CREDENTIAL_MASTER_KEY_ENV, CREDENTIAL_PREVIOUS_MASTER_KEY_ENV, CredentialStore, DERIVED_ENTITY_TYPE };

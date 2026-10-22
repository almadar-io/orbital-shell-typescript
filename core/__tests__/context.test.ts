/**
 * ContextExtensions declaration-merging smoke test.
 *
 * Verifies that a consumer can augment the empty `ContextExtensions`
 * interface exported from `@almadar/core` using TypeScript's declaration
 * merging. This is the sanctioned way for app code and generated code to
 * thread framework-level context without reaching for `unknown`.
 */

import { describe, it, expect } from "vitest";
import type { ContextExtensions } from "../index";

// Augment the core interface with app-specific fields.
declare module "../index" {
  interface ContextExtensions {
    auth?: { userId: string };
    agent?: { traceId: string };
  }
}

describe("ContextExtensions", () => {
  it("admits augmented fields at compile time", () => {
    const ext: ContextExtensions = {
      auth: { userId: "u-1" },
      agent: { traceId: "t-1" },
    };
    expect(ext.auth?.userId).toBe("u-1");
    expect(ext.agent?.traceId).toBe("t-1");
  });

  it("admits an empty object (the un-augmented base shape)", () => {
    const ext: ContextExtensions = {};
    expect(Object.keys(ext)).toHaveLength(0);
  });
});

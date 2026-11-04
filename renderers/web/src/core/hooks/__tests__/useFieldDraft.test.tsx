// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useFieldDraft } from "../useFieldDraft";

describe("G-CROSS-415 field draft echo policy", () => {
  it("keeps rapid edits through delayed echoes and accepts an external clear", () => {
    const view = renderHook(({ value }) => useFieldDraft(value, true), {
      initialProps: { value: "" },
    });
    act(() => {
      view.result.current.record("A");
      view.result.current.record("AB");
    });
    expect(view.result.current.displayValue).toBe("AB");
    view.rerender({ value: "A" });
    expect(view.result.current.displayValue).toBe("AB");
    view.rerender({ value: "AB" });
    expect(view.result.current.displayValue).toBe("AB");
    view.rerender({ value: "" });
    expect(view.result.current.displayValue).toBe("");
  });

  it("uses the same echo policy for multi-select values", () => {
    const view = renderHook(({ value }) => useFieldDraft(value, true), {
      initialProps: { value: [] as string[] },
    });
    act(() => {
      view.result.current.record(["one"]);
      view.result.current.record(["one", "two"]);
    });
    view.rerender({ value: ["one"] });
    expect(view.result.current.displayValue).toEqual(["one", "two"]);
    view.rerender({ value: ["one", "two"] });
    view.rerender({ value: [] });
    expect(view.result.current.displayValue).toEqual([]);
  });
});

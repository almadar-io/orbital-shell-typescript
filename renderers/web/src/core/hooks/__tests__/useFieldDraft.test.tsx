// @vitest-environment jsdom
import React from "react";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FieldPaintContext, useFieldDraft } from "../useFieldDraft";

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

  it("G-CROSS-699: a new paint of a field whose trait never echoes edits resets the draft to the painted value", () => {
    let paint: object = {};
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <FieldPaintContext.Provider value={paint}>{children}</FieldPaintContext.Provider>
    );
    const view = renderHook(({ value }) => useFieldDraft(value, true), { initialProps: { value: "" }, wrapper });
    act(() => view.result.current.record("Second note"));
    expect(view.result.current.displayValue).toBe("Second note");
    view.rerender({ value: "" });
    expect(view.result.current.displayValue).toBe("Second note");
    paint = {};
    view.rerender({ value: "" });
    expect(view.result.current.displayValue).toBe("");
  });

  it("control: a field whose trait echoes edits keeps a newer draft across a repaint with an older value", () => {
    let paint: object = {};
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <FieldPaintContext.Provider value={paint}>{children}</FieldPaintContext.Provider>
    );
    const view = renderHook(({ value }) => useFieldDraft(value, true), { initialProps: { value: "" }, wrapper });
    act(() => view.result.current.record("a"));
    paint = {};
    view.rerender({ value: "a" });
    act(() => view.result.current.record("ab"));
    paint = {};
    view.rerender({ value: "a" });
    expect(view.result.current.displayValue).toBe("ab");
  });

  it("control: a new paint of an uncontrolled field keeps the typed text", () => {
    let paint: object = {};
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <FieldPaintContext.Provider value={paint}>{children}</FieldPaintContext.Provider>
    );
    const view = renderHook(({ value }: { value: string | undefined }) => useFieldDraft(value, true), { initialProps: { value: undefined }, wrapper });
    act(() => view.result.current.record("query"));
    paint = {};
    view.rerender({ value: undefined });
    expect(view.result.current.displayValue).toBe("query");
  });
});

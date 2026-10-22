import { describe, expect, it } from "vitest";
import {
  ACTION_OVERFLOW_TESTID,
  ACTION_TESTID_PREFIX,
  FORM_PATTERN,
  NATIVE_ID_PREFIX,
  VERIFICATION_DOM_ATTRS,
  actionTestId,
  actionTestIdMatches,
  gestureActionTestId,
  gestureOfActionTestId,
  GESTURE_EVENT_PROPS,
  nativeIds,
  splitNativeIds,
  nativeFieldId,
  nativePatternId,
  nativeRowId,
  nativeSlotId,
} from "../src/types/index.js";

describe("actionTestId", () => {
  it("prefixes a bare event", () => {
    expect(actionTestId("SAVE")).toBe("action-SAVE");
  });

  it("prefixes a qualified bus key verbatim", () => {
    expect(actionTestId("Notes.NoteBrowse.SAVE")).toBe("action-Notes.NoteBrowse.SAVE");
  });

  it("keeps the overflow id in the same vocabulary", () => {
    expect(ACTION_OVERFLOW_TESTID.startsWith(ACTION_TESTID_PREFIX)).toBe(true);
  });
});

describe("actionTestIdMatches", () => {
  it("matches the exact bare form", () => {
    expect(actionTestIdMatches("action-SAVE", "SAVE")).toBe(true);
  });

  it("matches a qualified form ending in .EVENT", () => {
    expect(actionTestIdMatches("action-Notes.NoteBrowse.SAVE", "SAVE")).toBe(true);
  });

  it("matches a qualified event against its exact qualified id", () => {
    expect(actionTestIdMatches("action-Notes.NoteBrowse.SAVE", "Notes.NoteBrowse.SAVE")).toBe(true);
  });

  it("rejects an event that only shares a prefix", () => {
    expect(actionTestIdMatches("action-SAVE_DRAFT", "SAVE")).toBe(false);
  });

  it("rejects a qualified event that only shares a prefix", () => {
    expect(actionTestIdMatches("action-Notes.Browse.SAVE_DRAFT", "SAVE")).toBe(false);
  });

  it("rejects a suffix match without the dot boundary", () => {
    expect(actionTestIdMatches("action-AUTOSAVE", "SAVE")).toBe(false);
  });

  it("rejects ids outside the action vocabulary", () => {
    expect(actionTestIdMatches("pattern-SAVE", "SAVE")).toBe(false);
    expect(actionTestIdMatches("x.SAVE", "SAVE")).toBe(false);
  });
});

describe("native ids", () => {
  it("prefix pattern, row and field names", () => {
    expect(nativePatternId("data-list")).toBe(`${NATIVE_ID_PREFIX.pattern}data-list`);
    expect(nativeRowId("42")).toBe("row-42");
    expect(nativeFieldId("title")).toBe("field-title");
    expect(nativeSlotId("modal")).toBe("slot-modal");
  });

  it("use prefixes disjoint from the action vocabulary", () => {
    for (const prefix of Object.values(NATIVE_ID_PREFIX)) {
      expect(prefix.startsWith(ACTION_TESTID_PREFIX)).toBe(false);
      expect(actionTestIdMatches(`${prefix}SAVE`, "SAVE")).toBe(false);
    }
  });
});

describe("web DOM attributes", () => {
  it("are data-* attributes", () => {
    for (const attr of Object.values(VERIFICATION_DOM_ATTRS)) {
      expect(attr.startsWith("data-")).toBe(true);
    }
  });

  it("name the form container by its pattern", () => {
    expect(FORM_PATTERN).toBe("form-section");
  });
});

describe("gesture actions", () => {
  it("a gesture-only affordance has its own id; a tap keeps the plain action id", () => {
    expect(gestureActionTestId("NEXT_WEEK", "swipe-left")).toBe("action-swipe-left:NEXT_WEEK");
    expect(gestureActionTestId("OPEN", "long-press")).toBe("action-long-press:OPEN");
    expect(gestureActionTestId("OPEN", "tap")).toBe(actionTestId("OPEN"));
  });

  it("reads the gesture back from an id, for the exact and the qualified event", () => {
    expect(gestureOfActionTestId("action-long-press:OPEN", "OPEN")).toBe("long-press");
    expect(gestureOfActionTestId("action-swipe-right:App.Cal.PREV", "PREV")).toBe("swipe-right");
    expect(gestureOfActionTestId("action-OPEN", "OPEN")).toBe("tap");
  });

  it("control: another event, or a non-action id, has no gesture", () => {
    expect(gestureOfActionTestId("action-long-press:OPEN", "CLOSE")).toBeNull();
    expect(gestureOfActionTestId("row-1", "OPEN")).toBeNull();
    expect(gestureOfActionTestId("action-wiggle:OPEN", "OPEN")).toBeNull();
  });

  it("names the gesture each gesture prop declares", () => {
    expect(GESTURE_EVENT_PROPS).toEqual({
      longPressEvent: "long-press",
      swipeLeftEvent: "swipe-left",
      swipeRightEvent: "swipe-right",
    });
  });
});

describe("native multi-action identifiers", () => {
  it("joins the ids an element carries, skipping empty ones", () => {
    expect(nativeIds("action-OPEN", "", "action-long-press:HOLD")).toBe("action-OPEN action-long-press:HOLD");
    expect(splitNativeIds("action-OPEN action-long-press:HOLD")).toEqual(["action-OPEN", "action-long-press:HOLD"]);
  });

  it("control: one id round-trips unchanged and an empty identifier has none", () => {
    expect(nativeIds("row-1")).toBe("row-1");
    expect(splitNativeIds("row-1")).toEqual(["row-1"]);
    expect(splitNativeIds("")).toEqual([]);
  });
});

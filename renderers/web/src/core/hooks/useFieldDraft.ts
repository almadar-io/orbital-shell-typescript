import React from "react";

function echoKey(value: string | number | readonly string[] | undefined): string {
  return Array.isArray(value) ? JSON.stringify(value) : String(value ?? "");
}

/**
 * Identity of the paint a field belongs to: the slot renderer provides the node's props object, which is new each
 * time the owning trait renders again and stable across React re-renders in between.
 */
export const FieldPaintContext = React.createContext<object | null>(null);

export function useFieldDraft<T extends string | number | readonly string[] | undefined>(
  value: T,
  declarative: boolean,
): { displayValue: T; record: (next: T) => void } {
  const [draft, setDraft] = React.useState<T>(value);
  const pending = React.useRef<Set<string>>(new Set());
  const echoes = React.useRef(false);
  const lastKey = React.useRef(echoKey(value));
  const paint = React.useContext(FieldPaintContext);

  React.useEffect(() => {
    if (!declarative) return;
    // G-CROSS-415: pending echoes acknowledge edits; external values replace the draft.
    const key = echoKey(value);
    const changed = key !== lastKey.current;
    lastKey.current = key;
    if (pending.current.has(key)) {
      pending.current.delete(key);
      echoes.current = true;
      return;
    }
    // G-CROSS-699: a trait that never echoes edits repaints with the same bound value after it resets the field.
    if (!changed && (value === undefined || echoes.current)) return;
    pending.current.clear();
    setDraft(value);
  }, [value, declarative, paint]);

  const record = React.useCallback((next: T) => {
    pending.current.add(echoKey(next));
    setDraft(next);
  }, []);

  return { displayValue: declarative ? draft : value, record };
}

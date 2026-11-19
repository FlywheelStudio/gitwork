"use client";
import { type Frontmatter, type TextChange, addFrontmatterKey, parseFrontmatter, removeFrontmatterKey, setFrontmatterValue } from "@gitwork/core";
import { useState } from "react";
import { Input } from "@/components/kit";

/**
 * Properties from the doc's frontmatter. Each edit is one text change on one line, applied
 * through the editor (so undo works and nothing else in the file moves).
 */
export function FrontmatterPanel(props: { text: string; readOnly: boolean; lineBreak: string; onChange: (change: TextChange) => void }) {
  const fm: Frontmatter | null = parseFrontmatter(props.text);
  const [adding, setAdding] = useState(false);
  const [key, setKey] = useState("");
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  if (!fm && props.readOnly) return null;

  const apply = (change: TextChange | null, message: string) => {
    if (!change) return setError(message);
    setError("");
    props.onChange(change);
  };

  return (
    <section aria-label="Properties" className="rounded-lg border border-border bg-muted/20 px-3 py-2 text-sm">
      {fm && fm.entries.length > 0 && (
        <dl className="grid grid-cols-[minmax(6rem,auto)_1fr_auto] items-center gap-x-3 gap-y-1">
          {fm.entries.map((e) => (
            <div key={`${e.key}:${e.lineFrom}`} className="contents">
              <dt className="truncate text-muted-foreground">{e.key}</dt>
              <dd className="min-w-0">
                {e.editable && !props.readOnly ? (
                  <Input
                    aria-label={`Property ${e.key}`}
                    defaultValue={e.value}
                    key={`${e.valueFrom}:${e.value}`}
                    className="h-7"
                    onKeyDown={(ev) => {
                      if (ev.key === "Enter") (ev.target as HTMLInputElement).blur();
                    }}
                    onBlur={(ev) => {
                      if (ev.target.value !== e.value) apply(setFrontmatterValue(props.text, e.key, ev.target.value), "This value cannot change here.");
                    }}
                  />
                ) : (
                  <span className="block truncate font-mono text-xs" title={e.editable ? undefined : "Edit lists and nested values in the source."}>
                    {e.value || "—"}
                  </span>
                )}
              </dd>
              <dd>
                {!props.readOnly && (
                  <button type="button" aria-label={`Remove ${e.key}`} className="px-1 text-muted-foreground hover:text-foreground" onClick={() => apply(removeFrontmatterKey(props.text, e.key), "")}>
                    ×
                  </button>
                )}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {!props.readOnly &&
        (adding ? (
          <form
            className="mt-2 flex gap-2"
            onSubmit={(ev) => {
              ev.preventDefault();
              apply(addFrontmatterKey(props.text, key.trim(), value, props.lineBreak), "Use letters, digits, - and _ for a new property name, and no duplicates.");
              setKey("");
              setValue("");
              setAdding(false);
            }}
          >
            <Input aria-label="Property name" placeholder="name" value={key} onChange={(e) => setKey(e.target.value)} className="h-7 w-32" autoFocus />
            <Input aria-label="Property value" placeholder="value" value={value} onChange={(e) => setValue(e.target.value)} className="h-7" />
            <button type="submit" className="text-xs font-medium">
              Add
            </button>
          </form>
        ) : (
          <button type="button" className="mt-1 text-xs text-muted-foreground hover:text-foreground" onClick={() => setAdding(true)}>
            + Add property
          </button>
        ))}
      {error && (
        <p role="alert" className="mt-1 text-xs text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}

"use client";
import { MergeView } from "@codemirror/merge";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { useEffect, useRef } from "react";
import { Button } from "@/components/kit";
import { docExtensions, docText } from "@/lib/doc-editor";

/**
 * Someone changed the doc on GitHub since it was opened (decision 011). Left: GitHub's version.
 * Right: this person's version, editable. They keep editing the right side, then save it on top
 * of GitHub's version, or drop theirs.
 */
export function ConflictView(props: {
  theirs: string;
  mine: string;
  busy: boolean;
  onSave: (merged: string) => void;
  onKeepEditing: (merged: string) => void;
  onUseTheirs: () => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<MergeView | null>(null);
  useEffect(() => {
    const merge = new MergeView({
      a: { doc: props.theirs, extensions: [...docExtensions(props.theirs), EditorState.readOnly.of(true), EditorView.lineWrapping] },
      b: { doc: props.mine, extensions: [...docExtensions(props.mine), EditorView.lineWrapping] },
      parent: host.current!,
      collapseUnchanged: { margin: 3, minSize: 6 },
    });
    view.current = merge;
    return () => merge.destroy();
  }, [props.theirs, props.mine]);
  const merged = () => (view.current ? docText(view.current.b.state) : props.mine);

  return (
    <section aria-label="Resolve changes" className="space-y-3">
      <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100">
        Someone changed this doc on GitHub since you opened it. Left: the version on GitHub. Right: your version. Edit the right side, then save it.
      </div>
      <div className="grid grid-cols-2 text-xs font-medium text-muted-foreground">
        <span>On GitHub</span>
        <span>Yours</span>
      </div>
      <div ref={host} className="overflow-hidden rounded-lg border border-border text-sm" />
      <div className="flex flex-wrap gap-2">
        <Button disabled={props.busy} onClick={() => props.onSave(merged())}>
          Save my version
        </Button>
        <Button variant="secondary" disabled={props.busy} onClick={() => props.onKeepEditing(merged())}>
          Keep editing
        </Button>
        <Button variant="ghost" disabled={props.busy} onClick={props.onUseTheirs}>
          Discard mine, use GitHub&apos;s
        </Button>
      </div>
    </section>
  );
}

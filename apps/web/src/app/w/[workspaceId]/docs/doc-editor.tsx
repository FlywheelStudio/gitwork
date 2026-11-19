"use client";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { syntaxHighlighting } from "@codemirror/language";
import { searchKeymap } from "@codemirror/search";
import { Compartment, EditorState } from "@codemirror/state";
import { EditorView, drawSelection, dropCursor, keymap, placeholder } from "@codemirror/view";
import { MAX_EDITABLE_BYTES, type TextChange, folderOf, joinRoot, lineSeparatorOf, relativeLink, resolveRelative, safeFileName } from "@gitwork/core";
import type { DocView, Editor } from "@gitwork/server";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Input } from "@/components/kit";
import { changeSpec, docExtensions, docText } from "@/lib/doc-editor";
import { livePreview, markdownHighlight } from "@/lib/live-preview";
import { insertLink, run, setLinePrefix, toggleWrap } from "@/lib/markdown-commands";
import { ConflictView } from "./conflict-view";
import { DocsApiError, docsApi } from "./docs-api";
import { FrontmatterPanel } from "./frontmatter-panel";
import { docHref, rawHref } from "./links";

const MAX_IMAGE_BYTES = 10_000_000;
const MODE_KEY = "gitwork.docs.mode";
type Mode = "preview" | "source";
type Status = { kind: "idle" | "dirty" | "saving" | "saved" | "error"; text: string };

function storedMode(): Mode {
  try {
    return localStorage.getItem(MODE_KEY) === "source" ? "source" : "preview";
  } catch {
    return "preview";
  }
}

function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export function DocEditor(props: { workspaceId: string; repoNodeId: string; path: string }) {
  const { workspaceId, repoNodeId, path } = props;
  const router = useRouter();
  const docs = useMemo(() => docsApi(workspaceId), [workspaceId]);
  const [doc, setDoc] = useState<DocView | null>(null);
  const [loadError, setLoadError] = useState("");
  // What the editor shows: replaced on load and after a conflict is resolved.
  const [source, setSource] = useState<{ text: string; sha: string; dirty: boolean; key: number } | null>(null);
  const [status, setStatus] = useState<Status>({ kind: "idle", text: "" });
  const [mirror, setMirror] = useState("");
  const [conflict, setConflict] = useState<{ theirs: { sha: string; text: string | null }; mine: string } | null>(null);
  const [mode, setMode] = useState<Mode>("preview");
  const [editors, setEditors] = useState<Editor[]>([]);
  const [renaming, setRenaming] = useState(false);
  const [newName, setNewName] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const host = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const baseSha = useRef("");
  const images = useRef(new Map<string, { data: string; url: string; link: string }>());
  const preview = useRef(new Compartment());
  const saveRef = useRef<() => void>(() => {});
  const saving = useRef(false);

  // ---- Load ----
  useEffect(() => {
    let live = true;
    docs
      .get(repoNodeId, path)
      .then((d) => {
        if (!live) return;
        setMode(storedMode());
        setDoc(d);
        baseSha.current = d.sha;
        setSource({ text: d.text ?? "", sha: d.sha, dirty: false, key: Date.now() });
      })
      .catch((e: Error) => live && setLoadError(e.message));
    return () => {
      live = false;
    };
  }, [docs, repoNodeId, path]);

  const resolveImage = useCallback(
    (src: string) => {
      if (/^https:\/\//i.test(src)) return src;
      const abs = resolveRelative(path, src);
      if (!abs) return null;
      return images.current.get(abs)?.url ?? rawHref(workspaceId, repoNodeId, abs);
    },
    [path, workspaceId, repoNodeId],
  );

  const addImages = useCallback(
    async (files: File[]) => {
      const view = viewRef.current;
      if (!view || !doc?.editable) return false;
      const list = files.filter((f) => f.type.startsWith("image/"));
      if (list.length === 0) return false;
      for (const file of list) {
        if (file.size > MAX_IMAGE_BYTES) {
          setStatus({ kind: "error", text: `${file.name} is larger than 10 MB.` });
          continue;
        }
        const base = safeFileName(file.name || "image.png");
        const dot = base.lastIndexOf(".");
        const name = `${base.slice(0, dot > 0 ? dot : undefined)}-${Date.now().toString(36)}${dot > 0 ? base.slice(dot) : ".png"}`;
        // Next to the doc: <its folder>/assets/ (decision 038).
        const abs = joinRoot(folderOf(path), `assets/${name}`);
        const link = relativeLink(path, abs);
        images.current.set(abs, { data: await toBase64(file), url: URL.createObjectURL(file), link });
        const alt = (file.name || "image").replace(/\.[^.]+$/, "").replace(/[[\]]/g, "");
        view.dispatch(view.state.replaceSelection(`![${alt}](${link})`), { userEvent: "input.paste" });
      }
      return true;
    },
    [doc, path],
  );

  // ---- Editor ----
  useEffect(() => {
    if (!source || !doc || !host.current) return;
    const editable = doc.editable;
    let frame = 0;
    const view = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: source.text,
        extensions: [
          ...docExtensions(source.text),
          history(),
          drawSelection(),
          dropCursor(),
          keymap.of([
            { key: "Mod-s", preventDefault: true, run: () => (saveRef.current(), true) },
            { key: "Mod-b", run: (v) => run(v, (s) => toggleWrap(s, "**")) },
            { key: "Mod-i", run: (v) => run(v, (s) => toggleWrap(s, "*")) },
            ...defaultKeymap,
            ...historyKeymap,
            ...searchKeymap,
            indentWithTab,
          ]),
          markdown({ base: markdownLanguage }),
          syntaxHighlighting(markdownHighlight),
          EditorView.lineWrapping,
          EditorState.readOnly.of(!editable),
          EditorView.editable.of(editable),
          placeholder(editable ? "Start writing…" : ""),
          preview.current.of(storedMode() === "preview" ? livePreview({ resolveImage }) : []),
          EditorView.updateListener.of((u) => {
            if (!u.docChanged) return;
            setStatus({ kind: "dirty", text: "Unsaved changes" });
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(() => setMirror(docText(u.state)));
          }),
          EditorView.domEventHandlers({
            paste: (e) => {
              const files = [...(e.clipboardData?.files ?? [])];
              if (files.some((f) => f.type.startsWith("image/"))) {
                e.preventDefault();
                void addImages(files);
                return true;
              }
              return false;
            },
            drop: (e) => {
              const files = [...(e.dataTransfer?.files ?? [])];
              if (files.some((f) => f.type.startsWith("image/"))) {
                e.preventDefault();
                void addImages(files);
                return true;
              }
              return false;
            },
          }),
          EditorView.theme({
            "&": { fontSize: "15px" },
            "&.cm-focused": { outline: "none" },
            ".cm-content": { fontFamily: "inherit", padding: "12px 0 40vh", caretColor: "var(--foreground)" },
            ".cm-line": { padding: "0 2px", lineHeight: "1.65" },
            ".cm-scroller": { fontFamily: "inherit" },
          }),
        ],
      }),
    });
    viewRef.current = view;
    setMirror(source.text);
    setStatus(source.dirty ? { kind: "dirty", text: "Unsaved changes" } : { kind: "idle", text: "" });
    return () => {
      cancelAnimationFrame(frame);
      view.destroy();
      viewRef.current = null;
    };
    // The editor is rebuilt only when the content source changes, never on each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source?.key, doc?.editable]);

  function switchMode(next: Mode) {
    setMode(next);
    try {
      localStorage.setItem(MODE_KEY, next);
    } catch {
      // Private windows: the choice lasts until the page closes.
    }
    viewRef.current?.dispatch({ effects: preview.current.reconfigure(next === "preview" ? livePreview({ resolveImage }) : []) });
  }

  // ---- Save ----
  async function save(textOverride?: string) {
    const view = viewRef.current;
    if (!doc?.editable || saving.current) return;
    const text = textOverride ?? (view ? docText(view.state) : null);
    if (text === null) return;
    if (new TextEncoder().encode(text).length > MAX_EDITABLE_BYTES) {
      setStatus({ kind: "error", text: "This doc is larger than 1 MB. Split it, or edit it on GitHub." });
      return;
    }
    const attachments = [...images.current].filter(([, img]) => text.includes(img.link)).map(([p, img]) => ({ path: p, data: img.data }));
    saving.current = true;
    setStatus({ kind: "saving", text: "Saving to GitHub…" });
    try {
      const out = await docs.save({ repoNodeId, path, baseSha: baseSha.current, text, attachments: attachments.length ? attachments : undefined });
      baseSha.current = out.sha ?? baseSha.current;
      for (const a of attachments) images.current.delete(a.path);
      const changedSince = viewRef.current ? docText(viewRef.current.state) !== text : false;
      if (out.status === "pending_review") {
        setDoc((d) => (d ? { ...d, pending: out.pr, branch: out.pr.branch, canDelete: false } : d));
        setStatus({ kind: changedSince ? "dirty" : "saved", text: changedSince ? "Unsaved changes" : `Saved to pull request #${out.pr.number}` });
      } else if (out.status === "committed") {
        setStatus({ kind: changedSince ? "dirty" : "saved", text: changedSince ? "Unsaved changes" : `Saved · ${out.commitSha.slice(0, 7)}` });
      } else {
        setStatus({ kind: "saved", text: "No changes to save" });
      }
      router.refresh();
    } catch (e) {
      if (e instanceof DocsApiError && e.code === "doc_conflict") {
        const current = e.data.current as { sha: string; text: string | null };
        setConflict({ theirs: current, mine: text });
        setStatus({ kind: "error", text: "Changed on GitHub — resolve below" });
      } else {
        setStatus({ kind: "error", text: (e as Error).message });
      }
    } finally {
      saving.current = false;
    }
  }
  useEffect(() => {
    saveRef.current = () => void save();
  });

  function remount(text: string, sha: string, dirty: boolean) {
    baseSha.current = sha;
    setConflict(null);
    setSource({ text, sha, dirty, key: Date.now() });
  }

  // ---- Presence: "Jane is editing" (spec: a heartbeat row) ----
  useEffect(() => {
    if (!doc?.editable) return;
    let live = true;
    const tick = () =>
      docs
        .heartbeat(repoNodeId, path)
        .then((e) => live && setEditors(e))
        .catch(() => {});
    void tick();
    const timer = setInterval(tick, 15_000);
    return () => {
      live = false;
      clearInterval(timer);
      void docs.leave(repoNodeId, path).catch(() => {});
    };
  }, [doc?.editable, docs, repoNodeId, path]);

  // ---- Unsaved changes ----
  const dirty = status.kind === "dirty" || status.kind === "error";
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  async function rename() {
    if (!doc) return;
    const clean = newName.trim().replace(/^\/+/, "");
    const target = joinRoot(doc.root, /\.(md|markdown)$/i.test(clean) ? clean : `${clean}.md`);
    try {
      const out = await docs.rename({ repoNodeId, path, baseSha: baseSha.current, newPath: target });
      setRenaming(false);
      if (out.status === "pending_review") setStatus({ kind: "saved", text: `Rename is in pull request #${out.pr.number}` });
      else router.replace(docHref(workspaceId, repoNodeId, target));
      router.refresh();
    } catch (e) {
      setStatus({ kind: "error", text: (e as Error).message });
    }
  }

  async function remove() {
    try {
      const out = await docs.remove(repoNodeId, path, baseSha.current);
      if (out.status === "pending_review") {
        setStatus({ kind: "saved", text: `Delete is in pull request #${out.pr.number}` });
        setConfirmDelete(false);
        return;
      }
      router.push(`/w/${workspaceId}/docs`);
      router.refresh();
    } catch (e) {
      setStatus({ kind: "error", text: (e as Error).message });
    }
  }

  function applyChange(change: TextChange) {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch(view.state.update(changeSpec(view.state, change), { userEvent: "input.properties" }));
  }

  if (loadError) return <p className="text-sm text-destructive">{loadError}</p>;
  if (!doc || !source) return <p className="text-sm text-muted-foreground">Loading…</p>;

  const githubUrl = `https://github.com/${doc.fullName}/blob/${encodeURIComponent(doc.branch)}/${doc.path.split("/").map(encodeURIComponent).join("/")}`;
  const lineBreak = lineSeparatorOf(source.text);

  return (
    <article className="mx-auto w-full max-w-3xl space-y-3" aria-label={doc.name}>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          {renaming ? (
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void rename();
              }}
            >
              <Input aria-label="New name" value={newName} onChange={(e) => setNewName(e.target.value)} autoFocus className="h-8 w-72" />
              <Button type="submit" className="h-8">
                Rename
              </Button>
              <Button type="button" variant="ghost" className="h-8" onClick={() => setRenaming(false)}>
                Cancel
              </Button>
            </form>
          ) : (
            <h1 className="truncate text-lg font-semibold" title={doc.path}>
              {doc.name}
            </h1>
          )}
          <p className="text-xs text-muted-foreground">
            {doc.fullName} · {doc.branch} ·{" "}
            <a href={githubUrl} target="_blank" rel="noreferrer" className="hover:underline">
              Open on GitHub
            </a>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div role="group" aria-label="View" className="flex rounded-md border border-border p-0.5 text-xs">
            {(["preview", "source"] as const).map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={mode === m}
                onClick={() => switchMode(m)}
                className={`rounded px-2 py-1 ${mode === m ? "bg-muted font-medium" : "text-muted-foreground"}`}
              >
                {m === "preview" ? "Rich text" : "Markdown"}
              </button>
            ))}
          </div>
          {doc.editable && !renaming && (
            <Button
              variant="ghost"
              className="h-8"
              disabled={dirty}
              title={dirty ? "Save first" : undefined}
              onClick={() => {
                setNewName(doc.name);
                setRenaming(true);
              }}
            >
              Rename
            </Button>
          )}
          {doc.canDelete &&
            (confirmDelete ? (
              <Button variant="danger" className="h-8" onClick={() => void remove()} onBlur={() => setConfirmDelete(false)}>
                Click again to delete
              </Button>
            ) : (
              <Button variant="ghost" className="h-8" disabled={dirty} onClick={() => setConfirmDelete(true)}>
                Delete
              </Button>
            ))}
          {doc.editable && (
            <Button className="h-8" disabled={status.kind === "saving"} onClick={() => void save()} title="Save (⌘S / Ctrl+S)">
              Save
            </Button>
          )}
        </div>
      </header>

      <p role="status" aria-live="polite" className={`min-h-4 text-xs ${status.kind === "error" ? "text-destructive" : "text-muted-foreground"}`} data-testid="doc-status">
        {status.text}
      </p>

      {doc.pending && (
        <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100">
          Pending review: saves go to{" "}
          <a href={doc.pending.url} target="_blank" rel="noreferrer" className="font-medium underline">
            pull request #{doc.pending.number}
          </a>{" "}
          until it is merged or closed.
        </p>
      )}
      {editors.length > 0 && (
        <p className="rounded-lg border border-sky-300 bg-sky-50 px-3 py-2 text-sm text-sky-900 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-100" data-testid="doc-editors">
          {editors.map((e) => e.name).join(", ")} {editors.length === 1 ? "is" : "are"} editing this doc. Saves by others show up as a conflict you can resolve.
        </p>
      )}
      {!doc.editable && (
        <p className="text-sm text-muted-foreground">
          {doc.text === null
            ? "This file is not plain UTF-8 text, or it is larger than 1 MB. Open it on GitHub to edit it."
            : "You can read this doc. Your role cannot edit it."}
        </p>
      )}

      {conflict && (
        <ConflictView
          theirs={conflict.theirs.text ?? ""}
          mine={conflict.mine}
          busy={status.kind === "saving"}
          onSave={(merged) => {
            remount(merged, conflict.theirs.sha, true);
            // The rebuilt editor holds `merged`; save it on top of GitHub's version.
            setTimeout(() => void save(merged), 0);
          }}
          onKeepEditing={(merged) => remount(merged, conflict.theirs.sha, true)}
          onUseTheirs={() => remount(conflict.theirs.text ?? "", conflict.theirs.sha, false)}
        />
      )}

      <div hidden={conflict !== null} className="space-y-3">
        <FrontmatterPanel text={mirror} readOnly={!doc.editable} lineBreak={lineBreak} onChange={applyChange} />
        {doc.editable && (
          <Toolbar
            onRun={(spec) => viewRef.current && run(viewRef.current, spec)}
            onImage={() => fileInput.current?.click()}
          />
        )}
        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            void addImages([...(e.target.files ?? [])]);
            e.target.value = "";
          }}
        />
        <div ref={host} data-testid="doc-editor" className={`min-h-[50vh] ${mode === "preview" ? "doc-preview" : "doc-source font-mono text-sm"}`} />
      </div>
    </article>
  );
}

type Spec = Parameters<typeof run>[1];

function Toolbar({ onRun, onImage }: { onRun: (spec: Spec) => void; onImage: () => void }) {
  const items: { label: string; title: string; spec: Spec }[] = [
    { label: "B", title: "Bold (⌘B)", spec: (s) => toggleWrap(s, "**") },
    { label: "I", title: "Italic (⌘I)", spec: (s) => toggleWrap(s, "*") },
    { label: "S", title: "Strikethrough", spec: (s) => toggleWrap(s, "~~") },
    { label: "H1", title: "Heading 1", spec: (s) => setLinePrefix(s, "# ") },
    { label: "H2", title: "Heading 2", spec: (s) => setLinePrefix(s, "## ") },
    { label: "H3", title: "Heading 3", spec: (s) => setLinePrefix(s, "### ") },
    { label: "•", title: "Bulleted list", spec: (s) => setLinePrefix(s, "- ") },
    { label: "1.", title: "Numbered list", spec: (s) => setLinePrefix(s, "1. ") },
    { label: "☐", title: "Checklist", spec: (s) => setLinePrefix(s, "- [ ] ") },
    { label: "❝", title: "Quote", spec: (s) => setLinePrefix(s, "> ") },
    { label: "</>", title: "Inline code", spec: (s) => toggleWrap(s, "`") },
    { label: "Link", title: "Link", spec: insertLink },
  ];
  return (
    <div role="toolbar" aria-label="Formatting" className="sticky top-0 z-10 flex flex-wrap gap-0.5 border-b border-border bg-background/95 py-1 backdrop-blur">
      {items.map((i) => (
        <button
          key={i.title}
          type="button"
          title={i.title}
          aria-label={i.title}
          // Keep the editor's selection: a mousedown on a button would blur it first.
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onRun(i.spec)}
          className="min-w-8 rounded px-2 py-1 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          {i.label}
        </button>
      ))}
      <button type="button" title="Insert image" aria-label="Insert image" onMouseDown={(e) => e.preventDefault()} onClick={onImage} className="rounded px-2 py-1 text-sm text-muted-foreground hover:bg-muted hover:text-foreground">
        Image
      </button>
    </div>
  );
}

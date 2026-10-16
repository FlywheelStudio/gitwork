/**
 * Tasks (decisions 006, 008, 009, 012). Reads come from the cache only and pass every item through
 * the fail-closed filter in packages/core. Writes go to GitHub (user token first, the App on
 * "access denied"), then into the cache from GitHub's own response.
 */
import { type ItemFacts, isTaskVisible, visibilityContext, withBotAttribution } from "@gitwork/core";
import { type Db, type ProjectFieldValue, auditLog, ghIssueLinks, ghIssues, ghProjectItems, workspaceGithub } from "@gitwork/db";
import { and, desc, eq } from "drizzle-orm";
import { badRequest, conflict, notFound } from "../errors";
import { type IssueJson, type ProjectItemNode, inJsonList, issueRow, itemIssueLinks, projectItemRow, upsertIssue, upsertProjectItem } from "../github/cache";
import { type GitHubAuth, isAccessDenied } from "../github/client";
import { ITEM_FIELDS } from "../github/queries";
import { userGitHubToken } from "../github/user-token";
import { type AuditEntry, auditInsert } from "./audit";
import { type WorkspaceAccess, requireCapability } from "./access";
import { type GitHubServiceDeps, getWorkspaceLink } from "./link";

// ---- Views ------------------------------------------------------------------------------------

export interface FieldView {
  id: string;
  name: string;
  dataType: string;
  options?: { id: string; name: string; color?: string }[];
  iterations?: { id: string; title: string; startDate: string; duration: number }[];
}

export interface FieldMapping {
  kanbanFieldId: string | null;
  startFieldId: string | null;
  targetFieldId: string | null;
  iterationFieldId: string | null;
}

export interface TaskView {
  /** The board item's node id. */
  id: string;
  kind: "issue" | "draft";
  title: string;
  state: string | null;
  stateReason: string | null;
  number: number | null;
  repo: { nodeId: string; fullName: string } | null;
  url: string | null;
  labels: { name: string; color: string }[];
  assignees: { login: string; avatarUrl: string }[];
  fields: Record<string, ProjectFieldValue>;
  /** The parent task's id, only when the parent is itself a task this viewer can see. */
  parentId: string | null;
  /** Tasks (visible to this viewer) that block this one. */
  blockedBy: string[];
  updatedAt: string;
}

export interface TaskDetail extends TaskView {
  body: string | null;
}

export type BoardView =
  | { linked: false }
  | {
      linked: true;
      board: { title: string; url: string; available: boolean };
      repos: { nodeId: string; fullName: string }[];
      fields: FieldView[];
      mapping: FieldMapping;
      tasks: TaskView[];
      /** The repo this user last created a task in, if still linked (decision 009 default). */
      lastRepoNodeId: string | null;
    };

const SUPPORTED_FIELD_TYPES = new Set(["SINGLE_SELECT", "DATE", "TEXT", "NUMBER", "ITERATION"]);

function fieldView(f: { nodeId: string; name: string; dataType: string; config: unknown }): FieldView {
  const view: FieldView = { id: f.nodeId, name: f.name, dataType: f.dataType };
  if (f.dataType === "SINGLE_SELECT" && Array.isArray(f.config)) view.options = f.config as FieldView["options"];
  if (f.dataType === "ITERATION" && f.config && typeof f.config === "object") {
    const c = f.config as { iterations?: FieldView["iterations"]; completedIterations?: FieldView["iterations"] };
    view.iterations = [...(c.completedIterations ?? []), ...(c.iterations ?? [])];
  }
  return view;
}

/** Stored choices win when they still fit; otherwise GitHub's usual field names (decision 009). */
export function resolveMapping(fields: FieldView[], stored: Partial<FieldMapping> | null): FieldMapping {
  const byId = (id: string | null | undefined, type: string) => fields.find((f) => f.id === id && f.dataType === type)?.id ?? null;
  const byName = (type: string, names: string[]) =>
    fields.find((f) => f.dataType === type && names.includes(f.name.trim().toLowerCase()))?.id ?? null;
  return {
    kanbanFieldId:
      byId(stored?.kanbanFieldId, "SINGLE_SELECT") ?? byName("SINGLE_SELECT", ["status"]) ?? fields.find((f) => f.dataType === "SINGLE_SELECT")?.id ?? null,
    startFieldId: byId(stored?.startFieldId, "DATE") ?? byName("DATE", ["start date", "start"]),
    targetFieldId: byId(stored?.targetFieldId, "DATE") ?? byName("DATE", ["target date", "end date", "due date", "due"]),
    iterationFieldId: byId(stored?.iterationFieldId, "ITERATION") ?? fields.find((f) => f.dataType === "ITERATION")?.id ?? null,
  };
}

// ---- Reads ------------------------------------------------------------------------------------

async function loadBoard(db: Db, access: WorkspaceAccess, onlyItemId?: string) {
  const data = await getWorkspaceLink(db, access.workspace.id);
  if (!data) return null;
  const repos = data.repos.filter((r) => r.available);
  const repoName = new Map(repos.map((r) => [r.nodeId, r.fullName]));
  const ctx = visibilityContext(access.actor, access.settings, access.workspace.hideLabel, repoName.keys());
  const boardAvailable = data.project?.available ?? false;

  const rows = boardAvailable
    ? await db
        .select({ item: ghProjectItems, issue: ghIssues })
        .from(ghProjectItems)
        .leftJoin(ghIssues, eq(ghIssues.nodeId, ghProjectItems.contentNodeId))
        .where(
          and(
            eq(ghProjectItems.projectNodeId, data.link.projectNodeId),
            eq(ghProjectItems.deleted, false),
            eq(ghProjectItems.archived, false),
            onlyItemId ? eq(ghProjectItems.nodeId, onlyItemId) : undefined,
          ),
        )
    : [];
  const visible = rows.filter(({ item, issue }) => {
    const facts: ItemFacts = {
      contentType: item.contentType,
      deleted: item.deleted,
      archived: item.archived,
      // An ISSUE item counts only when its content is the cached issue (a PR shares no row).
      issue: item.contentType === "ISSUE" && issue ? { repoNodeId: issue.repoNodeId, deleted: issue.deleted, labels: issue.labels } : null,
    };
    return isTaskVisible(facts, ctx);
  });
  return { data, repos, repoName, ctx, visible };
}

type Loaded = NonNullable<Awaited<ReturnType<typeof loadBoard>>>;

/** Links between visible tasks only: a hidden or unlinked issue never shows up as a reference. */
async function toViews(db: Db, loaded: Loaded, linkScope?: Loaded["visible"]): Promise<TaskView[]> {
  const scope = linkScope ?? loaded.visible;
  const itemOfIssue = new Map(scope.flatMap(({ item, issue }) => (issue ? [[issue.nodeId, item.nodeId] as const] : [])));
  const issueIds = loaded.visible.flatMap(({ issue }) => (issue ? [issue.nodeId] : []));
  const links = issueIds.length
    ? await db.select().from(ghIssueLinks).where(inJsonList(ghIssueLinks.issueNodeId, issueIds))
    : [];
  const linkOf = new Map(links.map((l) => [l.issueNodeId, l]));
  return loaded.visible.map(({ item, issue }) => {
    const l = issue ? linkOf.get(issue.nodeId) : undefined;
    const base = {
      id: item.nodeId,
      fields: item.fieldValues,
      parentId: (l?.parentNodeId && itemOfIssue.get(l.parentNodeId)) || null,
      blockedBy: (l?.blockedBy ?? []).flatMap((id) => (itemOfIssue.has(id) ? [itemOfIssue.get(id)!] : [])),
    };
    if (item.contentType === "DRAFT_ISSUE" || !issue) {
      return {
        ...base,
        kind: "draft" as const,
        title: item.draftTitle ?? "",
        state: null,
        stateReason: null,
        number: null,
        repo: null,
        url: null,
        labels: [],
        assignees: [],
        updatedAt: item.githubUpdatedAt.toISOString(),
      };
    }
    return {
      ...base,
      kind: "issue" as const,
      title: issue.title,
      state: issue.state,
      stateReason: issue.stateReason,
      number: issue.number,
      repo: { nodeId: issue.repoNodeId, fullName: loaded.repoName.get(issue.repoNodeId) ?? "" },
      url: issue.htmlUrl,
      labels: issue.labels,
      assignees: issue.assignees,
      updatedAt: new Date(Math.max(issue.githubUpdatedAt.getTime(), item.githubUpdatedAt.getTime())).toISOString(),
    };
  });
}

export async function listTasks(db: Db, access: WorkspaceAccess): Promise<BoardView> {
  requireCapabilityView(access);
  const loaded = await loadBoard(db, access);
  if (!loaded) return { linked: false };
  const fields = loaded.data.fields.map(fieldView);
  const [last] = await db
    .select({ repoNodeId: auditLog.repoNodeId })
    .from(auditLog)
    .where(and(eq(auditLog.workspaceId, access.workspace.id), eq(auditLog.userId, access.userId), eq(auditLog.action, "task.create")))
    .orderBy(desc(auditLog.at))
    .limit(1);
  return {
    linked: true,
    board: {
      title: loaded.data.project?.title ?? "",
      url: loaded.data.project?.url ?? "",
      available: loaded.data.project?.available ?? false,
    },
    repos: loaded.repos.map((r) => ({ nodeId: r.nodeId, fullName: r.fullName })),
    fields,
    mapping: resolveMapping(fields, loaded.data.link),
    tasks: await toViews(db, loaded),
    lastRepoNodeId: last?.repoNodeId && loaded.repoName.has(last.repoNodeId) ? last.repoNodeId : null,
  };
}

export async function getTask(db: Db, access: WorkspaceAccess, itemId: string): Promise<TaskDetail> {
  requireCapabilityView(access);
  const loaded = await loadBoard(db, access, itemId);
  const row = loaded?.visible[0];
  if (!loaded || !row) throw notFound("Task not found.");
  // Links need the whole visible board to resolve; load it only when this task has links.
  const hasLinks = row.issue ? (await db.select().from(ghIssueLinks).where(eq(ghIssueLinks.issueNodeId, row.issue.nodeId))).length > 0 : false;
  const scope = hasLinks ? (await loadBoard(db, access))!.visible : undefined;
  const [view] = await toViews(db, loaded, scope);
  return { ...view!, body: row.issue ? row.issue.body : row.item.draftBody };
}

function requireCapabilityView(access: WorkspaceAccess) {
  requireCapability(access, "workspace.view");
}

// ---- Writes -----------------------------------------------------------------------------------

export type FieldInput =
  | { type: "single_select"; optionId: string }
  | { type: "date"; date: string }
  | { type: "text"; text: string }
  | { type: "number"; number: number }
  | { type: "iteration"; iterationId: string };

export interface TaskWriteDeps extends GitHubServiceDeps {
  /** The name used in bot attribution lines. */
  displayName: string;
}

const ADD_ITEM = `
  mutation AddItem($projectId: ID!, $contentId: ID!) {
    addProjectV2ItemById(input: { projectId: $projectId, contentId: $contentId }) { item { ${ITEM_FIELDS} } }
  }
`;
const SET_FIELD = `
  mutation SetField($projectId: ID!, $itemId: ID!, $fieldId: ID!, $value: ProjectV2FieldValue!) {
    updateProjectV2ItemFieldValue(input: { projectId: $projectId, itemId: $itemId, fieldId: $fieldId, value: $value }) {
      projectV2Item { ${ITEM_FIELDS} }
    }
  }
`;
const CLEAR_FIELD = `
  mutation ClearField($projectId: ID!, $itemId: ID!, $fieldId: ID!) {
    clearProjectV2ItemFieldValue(input: { projectId: $projectId, itemId: $itemId, fieldId: $fieldId }) {
      projectV2Item { ${ITEM_FIELDS} }
    }
  }
`;

type Via = "user" | "app";

/**
 * Runs one GitHub call as the user (their own token) when they linked GitHub, else as the App.
 * "Access denied" for the user retries as the App: the app role is the authority (decision 007),
 * and nothing happened on GitHub yet for this call. Decided per call.
 */
async function asActor<T>(
  deps: TaskWriteDeps,
  userToken: string | null,
  installationId: number,
  call: (auth: GitHubAuth, via: Via) => Promise<T>,
): Promise<{ result: T; via: Via }> {
  if (userToken) {
    try {
      return { result: await call({ userToken }, "user"), via: "user" };
    } catch (error) {
      if (!isAccessDenied(error)) throw error;
    }
  }
  return { result: await call({ installationId }, "app"), via: "app" };
}

function fieldValueInput(field: FieldView, value: FieldInput): Record<string, unknown> {
  const bad = () => badRequest(`That value does not fit the field "${field.name}".`);
  switch (field.dataType) {
    case "SINGLE_SELECT":
      if (value.type !== "single_select" || !field.options?.some((o) => o.id === value.optionId)) throw bad();
      return { singleSelectOptionId: value.optionId };
    case "DATE":
      if (value.type !== "date" || !/^\d{4}-\d{2}-\d{2}$/.test(value.date) || Number.isNaN(Date.parse(value.date))) throw bad();
      return { date: value.date };
    case "TEXT":
      if (value.type !== "text" || value.text.length > 1024) throw bad();
      return { text: value.text };
    case "NUMBER":
      if (value.type !== "number" || !Number.isFinite(value.number)) throw bad();
      return { number: value.number };
    case "ITERATION":
      if (value.type !== "iteration" || !field.iterations?.some((i) => i.id === value.iterationId)) throw bad();
      return { iterationId: value.iterationId };
    default:
      throw badRequest(`The field "${field.name}" cannot be edited here.`);
  }
}

/** Checks every field change before anything is sent to GitHub. */
function checkFields(fields: FieldView[], changes: Record<string, FieldInput | null> | undefined) {
  return Object.entries(changes ?? {}).map(([fieldId, value]) => {
    const field = fields.find((f) => f.id === fieldId);
    if (!field || !SUPPORTED_FIELD_TYPES.has(field.dataType)) throw badRequest("Unknown field.");
    return { fieldId, value: value ? fieldValueInput(field, value) : null };
  });
}

type Write = Parameters<Db["batch"]>[0][number];

async function applyFields(
  deps: TaskWriteDeps,
  token: string | null,
  installationId: number,
  projectId: string,
  itemId: string,
  changes: { fieldId: string; value: Record<string, unknown> | null }[],
) {
  let node: ProjectItemNode | null = null;
  const vias: Via[] = [];
  for (const change of changes) {
    const { result, via } = await asActor(deps, token, installationId, async (auth) => {
      if (change.value) {
        const out = await deps.client.graphql<{ updateProjectV2ItemFieldValue: { projectV2Item: ProjectItemNode } }>(auth, SET_FIELD, {
          projectId,
          itemId,
          fieldId: change.fieldId,
          value: change.value,
        });
        return out.updateProjectV2ItemFieldValue.projectV2Item;
      }
      const out = await deps.client.graphql<{ clearProjectV2ItemFieldValue: { projectV2Item: ProjectItemNode } }>(auth, CLEAR_FIELD, {
        projectId,
        itemId,
        fieldId: change.fieldId,
      });
      return out.clearProjectV2ItemFieldValue.projectV2Item;
    });
    node = result;
    vias.push(via);
  }
  return { node, vias };
}

function itemWrites(db: Db, projectId: string, node: ProjectItemNode | null, now: Date): Write[] {
  if (!node) return [];
  return [upsertProjectItem(db, projectItemRow(projectId, node, now), "fresh"), ...itemIssueLinks(db, node, now)] as Write[];
}

async function writeContext(deps: TaskWriteDeps, access: WorkspaceAccess) {
  requireCapability(access, "tasks.write");
  const data = await getWorkspaceLink(deps.db, access.workspace.id);
  if (!data) throw conflict("not_linked", "Link this workspace to a GitHub board first.");
  if (!data.project?.available) throw conflict("board_unavailable", "The GitHub board is not reachable right now.");
  const fields = data.fields.map(fieldView);
  const token = await userGitHubToken({ db: deps.db, auth: deps.auth }, access.userId);
  return { data, fields, token, installationId: data.link.installationId, projectId: data.link.projectNodeId };
}

export interface CreateTaskInput {
  repoNodeId: string;
  title: string;
  body?: string;
  fields?: Record<string, FieldInput | null>;
}

/** A new task is always a real issue in a linked repo, then added to the board (decision 009). */
export async function createTask(deps: TaskWriteDeps, access: WorkspaceAccess, input: CreateTaskInput, now = () => new Date()) {
  const { db } = deps;
  const w = await writeContext(deps, access);
  const repo = w.data.repos.find((r) => r.nodeId === input.repoNodeId && r.available && !r.archived);
  if (!repo) throw badRequest("Pick one of this workspace's repos.");
  const changes = checkFields(w.fields, input.fields);

  const created = await asActor(deps, w.token, w.installationId, (auth, via) =>
    deps.client.rest<IssueJson>("POST", `/repos/${repo.fullName}/issues`, auth, {
      title: input.title,
      body: via === "app" ? withBotAttribution(input.body ?? "", deps.displayName) : (input.body ?? ""),
    }),
  );
  const issue = created.result;
  const audit = (extra: Partial<AuditEntry>): AuditEntry => ({
    userId: access.userId,
    workspaceId: access.workspace.id,
    action: "task.create",
    via: created.via,
    repoNodeId: repo.nodeId,
    target: issue.node_id,
    ...extra,
  });

  let itemNode: ProjectItemNode | null = null;
  const vias: Via[] = [];
  try {
    const added = await asActor(deps, w.token, w.installationId, (auth) =>
      deps.client.graphql<{ addProjectV2ItemById: { item: ProjectItemNode } }>(auth, ADD_ITEM, { projectId: w.projectId, contentId: issue.node_id }),
    );
    itemNode = added.result.addProjectV2ItemById.item;
    vias.push(added.via);
    const applied = await applyFields(deps, w.token, w.installationId, w.projectId, itemNode.id, changes);
    itemNode = applied.node ?? itemNode;
    vias.push(...applied.vias);
  } catch (error) {
    // The issue exists on GitHub now: record it before reporting the failure.
    const at = now();
    await db.batch([
      upsertIssue(db, issueRow(repo.nodeId, issue, at), "fresh"),
      ...itemWrites(db, w.projectId, itemNode, at),
      auditInsert(db, audit({ detail: { boardAdd: "failed", number: issue.number } }), at),
    ] as unknown as Parameters<Db["batch"]>[0]);
    throw error;
  }
  const at = now();
  await db.batch([
    upsertIssue(db, issueRow(repo.nodeId, issue, at), "fresh"),
    ...itemWrites(db, w.projectId, itemNode, at),
    auditInsert(db, audit({ detail: { itemId: itemNode.id, number: issue.number, boardVia: vias } }), at),
  ] as unknown as Parameters<Db["batch"]>[0]);
  return getTask(db, access, itemNode.id);
}

export interface UpdateTaskInput {
  title?: string;
  body?: string;
  state?: "open" | "closed";
  stateReason?: "completed" | "not_planned" | "reopened" | null;
  fields?: Record<string, FieldInput | null>;
}

export async function updateTask(deps: TaskWriteDeps, access: WorkspaceAccess, itemId: string, input: UpdateTaskInput, now = () => new Date()) {
  const { db } = deps;
  // The task must be one this user can see on this board: anything else is "not found".
  const current = await getTask(db, access, itemId);
  const w = await writeContext(deps, access);
  const changes = checkFields(w.fields, input.fields);
  const issueChange = input.title !== undefined || input.body !== undefined || input.state !== undefined;
  if (issueChange && current.kind !== "issue") throw badRequest("Draft items are edited on GitHub.");
  if (input.title !== undefined && !input.title.trim()) throw badRequest("Title is required.");

  const writes: Write[] = [];
  const audits: AuditEntry[] = [];
  const base = { userId: access.userId, workspaceId: access.workspace.id, repoNodeId: current.repo?.nodeId ?? null };
  try {
    if (issueChange && current.repo && current.number !== null) {
      const { result: issue, via } = await asActor(deps, w.token, w.installationId, (auth, via) =>
        deps.client.rest<IssueJson>("PATCH", `/repos/${current.repo!.fullName}/issues/${current.number}`, auth, {
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.body !== undefined ? { body: via === "app" ? withBotAttribution(input.body, deps.displayName) : input.body } : {}),
          ...(input.state !== undefined ? { state: input.state } : {}),
          ...(input.stateReason !== undefined ? { state_reason: input.stateReason } : {}),
        }),
      );
      writes.push(upsertIssue(db, issueRow(current.repo.nodeId, issue, now()), "fresh") as Write);
      audits.push({
        ...base,
        action: "task.update",
        via,
        target: issue.node_id,
        detail: { itemId, changed: Object.keys(input).filter((k) => k !== "fields" && input[k as keyof UpdateTaskInput] !== undefined) },
      });
    }
    if (changes.length > 0) {
      const applied = await applyFields(deps, w.token, w.installationId, w.projectId, itemId, changes);
      writes.push(...itemWrites(db, w.projectId, applied.node, now()));
      audits.push({
        ...base,
        action: "task.fields",
        via: applied.vias.includes("app") ? "app" : "user",
        target: itemId,
        detail: { fields: changes.map((c) => c.fieldId), vias: applied.vias },
      });
    }
  } finally {
    // Whatever reached GitHub is recorded, even when a later step failed.
    if (writes.length + audits.length > 0) {
      const at = now();
      await db.batch([...writes, ...audits.map((a) => auditInsert(db, a, at))] as unknown as Parameters<Db["batch"]>[0]);
    }
  }
  return getTask(db, access, itemId);
}

export async function setFieldMapping(db: Db, access: WorkspaceAccess, input: Partial<FieldMapping>, now = new Date()) {
  requireCapability(access, "workspace.github_settings");
  const data = await getWorkspaceLink(db, access.workspace.id);
  if (!data) throw conflict("not_linked", "Link this workspace to a GitHub board first.");
  const fields = data.fields.map(fieldView);
  const want: [keyof FieldMapping, string][] = [
    ["kanbanFieldId", "SINGLE_SELECT"],
    ["startFieldId", "DATE"],
    ["targetFieldId", "DATE"],
    ["iterationFieldId", "ITERATION"],
  ];
  const set: Partial<FieldMapping> = {};
  for (const [key, type] of want) {
    const id = input[key];
    if (id === undefined) continue;
    if (id !== null && !fields.some((f) => f.id === id && f.dataType === type)) throw badRequest("That field does not fit.");
    set[key] = id;
  }
  await db.batch([
    db.update(workspaceGithub).set(set).where(eq(workspaceGithub.workspaceId, access.workspace.id)),
    auditInsert(db, { userId: access.userId, workspaceId: access.workspace.id, action: "workspace.fields", via: "local", target: access.workspace.id, detail: set }, now),
  ] as unknown as Parameters<Db["batch"]>[0]);
  return resolveMapping(fields, { ...data.link, ...set });
}

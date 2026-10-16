/** An in-memory GitHub for tests: a fetch function that routes the calls the client makes. */
import type { IssueJson, ProjectItemNode, RepoJson } from "../src/github/cache";

/** A GitHub user behind an App user token (`ghu_…`): what their own account can see. */
export interface FakeUser {
  login: string;
  installations: Set<number>;
  repos: Set<string>; // "owner/name"
  projects: Set<string>; // project node ids
}

type Caller = { kind: "app" } | { kind: "installation"; id: number } | { kind: "user"; user: FakeUser } | { kind: "none" };

export interface FakeProject {
  id: string;
  number: number;
  title: string;
  owner: string;
  fields: { id: string; name: string; dataType: string; options?: unknown }[];
  items: ProjectItemNode[];
}

export class FakeGitHub {
  repos = new Map<string, RepoJson>(); // "owner/name" →
  issues = new Map<string, IssueJson[]>(); // "owner/name" →
  projects = new Map<string, FakeProject>();
  tokensIssued = 0;
  requests: string[] = [];
  /** Next response override, e.g. a rate limit or a 500. */
  failNext: { status: number; headers?: Record<string, string> } | null = null;
  pageSize = 100;
  /** Issues that listing endpoints skip (simulates a page shift during a sweep). */
  hiddenFromLists = new Set<string>();
  /** App user tokens → the user. */
  users = new Map<string, FakeUser>();
  /** Installation → org login. Unset ids belong to "acme". */
  installationAccounts = new Map<number, string>();
  /** Installation → repos it may reach. Unset = every repo. */
  installationRepos = new Map<number, Set<string>>();
  /** Issue node id → links. */
  links = new Map<string, { parent: string | null; blockedBy: string[] }>();
  /** Every write: "<who> <what>", e.g. "user:jane POST /repos/acme/site/issues". */
  writes: string[] = [];
  /** Clock for created/updated timestamps. */
  clock = Date.parse("2026-06-01T00:00:00Z");
  private tokenInstallation = new Map<string, number>();
  private itemCounter = 0;

  addUser(token: string, user: Omit<FakeUser, "installations" | "repos" | "projects"> & Partial<FakeUser>) {
    const full: FakeUser = { installations: new Set(), repos: new Set(), projects: new Set(), ...user };
    this.users.set(token, full);
    return full;
  }

  private tick(): string {
    this.clock += 1000;
    return new Date(this.clock).toISOString();
  }

  private caller(init?: RequestInit): Caller {
    const authz = new Headers(init?.headers).get("authorization") ?? "";
    const token = authz.replace(/^Bearer /, "");
    if (token.startsWith("ey")) return { kind: "app" };
    if (token.startsWith("ghs_")) return { kind: "installation", id: this.tokenInstallation.get(token) ?? 0 };
    const user = this.users.get(token);
    return user ? { kind: "user", user } : { kind: "none" };
  }

  private installationCanReach(id: number, fullName: string) {
    return this.installationRepos.get(id)?.has(fullName) ?? true;
  }

  private canWriteRepo(who: Caller, fullName: string) {
    if (who.kind === "user") return who.user.repos.has(fullName);
    if (who.kind === "installation") return this.installationCanReach(who.id, fullName);
    return false;
  }

  private canUseProject(who: Caller, projectId: string) {
    if (who.kind === "user") return who.user.projects.has(projectId);
    return who.kind === "installation";
  }

  private whoName(who: Caller) {
    return who.kind === "user" ? `user:${who.user.login}` : who.kind === "installation" ? "app" : who.kind;
  }

  private findItem(itemId: string) {
    for (const p of this.projects.values()) {
      const item = p.items.find((i) => i.id === itemId);
      if (item) return { project: p, item };
    }
    return null;
  }

  private issueLinks(id: string) {
    const l = this.links.get(id);
    return { parent: l?.parent ? { id: l.parent } : null, blockedBy: { nodes: (l?.blockedBy ?? []).map((b) => ({ id: b })) } };
  }

  /** An item with its issue's current links, as GraphQL would return it. */
  private itemOut(item: ProjectItemNode, projectId?: string) {
    const content = item.type === "ISSUE" && item.content?.id ? { ...item.content, ...this.issueLinks(item.content.id) } : item.content;
    return { ...item, content, ...(projectId ? { project: { id: projectId } } : {}) };
  }

  private setField(project: FakeProject, item: ProjectItemNode, fieldId: string, value: Record<string, unknown> | null) {
    const nodes = item.fieldValues.nodes.filter((n) => n.field?.id !== fieldId);
    if (value) {
      const field = project.fields.find((f) => f.id === fieldId);
      if (!field) throw new Error(`no field ${fieldId}`);
      let node: Record<string, unknown>;
      if ("singleSelectOptionId" in value) {
        const option = (field.options as { id: string; name: string }[] | undefined)?.find((o) => o.id === value.singleSelectOptionId);
        if (!option) throw new Error("bad option");
        node = { __typename: "ProjectV2ItemFieldSingleSelectValue", optionId: option.id, name: option.name };
      } else if ("date" in value) node = { __typename: "ProjectV2ItemFieldDateValue", date: value.date };
      else if ("text" in value) node = { __typename: "ProjectV2ItemFieldTextValue", text: value.text };
      else if ("number" in value) node = { __typename: "ProjectV2ItemFieldNumberValue", number: value.number };
      else throw new Error("unsupported value");
      nodes.push({ ...node, field: { id: fieldId } } as never);
    }
    item.fieldValues = { nodes };
    item.updatedAt = this.tick();
  }

  /** Routes for user tokens and writes. Null = fall through to the read routes below. */
  private extra(method: string, url: URL, init: RequestInit | undefined): Response | null {
    const path = url.pathname;
    const who = this.caller(init);
    const deny = () => new Response(JSON.stringify({ message: "Not Found" }), { status: 404 });
    let m: RegExpExecArray | null;

    if (path === "/user/installations" && method === "GET") {
      if (who.kind !== "user") return new Response("{}", { status: 401 });
      const installations = [...who.user.installations].map((id) => ({
        id,
        account: { login: this.installationAccounts.get(id) ?? "acme", id: 7, type: "Organization" },
      }));
      return Response.json({ total_count: installations.length, installations });
    }
    if ((m = /^\/user\/installations\/(\d+)\/repositories$/.exec(path)) && method === "GET") {
      if (who.kind !== "user") return new Response("{}", { status: 401 });
      const id = Number(m[1]);
      if (!who.user.installations.has(id)) return deny();
      const all = [...this.repos.values()].filter((r) => who.user.repos.has(r.full_name) && this.installationCanReach(id, r.full_name));
      const page = Number(url.searchParams.get("page") ?? "1");
      const headers = new Headers();
      if (page * this.pageSize < all.length) {
        const next = new URL(url);
        next.searchParams.set("page", String(page + 1));
        headers.set("link", `<${next.href}>; rel="next"`);
      }
      return Response.json({ total_count: all.length, repositories: all.slice((page - 1) * this.pageSize, page * this.pageSize) }, { headers });
    }
    if ((m = /^\/repos\/([^/]+\/[^/]+)\/issues$/.exec(path)) && method === "POST") {
      const fullName = m[1]!;
      if (!this.repos.has(fullName) || !this.canWriteRepo(who, fullName)) return deny();
      const body = JSON.parse(String(init?.body)) as { title: string; body?: string };
      const list = this.issues.get(fullName)!;
      const number = Math.max(0, ...list.map((i) => i.number)) + 1;
      const at = this.tick();
      const issue = this.putIssue(fullName, {
        number,
        title: body.title,
        body: body.body ?? null,
        created_at: at,
        updated_at: at,
        user: { login: who.kind === "user" ? who.user.login : "gitwork-test[bot]" },
      });
      this.writes.push(`${this.whoName(who)} POST /repos/${fullName}/issues`);
      return Response.json(issue, { status: 201 });
    }
    if ((m = /^\/repos\/([^/]+\/[^/]+)\/issues\/(\d+)$/.exec(path)) && method === "PATCH") {
      const fullName = m[1]!;
      const existing = this.issues.get(fullName)?.find((i) => i.number === Number(m![2]));
      if (!existing || !this.canWriteRepo(who, fullName)) return deny();
      const patch = JSON.parse(String(init?.body)) as Partial<IssueJson>;
      const issue = this.putIssue(fullName, { ...patch, number: existing.number, updated_at: this.tick() });
      this.writes.push(`${this.whoName(who)} PATCH /repos/${fullName}/issues/${existing.number}`);
      return Response.json(issue);
    }
    if (path !== "/graphql") return null;

    const { query, variables } = JSON.parse(String(init?.body)) as { query: string; variables: Record<string, unknown> };
    const notFound = (id: unknown) => Response.json({ data: { node: null }, errors: [{ type: "NOT_FOUND", message: `Could not resolve to a node with the global id of '${String(id)}'` }] });
    const forbidden = (key: string) => Response.json({ data: { [key]: null }, errors: [{ type: "FORBIDDEN", message: "Resource not accessible by integration" }] });

    if (query.includes("query LinkProject")) {
      const project = this.projects.get(String(variables.id));
      if (!project || !this.canUseProject(who, project.id)) return notFound(variables.id);
      return Response.json({
        data: {
          node: { id: project.id, number: project.number, title: project.title, closed: false, url: `https://github.com/orgs/${project.owner}/projects/${project.number}`, owner: { login: project.owner } },
        },
      });
    }
    if (query.includes("query OrgProjects")) {
      const nodes = [...this.projects.values()]
        .filter((p) => p.owner === variables.login && this.canUseProject(who, p.id))
        .map((p) => ({ id: p.id, number: p.number, title: p.title, closed: false }));
      return Response.json({ data: { organization: { projectsV2: { nodes } } } });
    }
    if (query.includes("query IssueLinks")) {
      const ids = variables.ids as string[];
      return Response.json({ data: { nodes: ids.map((id) => ({ id, ...this.issueLinks(id) })) } });
    }
    if (query.includes("mutation AddItem")) {
      const input = variables as { projectId: string; contentId: string };
      const project = this.projects.get(input.projectId);
      if (!project || !this.canUseProject(who, project.id)) return forbidden("addProjectV2ItemById");
      let item = project.items.find((i) => i.content?.id === input.contentId);
      if (!item) {
        item = { id: `PVTI_${++this.itemCounter}`, type: "ISSUE", isArchived: false, updatedAt: this.tick(), content: { id: input.contentId }, fieldValues: { nodes: [] } };
        project.items.push(item);
      }
      this.writes.push(`${this.whoName(who)} addProjectV2ItemById`);
      return Response.json({ data: { addProjectV2ItemById: { item: this.itemOut(item) } } });
    }
    if (query.includes("mutation SetField") || query.includes("mutation ClearField")) {
      const input = variables as { projectId: string; itemId: string; fieldId: string; value?: Record<string, unknown> };
      const found = this.findItem(input.itemId);
      const key = query.includes("SetField") ? "updateProjectV2ItemFieldValue" : "clearProjectV2ItemFieldValue";
      if (!found || found.project.id !== input.projectId || !this.canUseProject(who, input.projectId)) return forbidden(key);
      this.setField(found.project, found.item, input.fieldId, input.value ?? null);
      this.writes.push(`${this.whoName(who)} ${key}`);
      return Response.json({ data: { [key]: { projectV2Item: this.itemOut(found.item) } } });
    }
    return null;
  }

  addRepo(fullName: string, nodeId: string, id: number) {
    const [owner, name] = fullName.split("/") as [string, string];
    this.repos.set(fullName, { node_id: nodeId, id, name, full_name: fullName, private: true, default_branch: "main", owner: { login: owner } });
    this.issues.set(fullName, []);
  }

  putIssue(fullName: string, issue: Partial<IssueJson> & { number: number; updated_at: string }) {
    const list = this.issues.get(fullName)!;
    const existing = list.find((i) => i.number === issue.number);
    const full: IssueJson = {
      node_id: `I_${fullName}#${issue.number}`,
      title: `Issue ${issue.number}`,
      body: null,
      state: "open",
      labels: [],
      assignees: [],
      user: { login: "octo" },
      html_url: `https://github.com/${fullName}/issues/${issue.number}`,
      created_at: "2026-01-01T00:00:00Z",
      ...existing,
      ...issue,
    };
    if (existing) list.splice(list.indexOf(existing), 1, full);
    else list.push(full);
    return full;
  }

  fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const method = init?.method ?? "GET";
    this.requests.push(`${method} ${url.pathname}${url.search}`);
    if (this.failNext) {
      const f = this.failNext;
      this.failNext = null;
      return new Response(JSON.stringify({ message: "fake failure" }), { status: f.status, headers: f.headers });
    }
    const path = url.pathname;
    let m: RegExpExecArray | null;
    const handled = this.extra(method, url, init);
    if (handled) return handled;

    if ((m = /^\/app\/installations\/(\d+)\/access_tokens$/.exec(path)) && method === "POST") {
      this.tokensIssued++;
      this.tokenInstallation.set(`ghs_token_${this.tokensIssued}`, Number(m[1]));
      return Response.json({ token: `ghs_token_${this.tokensIssued}`, expires_at: new Date(Date.now() + 60 * 60_000).toISOString() });
    }
    if ((m = /^\/app\/installations\/(\d+)$/.exec(path)) && method === "GET") {
      if (!init?.headers || !String((init.headers as Record<string, string>).authorization).startsWith("Bearer ey")) {
        return new Response("{}", { status: 401 });
      }
      const id = Number(m[1]);
      return id === 404 ? new Response("{}", { status: 404 }) : Response.json({
        id,
        account: { login: "acme", id: 7, type: "Organization" },
        repository_selection: "all",
        suspended_at: null,
      });
    }
    if ((m = /^\/repos\/([^/]+\/[^/]+)\/issues\/(\d+)$/.exec(path))) {
      const issue = this.issues.get(m[1]!)?.find((i) => i.number === Number(m![2]));
      return issue ? Response.json(issue) : new Response("{}", { status: 404 });
    }
    if ((m = /^\/repos\/([^/]+\/[^/]+)\/issues$/.exec(path))) {
      const since = url.searchParams.get("since");
      const page = Number(url.searchParams.get("page") ?? "1");
      const sortKey = url.searchParams.get("sort") === "created" ? "created_at" : "updated_at";
      const all = [...(this.issues.get(m[1]!) ?? [])]
        .filter((i) => !this.hiddenFromLists.has(i.node_id))
        .filter((i) => !since || i.updated_at > since)
        .sort((a, b) => a[sortKey].localeCompare(b[sortKey]) || a.number - b.number);
      const slice = all.slice((page - 1) * this.pageSize, page * this.pageSize);
      const headers = new Headers();
      if (page * this.pageSize < all.length) {
        const next = new URL(url);
        next.searchParams.set("page", String(page + 1));
        headers.set("link", `<${next.href}>; rel="next"`);
      }
      return Response.json(slice, { headers });
    }
    if ((m = /^\/repos\/([^/]+\/[^/]+)$/.exec(path))) {
      const repo = this.repos.get(m[1]!);
      return repo ? Response.json(repo) : new Response("{}", { status: 404 });
    }
    if (path === "/graphql") {
      const { query, variables } = JSON.parse(String(init?.body)) as { query: string; variables: { id: string; after?: string | null } };
      if (query.includes("query ProjectPage")) {
        const project = this.projects.get(variables.id);
        if (!project) return Response.json({ data: { node: null } });
        const start = variables.after ? Number(variables.after) : 0;
        const nodes = project.items.slice(start, start + this.pageSize);
        const hasNextPage = start + this.pageSize < project.items.length;
        return Response.json({
          data: {
            node: {
              id: project.id,
              number: project.number,
              title: project.title,
              closed: false,
              url: `https://github.com/orgs/${project.owner}/projects/${project.number}`,
              owner: { login: project.owner },
              fields: { nodes: project.fields },
              items: { pageInfo: { hasNextPage, endCursor: hasNextPage ? String(start + this.pageSize) : null }, nodes: nodes.map((n) => this.itemOut(n)) },
            },
          },
        });
      }
      if (query.includes("query VerifyNodes")) {
        const ids = (variables as unknown as { ids: string[] }).ids;
        const errors: { type: string; message: string }[] = [];
        const nodes = ids.map((id) => {
          for (const [fullName, list] of this.issues) {
            if (list.some((i) => i.node_id === id)) return { id, repository: { id: this.repos.get(fullName)!.node_id } };
          }
          for (const p of this.projects.values()) {
            if (p.items.some((i) => i.id === id)) return { id, project: { id: p.id } };
          }
          errors.push({ type: "NOT_FOUND", message: `Could not resolve to a node with the global id of '${id}'` });
          return null;
        });
        return Response.json({ data: { nodes }, ...(errors.length ? { errors } : {}) });
      }
      if (query.includes("query ProjectItem")) {
        for (const p of this.projects.values()) {
          const item = p.items.find((i) => i.id === variables.id);
          if (item) return Response.json({ data: { node: this.itemOut(item, p.id) } });
        }
        return Response.json({ data: { node: null } });
      }
    }
    return new Response(JSON.stringify({ message: `fake: no route for ${method} ${path}` }), { status: 404 });
  };
}

export function item(id: string, updatedAt: string, opts: { status?: string; archived?: boolean; contentId?: string } = {}): ProjectItemNode {
  return {
    id,
    type: "ISSUE",
    isArchived: opts.archived ?? false,
    updatedAt,
    content: { id: opts.contentId ?? `I_${id}` },
    fieldValues: {
      nodes: opts.status
        ? [{ __typename: "ProjectV2ItemFieldSingleSelectValue", optionId: `opt-${opts.status}`, name: opts.status, field: { id: "F_status" } }]
        : [],
    },
  };
}

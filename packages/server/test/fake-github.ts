/** An in-memory GitHub for tests: a fetch function that routes the calls the client makes. */
import type { IssueJson, ProjectItemNode, RepoJson } from "../src/github/cache";

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

    if ((m = /^\/app\/installations\/(\d+)\/access_tokens$/.exec(path)) && method === "POST") {
      this.tokensIssued++;
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
              items: { pageInfo: { hasNextPage, endCursor: hasNextPage ? String(start + this.pageSize) : null }, nodes },
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
          if (item) return Response.json({ data: { node: { ...item, project: { id: p.id } } } });
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

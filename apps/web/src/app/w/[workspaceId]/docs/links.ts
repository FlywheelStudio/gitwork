/** URLs of the docs pages. Each path segment is encoded on its own. */
export function docHref(workspaceId: string, repoNodeId: string, path: string): string {
  return `/w/${workspaceId}/docs/${encodeURIComponent(repoNodeId)}/${path.split("/").map(encodeURIComponent).join("/")}`;
}

export function rawHref(workspaceId: string, repoNodeId: string, path: string): string {
  return `/api/v1/workspaces/${workspaceId}/docs/raw?repo=${encodeURIComponent(repoNodeId)}&path=${encodeURIComponent(path)}`;
}

/** Route params arrive encoded on some runtimes and decoded on others. */
export function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

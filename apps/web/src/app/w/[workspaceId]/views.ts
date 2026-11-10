/** The task views. Plain data: the server page and the client board both read it. */
export const VIEWS = [
  { id: "list", label: "List" },
  { id: "board", label: "Board" },
  { id: "timeline", label: "Timeline" },
] as const;
export type ViewId = (typeof VIEWS)[number]["id"];

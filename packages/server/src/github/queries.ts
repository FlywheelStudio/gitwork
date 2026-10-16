/** GraphQL documents for Projects v2. */

const FIELD_REF = "field { ... on ProjectV2FieldCommon { id } }";

export const ITEM_FIELDS = `
  id
  type
  isArchived
  updatedAt
  content {
    ... on Issue { id }
    ... on PullRequest { id }
    ... on DraftIssue { id title body }
  }
  fieldValues(first: 50) {
    nodes {
      __typename
      ... on ProjectV2ItemFieldTextValue { text ${FIELD_REF} }
      ... on ProjectV2ItemFieldNumberValue { number ${FIELD_REF} }
      ... on ProjectV2ItemFieldDateValue { date ${FIELD_REF} }
      ... on ProjectV2ItemFieldSingleSelectValue { optionId name ${FIELD_REF} }
      ... on ProjectV2ItemFieldIterationValue { iterationId title startDate duration ${FIELD_REF} }
    }
  }
`;

export const PROJECT_PAGE = `
  query ProjectPage($id: ID!, $after: String) {
    node(id: $id) {
      ... on ProjectV2 {
        id
        number
        title
        closed
        url
        owner { ... on Organization { login } ... on User { login } }
        fields(first: 50) {
          nodes {
            ... on ProjectV2FieldCommon { id name dataType }
            ... on ProjectV2SingleSelectField { options { id name color } }
            ... on ProjectV2IterationField {
              configuration {
                iterations { id title startDate duration }
                completedIterations { id title startDate duration }
              }
            }
          }
        }
        # Archived items too: the default lists only NOT_ARCHIVED, and the sweep would tombstone the rest.
        items(first: 100, after: $after, archivedStates: [ARCHIVED, NOT_ARCHIVED]) {
          pageInfo { hasNextPage endCursor }
          nodes { ${ITEM_FIELDS} }
        }
      }
    }
  }
`;

export const PROJECT_ITEM = `
  query ProjectItem($id: ID!) {
    node(id: $id) {
      ... on ProjectV2Item { ${ITEM_FIELDS} project { id } }
    }
  }
`;

export interface ProjectPageResult {
  node: {
    id: string;
    number: number;
    title: string;
    closed: boolean;
    url: string;
    owner: { login: string };
    fields: { nodes: { id?: string; name?: string; dataType?: string; options?: unknown; configuration?: unknown }[] };
    items: {
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
      nodes: import("./cache").ProjectItemNode[];
    };
  } | null;
}

/** Confirms which cached nodes still exist (and where) before a sweep tombstones them. */
export const VERIFY_NODES = `
  query VerifyNodes($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on Issue { id repository { id } }
      ... on ProjectV2Item { id project { id } }
    }
  }
`;

export interface VerifyNodesResult {
  nodes: ({ id: string; repository?: { id: string }; project?: { id: string } } | null)[];
}

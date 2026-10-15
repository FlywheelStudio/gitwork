import { handleApiRequest } from "@gitwork/server";
import { getDeps } from "@/server/context";

// Every /api/v1 route lives in @gitwork/server's router (decision 015).
const handle = (request: Request) => handleApiRequest(request, getDeps());

export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const DELETE = handle;

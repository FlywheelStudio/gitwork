import { handleApiRequest } from "@gitwork/server";
import { getDeps } from "@/server/context";

// Every /api/v1 route lives in @gitwork/server's router (decision 015).
const handle = async (request: Request) => handleApiRequest(request, await getDeps());

export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const DELETE = handle;
export const PUT = handle;

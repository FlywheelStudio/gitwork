import { getDeps } from "@/server/context";

// Better Auth's endpoints: email codes, sessions, GitHub linking.
const handle = async (request: Request) => (await getDeps()).auth.handler(request);

export const GET = handle;
export const POST = handle;

import { getAuth, handleAuthRequest } from "../../../../server/auth.ts";

// Better Auth serves every sign-in endpoint under /api/auth.
export function GET(request: Request) {
  return handleAuthRequest(getAuth(), request);
}

export function POST(request: Request) {
  return handleAuthRequest(getAuth(), request);
}

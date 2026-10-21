import type { NextRequest } from "next/server";
import { proxyToApi } from "@/lib/server/apiProxy";

// Admin same-origin API proxy: /backend/api/* and /backend/sanctum/csrf-cookie → API_INTERNAL_URL (read at request
// time). Everything else under /backend answers 404. See src/lib/server/apiProxy.ts.
export const dynamic = "force-dynamic";

function handle(request: NextRequest): Promise<Response> {
  return proxyToApi(request);
}

export { handle as GET, handle as HEAD, handle as POST, handle as PUT, handle as PATCH, handle as DELETE };

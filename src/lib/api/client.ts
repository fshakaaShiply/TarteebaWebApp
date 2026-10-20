import createClient from "openapi-fetch";
import type { paths } from "./schema";

// Typed client generated from the API's openapi.json (`pnpm gen:api`), spec §2.2.
// NEXT_PUBLIC_API_URL is the API base without the version, e.g. https://tarteeba-api.shiplytechnologies.com/api
export const api = createClient<paths>({
  baseUrl: process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api",
  credentials: "include",
  headers: { Accept: "application/json" },
});

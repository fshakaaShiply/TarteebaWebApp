// Runs once when a Next.js server starts (not during `next build`).
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { assertApiOriginAtStartup } = await import("@/lib/server/apiProxy");
  assertApiOriginAtStartup();
}

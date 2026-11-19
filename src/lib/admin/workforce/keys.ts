/*
 * Query keys of slice W4. The worker's own tabs sit under ["admin", "workers", …] so a worker write refreshes them;
 * incentives (proposals, adjustments, rules) and postings have their own roots, and attendance writes also mark the
 * incentive proposals stale on the server, so they refresh ["admin", "incentives"] too (workforceInvalidate).
 */
export const workforceKeys = {
  documents: (workerId: number, archived: boolean) => ["admin", "workers", "documents", workerId, archived] as const,
  documentsOf: (workerId: number) => ["admin", "workers", "documents", workerId] as const,
  stats: (workerId: number, from: string, to: string) => ["admin", "workers", "stats", workerId, from, to] as const,
  attendanceMonth: (workerId: number, month: string) => ["admin", "workers", "attendance", workerId, month] as const,
  attendanceOf: (workerId: number) => ["admin", "workers", "attendance", workerId] as const,
  attendanceSheet: (query: Record<string, string | number>) => ["admin", "attendance", "sheet", query] as const,
  attendanceAll: () => ["admin", "attendance"] as const,

  incentives: () => ["admin", "incentives"] as const,
  proposals: (query: Record<string, string | number>) => ["admin", "incentives", "proposals", query] as const,
  proposal: (id: number) => ["admin", "incentives", "proposal", id] as const,
  adjustments: (query: Record<string, string | number>) => ["admin", "incentives", "adjustments", query] as const,
  rules: () => ["admin", "incentives", "rules"] as const,
  rulePreview: (id: number, version: number, period: string) => ["admin", "incentives", "rule-preview", id, version, period] as const,
  postings: (query: Record<string, string | number>) => ["admin", "incentive-postings", "list", query] as const,
  postingsAll: () => ["admin", "incentive-postings"] as const,
  posting: (id: number) => ["admin", "incentive-postings", "detail", id] as const,

  waitlist: (query: Record<string, string | number>) => ["admin", "waitlist", "list", query] as const,
  waitlistAll: () => ["admin", "waitlist"] as const,
};

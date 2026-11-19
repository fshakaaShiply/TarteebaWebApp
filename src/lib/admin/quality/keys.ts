// React Query keys of A10. Everything sits under ["admin", "quality"], so one invalidation refreshes the inbox, the case,
// the accountant's queue and the ratings after a write.
export const qualityKeys = {
  all: ["admin", "quality"] as const,
  cases: () => ["admin", "quality", "cases"] as const,
  caseList: (filters: Record<string, unknown>) => ["admin", "quality", "cases", "list", filters] as const,
  case: (id: number) => ["admin", "quality", "cases", "detail", id] as const,
  assignees: () => ["admin", "quality", "assignees"] as const,
  freeVisit: (caseId: number, from: string, to: string) => ["admin", "quality", "free-visit", caseId, from, to] as const,
  compensations: () => ["admin", "quality", "compensations"] as const,
  compensationList: (filters: Record<string, unknown>) => ["admin", "quality", "compensations", "list", filters] as const,
  ratings: () => ["admin", "quality", "ratings"] as const,
  ratingList: (filters: Record<string, unknown>) => ["admin", "quality", "ratings", "list", filters] as const,
  rating: (id: number) => ["admin", "quality", "ratings", "detail", id] as const,
};

// React Query keys of A08. Everything real sits under ["admin", "subscriptions"], so one invalidation after an action
// refreshes the list, the detail and its tabs. The dry runs (previews) sit under ["admin", "subscription-previews"]: an
// action's refresh never sends them again, and a preview is only asked once per body (the shared rule of the booking
// dialogs, see CLAUDE.md "Bookings").

export const subscriptionKeys = {
  all: ["admin", "subscriptions"] as const,
  list: (filters: Record<string, unknown>) => ["admin", "subscriptions", "list", filters] as const,
  detail: (id: number) => ["admin", "subscriptions", "detail", id] as const,
  visits: (id: number, from: string, to: string) => ["admin", "subscriptions", "detail", id, "visits", from, to] as const,
  visitsOf: (id: number) => ["admin", "subscriptions", "detail", id, "visits"] as const,
  calendar: (id: number, month: string) => ["admin", "subscriptions", "detail", id, "calendar", month] as const,
  events: (id: number, page: number) => ["admin", "subscriptions", "detail", id, "events", page] as const,
  candidates: (id: number, role: string, from: string) => ["admin", "subscriptions", "detail", id, "candidates", role, from] as const,

  previews: ["admin", "subscription-previews"] as const,
  preview: (name: string, ...parts: unknown[]) => ["admin", "subscription-previews", name, ...parts] as const,
};

// React Query keys of A07. Everything sits under ["admin", "customers"], so one invalidation after a block, a note or a
// privacy request refreshes the list, the profile, its notes and the privacy queue.
export const customerKeys = {
  all: ["admin", "customers"] as const,
  list: (filters: Record<string, unknown>) => ["admin", "customers", "list", filters] as const,
  detail: (ulid: string) => ["admin", "customers", "detail", ulid] as const,
  notes: (ulid: string, page: number) => ["admin", "customers", "notes", ulid, page] as const,
  /** The profile's tabs read other modules' lists (bookings, subscriptions, payments, cases, ratings) for this customer. */
  linked: (ulid: string, list: string, page: number) => ["admin", "customers", "linked", ulid, list, page] as const,
  deletionImpact: (ulid: string) => ["admin", "customers", "deletion-impact", ulid] as const,
  privacy: () => ["admin", "customers", "privacy"] as const,
  privacyList: (filters: Record<string, unknown>) => ["admin", "customers", "privacy", "list", filters] as const,
};

// A11 content: legal pages and the FAQ.
export const legalKeys = {
  all: ["admin", "legal"] as const,
  pages: () => ["admin", "legal", "pages"] as const,
  page: (id: number) => ["admin", "legal", "pages", id] as const,
  faq: () => ["admin", "legal", "faq"] as const,
};

import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

// The admin /backend API proxy is a Route Handler (src/app/backend/[...path]/route.ts), not a rewrite: it reads
// API_INTERNAL_URL at request time and passes the admin's address, cookies and headers to the API.

const nextConfig: NextConfig = {
  // Self-contained server bundle for PM2 on the staging server (spec §23.4).
  output: "standalone",
  poweredByHeader: false,
  // Cache Components stays off: most screens are per-user and per-locale (cookie), so the
  // previous caching model keeps request-time rendering simple. Revisit for public pages.
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default withNextIntl(nextConfig);

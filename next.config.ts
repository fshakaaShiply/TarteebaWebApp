import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

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

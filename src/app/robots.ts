import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // /dashboard is auth-gated (see src/proxy.ts) and /api is not
      // human-readable content -- neither is worth crawl budget.
      disallow: ["/dashboard", "/api"],
    },
  };
}

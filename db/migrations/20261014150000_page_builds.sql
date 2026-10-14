-- Server-built SEO pages (recipe pages, the sitemap) per month, for the
-- Money tab's Netlify estimate. Cached copies never reach the function.
CREATE TABLE page_builds (
  month DATE PRIMARY KEY,
  builds INTEGER NOT NULL DEFAULT 0,
  ms BIGINT NOT NULL DEFAULT 0
);

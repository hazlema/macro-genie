import { FIXED_PAGES } from "../seo/pages.js";

// The address bar is the source of truth for where you are, so any page can
// be bookmarked, shared, refreshed, and reached with Back/Forward.
//   /                  Home, the landing page
//   /community         Community; /community/42  one post or thread
//   /foods             Food Macros
//   /builder           Recipe Builder
//   /recipes           Recipe Book; /recipes/<id>  one saved recipe (this browser);
//                      /recipes/shopping  the shopping list
//   /admin             Admin (Reviews); /admin/users, /admin/log, /admin/inbox,
//                      /admin/invites, /admin/money
//   /help, /help/<guide>   Help;  /terms /refunds /privacy /contact   policies
//   /credits           Get more credits (Stripe Checkout returns here)
//   /redeem            Redeem an invite code (only linked from invite emails)
const TABS = {
  foods: "foods",
  builder: "recipes",
  community: "community",
  recipes: "saved",
  credits: "credits",
  redeem: "redeem",
};
const PATHS = {
  foods: "/foods",
  recipes: "/builder",
  community: "/community",
  saved: "/recipes",
  credits: "/credits",
  redeem: "/redeem",
};

const ADMIN_TABS = ["reviews", "users", "log", "inbox", "invites", "money"];
const PAGES = ["terms", "refunds", "privacy", "contact"];
// Guide slugs are lowercase words; anything else shows the help hub.
const SLUG = /^[a-z]+$/;

export function parse(pathname) {
  const [section = "", id = ""] = pathname.split("/").filter(Boolean);
  const tab =
    section === "admin"
      ? "admin"
      : section === "help"
        ? "help"
        : PAGES.includes(section)
          ? "page"
          : section
            ? (TABS[section] ?? "home")
            : "home";
  return {
    tab,
    postId: tab === "community" && /^\d+$/.test(id) ? Number(id) : null,
    recipeId: tab === "saved" && id ? decodeURIComponent(id) : null,
    ...(tab === "admin"
      ? { adminTab: ADMIN_TABS.includes(id) ? id : "reviews" }
      : {}),
    ...(tab === "help" ? { helpSlug: SLUG.test(id) ? id : null } : {}),
    ...(tab === "page" ? { page: section } : {}),
  };
}

export function pathFor({
  tab,
  postId = null,
  recipeId = null,
  adminTab = null,
  helpSlug = null,
  page = null,
}) {
  if (tab === "help") return helpSlug ? `/help/${helpSlug}` : "/help";
  if (tab === "page") return `/${page}`;
  if (tab === "admin")
    return adminTab && adminTab !== "reviews" ? `/admin/${adminTab}` : "/admin";
  if (tab === "community" && postId) return `/community/${postId}`;
  if (tab === "saved" && recipeId)
    return `/recipes/${encodeURIComponent(recipeId)}`;
  return PATHS[tab] ?? "/";
}

// The tab title for a route: the prerendered page's title where there is one,
// so a page reads the same whether it was loaded directly or reached in-app.
const SECTION_TITLES = {
  "/recipes": "Recipe Book — Macro Genie",
  "/credits": "Get credits — Macro Genie",
  "/admin": "Admin — Macro Genie",
  "/redeem": "Redeem credits — Macro Genie",
};
export function titleFor(r) {
  const path = pathFor(r);
  const section = `/${path.split("/")[1] ?? ""}`;
  return (
    FIXED_PAGES.find((p) => p.path === path)?.title ??
    FIXED_PAGES.find((p) => p.path === section)?.title ??
    SECTION_TITLES[section] ??
    "Macro Genie — Food by your numbers"
  );
}

export const route = $state(parse(location.pathname));

// Goes somewhere, adding a history entry (or replacing the current one).
export function navigate(to, { replace = false } = {}) {
  const next = { tab: route.tab, postId: null, recipeId: null, ...to };
  const path = pathFor(next);
  if (path !== location.pathname)
    history[replace ? "replaceState" : "pushState"]({}, "", path);
  Object.assign(route, parse(path));
}

addEventListener("popstate", () =>
  Object.assign(route, parse(location.pathname)),
);

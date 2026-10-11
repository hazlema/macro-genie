// The address bar is the source of truth for where you are, so any page can
// be bookmarked, shared, refreshed, and reached with Back/Forward.
//   /foods             Foods (also /)
//   /builder           Recipe Builder
//   /community         Community;  /community/42  one shared recipe
//   /recipes           My recipes; /recipes/<id>  one saved recipe (this browser)
const TABS = { foods: "foods", builder: "recipes", community: "community", recipes: "saved" };
const PATHS = { foods: "/foods", recipes: "/builder", community: "/community", saved: "/recipes" };

export function parse(pathname) {
  const [section = "", id = ""] = pathname.split("/").filter(Boolean);
  const tab = TABS[section] ?? "foods";
  return {
    tab,
    postId: tab === "community" && /^\d+$/.test(id) ? Number(id) : null,
    recipeId: tab === "saved" && id ? decodeURIComponent(id) : null,
  };
}

export function pathFor({ tab, postId = null, recipeId = null }) {
  if (tab === "community" && postId) return `/community/${postId}`;
  if (tab === "saved" && recipeId) return `/recipes/${encodeURIComponent(recipeId)}`;
  return PATHS[tab] ?? "/foods";
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

addEventListener("popstate", () => Object.assign(route, parse(location.pathname)));

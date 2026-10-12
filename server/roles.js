import { UserFacingError } from "./chef.js";
import { database } from "./db.js";

// Who may do what. Owners are the Google accounts listed in ADMIN_SUBS:
// always admin, so no one can lock the site's owner out from the admin page.
// Everyone else's roles live on their account row.
export const SUSPENDED = "Your account is suspended.";

const ownerSubs = () =>
  (process.env.ADMIN_SUBS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
export const isOwnerSub = (sub) => !!sub && ownerSubs().includes(sub);

const NOBODY = {
  exists: false,
  owner: false,
  admin: false,
  mod: false,
  suspended: false,
  displayName: "",
};

export async function roleOf(accountId) {
  if (!accountId) return NOBODY;
  const rows = await database().sql`
    SELECT google_sub, display_name, is_admin, is_mod, suspended_at
      FROM accounts WHERE id = ${accountId}`;
  const row = rows[0];
  if (!row) return NOBODY;
  const owner = isOwnerSub(row.google_sub);
  const admin = owner || row.is_admin;
  return {
    exists: true,
    owner,
    admin,
    mod: admin || row.is_mod,
    suspended: !owner && !!row.suspended_at,
    displayName: row.display_name,
  };
}

export async function requireMod(accountId) {
  const role = await roleOf(accountId);
  if (!role.mod) throw new UserFacingError("Only moderators can do that.", 403);
  return role;
}

export async function requireAdmin(accountId) {
  const role = await roleOf(accountId);
  if (!role.admin) throw new UserFacingError("Only admins can do that.", 403);
  return role;
}

// For anything that changes the community or spends credits.
export async function requireActive(accountId) {
  const role = await roleOf(accountId);
  if (!role.exists)
    throw new UserFacingError("Your account wasn't found. Sign in again.", 401);
  if (role.suspended) throw new UserFacingError(SUSPENDED, 403);
  return role;
}

import { offerTour } from "./tour.svelte.js";

// The signed-in account as the page sees it. The server is the source of
// truth; this mirrors /api/me and the balances AI responses send back.
export const account = $state({
  loaded: false,
  signedIn: false,
  displayName: "",
  credits: 0,
  isAdmin: false,
  isMod: false,
  isOwner: false,
  suspended: false,
  googleClientId: null,
  loginOpen: false,
});

function apply(body) {
  account.signedIn = !!body?.signedIn;
  account.displayName = body?.account?.displayName ?? "";
  account.credits = body?.account?.credits ?? 0;
  account.isAdmin = !!body?.account?.isAdmin;
  account.isMod = !!body?.account?.isMod;
  account.isOwner = !!body?.account?.isOwner;
  account.suspended = !!body?.account?.suspended;
  if (body && "googleClientId" in body)
    account.googleClientId = body.googleClientId;
}

export async function refreshAccount() {
  try {
    const res = await fetch("/api/me");
    if (res.ok) apply(await res.json());
  } catch {
    // Offline or functions not running: stay signed out.
  } finally {
    account.loaded = true;
  }
}

// Sends Google's ID token to the server, which signs us in (or creates the
// account). Returns an error message, or "" when it worked.
export async function signInWithGoogle(credential) {
  try {
    const res = await fetch("/api/auth/google", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ credential }),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) return body?.error ?? "Sign-in didn't go through. Try again.";
    apply(body);
    account.loginOpen = false;
    // A just-created account gets the one-time tour offer.
    if (body?.isNew) offerTour(account.displayName);
    return "";
  } catch {
    return "Couldn't reach the site. Check your connection and try again.";
  }
}

export async function signOut() {
  await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
  apply({ signedIn: false });
}

// AI responses carry the balance left after their own spend. Jobs running
// side by side can answer out of order, and jobs only ever lower a balance,
// so the lowest one seen is the current one. A failed job was refunded, so
// the balance is re-read from the server.
export function noteResponse(res, body) {
  if (typeof body?.credits === "number")
    account.credits = Math.min(account.credits, body.credits);
  if (res.status === 401) {
    account.signedIn = false;
    account.loginOpen = true;
  } else if (!res.ok) refreshAccount();
}

// Changes the name shown on community posts. Returns an error message or "".
export async function changeDisplayName(name) {
  try {
    const res = await fetch("/api/me/name", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ displayName: name }),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) return body?.error ?? "Couldn't change your name. Try again.";
    account.displayName = body.displayName;
    return "";
  } catch {
    return "Couldn't reach the site. Check your connection and try again.";
  }
}

// A JSON request to the community API. Returns { ok, status, body }, and
// opens the sign-in dialog when the server asks for an account.
export async function api(path, { method = "GET", body } = {}) {
  try {
    const res = await fetch(path, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => null);
    if (res.status === 401) {
      account.signedIn = false;
      account.loginOpen = true;
    }
    return {
      ok: res.ok,
      status: res.status,
      body: data,
      error: res.ok
        ? ""
        : (data?.error ??
          (res.status === 429
            ? "You're doing that faster than the site allows. Wait a minute, then try again."
            : "Something went wrong. Try again.")),
    };
  } catch {
    return {
      ok: false,
      status: 0,
      body: null,
      error: "Couldn't reach the site. Check your connection and try again.",
    };
  }
}

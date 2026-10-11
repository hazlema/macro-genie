// The signed-in account as the page sees it. The server is the source of
// truth; this mirrors /api/me and the balances AI responses send back.
export const account = $state({
  loaded: false,
  signedIn: false,
  displayName: "",
  credits: 0,
  googleClientId: null,
  loginOpen: false,
});

function apply(body) {
  account.signedIn = !!body?.signedIn;
  account.displayName = body?.account?.displayName ?? "";
  account.credits = body?.account?.credits ?? 0;
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

import { addCredits, getAccount } from "./accounts.js";
import { logActivity } from "./activity.js";
import { transaction } from "./db.js";
import { UserFacingError } from "./chef.js";
import { packById } from "./packs.js";
import { requireActive } from "./roles.js";
import { UNAVAILABLE, stripe } from "./stripe.js";

// "$6", "$3.60"
export const dollars = (cents) =>
  `$${(cents / 100).toFixed(2).replace(/\.00$/, "")}`;

// Runs a Stripe call. A missing object becomes `missing` (when given) as a
// 404; anything else (network, bad key) becomes one plain 503.
async function callStripe(work, { missing = null } = {}) {
  try {
    return await work(stripe());
  } catch (error) {
    if (error instanceof UserFacingError) throw error;
    if (missing && error?.statusCode === 404)
      throw new UserFacingError(missing, 404);
    console.error("stripe:", error);
    throw new UserFacingError(UNAVAILABLE, 503);
  }
}

// Starts a Stripe Checkout for one pack and returns the page to send them to.
// No Stripe customer is created; Stripe asks for an email only for its receipt.
export async function startCheckout(accountId, packId, origin) {
  const pack = packById(packId);
  if (!pack) throw new UserFacingError("Pick one of the credit packs.", 400);
  if (!accountId) throw new UserFacingError("Sign in to buy credits.", 401);
  await requireActive(accountId);
  const metadata = {
    accountId: String(accountId),
    pack: pack.id,
    credits: String(pack.credits),
  };
  const session = await callStripe((s) =>
    s.checkout.sessions.create({
      mode: "payment",
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: pack.cents,
            product_data: { name: `${pack.credits} Macro Genie credits` },
          },
        },
      ],
      client_reference_id: String(accountId),
      metadata,
      payment_intent_data: { metadata },
      success_url: `${origin}/credits?session={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/credits?cancelled=1`,
    }),
  );
  return { url: session.url };
}

const balanceOf = async (accountId) =>
  accountId ? ((await getAccount(accountId))?.credits ?? 0) : 0;

// Adds a paid checkout's credits. The webhook and the return page both call
// this; the ledger's unique (reason, ref) means only the first one counts.
// Only Stripe's own copy of the session is trusted, never the browser.
export async function fulfill(sessionOrId) {
  const session =
    typeof sessionOrId === "string"
      ? await callStripe((s) => s.checkout.sessions.retrieve(sessionOrId))
      : sessionOrId;
  const accountId = Number(session.metadata?.accountId) || null;
  if (session.payment_status !== "paid")
    return { paid: false, purchased: 0, credits: await balanceOf(accountId) };
  const pack = packById(session.metadata?.pack);
  const problem = (text) =>
    logActivity({ kind: "payment_problem", accountId, actorName: "Stripe", text });
  if (
    !accountId ||
    !pack ||
    pack.credits !== Number(session.metadata?.credits) ||
    pack.cents !== session.amount_total ||
    session.currency !== "usd"
  ) {
    await problem(
      `paid checkout ${session.id} (${session.amount_total} ${session.currency}) doesn't match a pack; no credits added`,
    );
    return { paid: true, purchased: 0, credits: await balanceOf(accountId) };
  }
  const account = await getAccount(accountId);
  if (!account) {
    // activity_log.account_id references accounts, so a deleted id can't be logged.
    await logActivity({
      kind: "payment_problem",
      accountId: null,
      actorName: "Stripe",
      text: `paid checkout ${session.id} is for account ${accountId}, which no longer exists; refund it in Stripe`,
    });
    return { paid: true, purchased: 0, credits: 0 };
  }
  const after = await addCredits(accountId, pack.credits, "purchase", session.id);
  if (after !== null)
    await logActivity({
      kind: "credits_purchase",
      accountId,
      actorName: account.displayName,
      text: `bought ${pack.credits} credits (${dollars(pack.cents)})`,
    });
  return {
    paid: true,
    purchased: pack.credits,
    credits: after ?? (await balanceOf(accountId)),
  };
}

// The page Stripe sends people back to asks for its credits right away, so
// they don't wait on the webhook. Only the buyer may confirm their checkout.
export async function confirmPurchase(accountId, sessionId) {
  if (!accountId) throw new UserFacingError("Sign in to see your purchase.", 401);
  const id = String(sessionId ?? "");
  if (!/^cs_[A-Za-z0-9_]{1,200}$/.test(id))
    throw new UserFacingError("That payment link isn't valid.", 400);
  const session = await callStripe((s) => s.checkout.sessions.retrieve(id), {
    missing: "That payment wasn't found.",
  });
  if (Number(session.metadata?.accountId) !== accountId)
    throw new UserFacingError("That payment belongs to another account.", 403);
  return fulfill(session);
}

// A refund from the Stripe dashboard takes back credits in proportion to the
// money returned. Stripe reports the total refunded so far, so each event
// tops up to that total. Never below zero: credits already spent stay spent.
export async function applyRefund(charge) {
  const pi =
    typeof charge.payment_intent === "string"
      ? charge.payment_intent
      : charge.payment_intent?.id;
  if (!pi || !charge.amount) return { removed: 0 };
  const intent = await callStripe((s) => s.paymentIntents.retrieve(pi));
  const accountId = Number(intent.metadata?.accountId) || null;
  const pack = packById(intent.metadata?.pack);
  if (!accountId || !pack) return { removed: 0 };
  const target = Math.min(
    pack.credits,
    Math.round((pack.credits * charge.amount_refunded) / charge.amount),
  );
  const result = await transaction(async (client) => {
    const held = await client.query(
      `SELECT credits, display_name FROM accounts WHERE id = $1 FOR UPDATE`,
      [accountId],
    );
    const account = held.rows[0];
    if (!account) return null;
    const taken = await client.query(
      `SELECT COALESCE(-SUM(change), 0) AS taken FROM credit_ledger
        WHERE reason = 'refund_purchase' AND split_part(ref, ':', 1) = $1`,
      [pi],
    );
    const wanted = target - Number(taken.rows[0].taken);
    if (wanted <= 0) return null;
    const balance = Number(account.credits);
    const removed = Math.min(wanted, balance);
    const logged = await client.query(
      `INSERT INTO credit_ledger (account_id, change, reason, ref)
       VALUES ($1, $2, 'refund_purchase', $3)
       ON CONFLICT (reason, ref) DO NOTHING RETURNING id`,
      [accountId, -removed, `${pi}:${charge.amount_refunded}`],
    );
    if (!logged.rows[0]) return null;
    await client.query(
      `UPDATE accounts SET credits = credits - $2 WHERE id = $1`,
      [accountId, removed],
    );
    return { removed, wanted, balance, name: account.display_name };
  });
  if (!result) return { removed: 0 };
  await logActivity({
    kind: "credits_refund",
    accountId,
    actorName: result.name,
    text:
      result.removed === result.wanted
        ? `refunded ${dollars(charge.amount_refunded)}, removed ${result.removed} credits`
        : `refunded ${dollars(charge.amount_refunded)}, removed ${result.removed} of ${result.wanted}; balance was ${result.balance}`,
  });
  return { removed: result.removed };
}

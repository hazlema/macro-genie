import { addCredits, getAccount } from "./accounts.js";
import { logActivity } from "./activity.js";
import { database, transaction } from "./db.js";
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

// Stripe's category for AI tools used through a website, for personal use.
// Managed Payments only sells products whose category it accepts.
const TAX_CODE = "txcd_10105001";

// Starts a Stripe Checkout for one pack and returns the page to send them to.
// No Stripe customer is created. Stripe is the seller (Managed Payments): it
// asks for a name and billing address, works the sales tax out of the
// pack's price, and files it.
export async function startCheckout(accountId, packId, origin) {
  const pack = packById(packId);
  if (!pack) throw new UserFacingError("Pick one of the credit packs.", 400);
  if (!accountId) throw new UserFacingError("Sign in to buy credits.", 401);
  await requireActive(accountId);
  const metadata = {
    accountId: String(accountId),
    pack: pack.id,
    credits: String(pack.credits),
    cents: String(pack.cents),
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
            // Tax comes out of the price, so the buyer pays exactly the pack's
            // price and fulfill's amount check still holds.
            tax_behavior: "inclusive",
            product_data: { name: `${pack.credits} Macro Genie credits`, tax_code: TAX_CODE },
          },
        },
      ],
      client_reference_id: String(accountId),
      metadata,
      payment_intent_data: { metadata },
      managed_payments: { enabled: true },
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
// Only Stripe's own copy of the session is trusted, never the browser. The
// session is judged against the pack as it was sold (its metadata), so a
// later price change never refuses credits to someone who already paid.
export async function fulfill(sessionOrId) {
  const session =
    typeof sessionOrId === "string"
      ? await callStripe((s) => s.checkout.sessions.retrieve(sessionOrId))
      : sessionOrId;
  const paid = session.payment_status === "paid";
  const metadata = session.metadata ?? {};
  // The Stripe account sells other things too; those sessions aren't ours.
  if (!metadata.accountId || !metadata.credits)
    return { paid, purchased: 0, credits: 0 };
  const accountId = Number(metadata.accountId) || null;
  if (!paid)
    return { paid: false, purchased: 0, credits: await balanceOf(accountId) };
  const credits = Number(metadata.credits);
  const cents = Number(metadata.cents);
  const problem = (text) =>
    logActivity({ kind: "payment_problem", accountId, actorName: "Stripe", text });
  if (
    !accountId ||
    !Number.isInteger(credits) ||
    credits <= 0 ||
    session.amount_total !== cents ||
    session.currency !== "usd"
  ) {
    await problem(
      `paid checkout ${session.id} (${session.amount_total} ${session.currency}) doesn't match its pack (${metadata.pack}); no credits added`,
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
  const after = await addCredits(accountId, credits, "purchase", session.id, { paid: true });
  if (after !== null)
    await logActivity({
      kind: "credits_purchase",
      accountId,
      actorName: account.displayName,
      text: `bought ${credits} credits (${dollars(cents)})`,
    });
  // A repeat reports what the first one added: 0 if a refund beat it here.
  const purchased =
    after !== null
      ? credits
      : Number(
          (
            await database().sql`
              SELECT change FROM credit_ledger WHERE reason = 'purchase' AND ref = ${session.id}`
          )[0]?.change ?? credits,
        );
  return {
    paid: true,
    purchased,
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
// tops up to that total. Only credits this payment actually added can be
// taken back, and never below zero: credits already spent stay spent.
// A chargeback counts the disputed amount as returned too.
export async function applyRefund(charge, { disputedCents = 0, what = "refunded" } = {}) {
  const pi =
    typeof charge.payment_intent === "string"
      ? charge.payment_intent
      : charge.payment_intent?.id;
  if (!pi || !charge.amount) return { removed: 0 };
  const intent = await callStripe((s) => s.paymentIntents.retrieve(pi));
  const accountId = Number(intent.metadata?.accountId) || null;
  if (!accountId || !intent.metadata?.credits) return { removed: 0 };
  const returned = Math.min(
    charge.amount,
    (charge.amount_refunded ?? 0) + disputedCents,
  );
  if (returned <= 0) return { removed: 0 };
  const found = await callStripe((s) =>
    s.checkout.sessions.list({ payment_intent: pi, limit: 1 }),
  );
  const sessionId = found?.data?.[0]?.id ?? null;
  const result = await transaction(async (client) => {
    // By ref alone: a deleted account's purchase stays, with no account.
    const bought = sessionId
      ? await client.query(
          `SELECT change, account_id FROM credit_ledger
            WHERE reason = 'purchase' AND ref = $1`,
          [sessionId],
        )
      : { rows: [] };
    const purchased = Number(bought.rows[0]?.change ?? 0);
    if (purchased <= 0) {
      // Money went back before the credits arrived (the webhook was still
      // retrying). Mark the checkout done so a late fulfill adds nothing.
      if (sessionId && !bought.rows[0]) {
        const owner = await client.query(`SELECT id FROM accounts WHERE id = $1`, [accountId]);
        await client.query(
          `INSERT INTO credit_ledger (account_id, change, reason, ref, paid)
           VALUES ($1, 0, 'purchase', $2, true)
           ON CONFLICT (reason, ref) DO NOTHING`,
          [owner.rows[0] ? accountId : null, sessionId],
        );
      }
      return { nothingAdded: true };
    }
    const target = Math.min(
      purchased,
      Math.round((purchased * returned) / charge.amount),
    );
    const taken = await client.query(
      `SELECT COALESCE(-SUM(change), 0) AS taken FROM credit_ledger
        WHERE reason = 'refund_purchase' AND split_part(ref, ':', 1) = $1`,
      [pi],
    );
    const wanted = target - Number(taken.rows[0].taken);
    if (wanted <= 0) return null;
    const owner = bought.rows[0].account_id;
    const held = owner
      ? await client.query(
          `SELECT credits, display_name FROM accounts WHERE id = $1 FOR UPDATE`,
          [owner],
        )
      : { rows: [] };
    const account = held.rows[0];
    // A deleted account's credits went with it; the row still records the
    // refunded credits so the Money tab's credits sold stays right.
    const removed = account ? Math.min(wanted, Number(account.credits)) : 0;
    const logged = await client.query(
      `INSERT INTO credit_ledger (account_id, change, reason, ref, paid)
       VALUES ($1, $2, 'refund_purchase', $3, true)
       ON CONFLICT (reason, ref) DO NOTHING RETURNING id`,
      [account ? owner : null, account ? -removed : -wanted, `${pi}:${returned}`],
    );
    if (!logged.rows[0]) return null;
    if (account)
      await client.query(
        `UPDATE accounts
            SET credits = credits - $2,
                paid_credits = GREATEST(0, LEAST(paid_credits - $2, credits - $2))
          WHERE id = $1`,
        [owner, removed],
      );
    return {
      removed,
      wanted,
      balance: account ? Number(account.credits) : 0,
      name: account?.display_name,
      gone: !account,
    };
  });
  if (!result) return { removed: 0 };
  // activity_log.account_id references accounts, so a deleted id can't be logged.
  const liveId = async () => ((await getAccount(accountId)) ? accountId : null);
  if (result.nothingAdded) {
    await logActivity({
      kind: "payment_problem",
      accountId: await liveId(),
      actorName: "Stripe",
      text: `${what} ${dollars(returned)} for ${pi}, which added no credits (yet); nothing taken back, and none will be added`,
    });
    return { removed: 0 };
  }
  if (result.gone) {
    await logActivity({
      kind: "payment_problem",
      accountId: null,
      actorName: "Stripe",
      text: `${what} ${dollars(returned)} for ${pi}, whose account was deleted; its credits were already gone`,
    });
    return { removed: 0 };
  }
  await logActivity({
    kind: "credits_refund",
    accountId,
    actorName: result.name,
    text:
      result.removed === result.wanted
        ? `${what} ${dollars(returned)}, removed ${result.removed} credits`
        : `${what} ${dollars(returned)}, removed ${result.removed} of ${result.wanted}; balance was ${result.balance}`,
  });
  return { removed: result.removed };
}

// A chargeback: the bank pulls the money back, so the credits go too, as
// with a refund. Stripe doesn't send charge.refunded for these.
export async function applyDispute(dispute) {
  const chargeId = typeof dispute.charge === "string" ? dispute.charge : dispute.charge?.id;
  if (!chargeId) return { removed: 0 };
  const charge = await callStripe((s) => s.charges.retrieve(chargeId));
  return applyRefund(charge, {
    disputedCents: dispute.amount ?? charge.amount,
    what: `charged back (${dispute.reason ?? "no reason given"})`,
  });
}

// Stripe's calls to /api/stripe/webhook. The signature proves Stripe sent it.
export async function handleWebhook(rawBody, signature) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    console.error("stripe: STRIPE_WEBHOOK_SECRET is not set");
    throw new UserFacingError(UNAVAILABLE, 503);
  }
  let event;
  try {
    event = stripe().webhooks.constructEvent(rawBody, signature ?? "", secret);
  } catch (error) {
    if (error instanceof UserFacingError) throw error;
    throw new UserFacingError("Invalid signature.", 400);
  }
  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded":
      await fulfill(event.data.object.id);
      break;
    case "charge.refunded":
      await applyRefund(event.data.object);
      break;
    case "charge.dispute.created":
      await applyDispute(event.data.object);
      break;
  }
  return { received: true };
}

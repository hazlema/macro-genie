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

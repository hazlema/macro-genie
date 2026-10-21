// Plain-language policy pages. Drafts for the owner to review; not legal
// advice. Keep "updated" in step with real changes.
const updated = "October 21, 2026";

const terms = `**What this is.** Macro Genie helps you find foods and build recipes that fit your nutrition targets. Food search, the Community, and the MCP server are free. The Recipe Builder uses credits.

**Your account.** You sign in with Google. You're responsible for what happens on your account, and you need to be old enough to agree to these terms where you live.

**Credits.** New accounts get 10 free credits. Each recipe idea and each written recipe uses one credit, and a job that fails gets its credit back automatically. Credits have no cash value, don't expire, and can't be transferred to another account. Purchased credits can be refunded as described on the [Refunds](/refunds) page.

**Using the Community.** Be decent. No harassment, hate, spam, advertising, or anything illegal. Posts and comments are checked automatically and by a person when unsure, and we can remove anything that breaks these rules.

**Nutrition and AI.** Recipe ideas are written by an AI, and nutrition numbers are estimates worked out from USDA data. Cooking, brands, and portions change real values. They're estimates, not medical advice: check labels and talk to a professional about medical diets or allergies.

**Suspending accounts.** We may suspend or remove accounts that break these terms. A suspended account can still browse but can't post or use credits.

**No guarantees.** Macro Genie is provided as is. We work to keep it running and accurate but can't promise it always will be.

**Changes.** We may update these terms; the date above changes when we do. Questions? [Contact us](/contact).`;

const refunds = `**Unused credits.** Unused credits from a pack you bought can be refunded within 30 days of purchase.

**Used credits.** Credits you've already used can't be refunded.

**Failed jobs.** If a recipe idea or written recipe fails, its credit is refunded automatically. You don't need to ask.

**Free credits.** The 10 welcome credits aren't refundable.

**How to ask.** [Contact us](/contact) with the topic "Refund" and the email on your receipt. Refunds go back to the original payment method and usually show up within 5 to 10 business days.`;

const privacy = `**What we store.** Your Google account id, your display name, your credits and credit history, your community posts, comments, likes, and reports, and messages you send us.

**What we don't.** We don't keep a password, and your account doesn't hold your email: when you sign in, Google tells us only an id and your first name, which becomes your display name (you can change it).

**Messages you send us.** If you use the contact form, we keep your message and the email you type with it so we can reply.

**Invites.** If we email you an invite with free credits, we keep the address it went to in an admin-only list so we don't write twice. It's never linked to an account, and we delete it if you ask.

**What stays in your browser.** Your Recipe Book, the foods you won't eat, and the recipe in progress are saved on your device, not on our servers.

**Who handles data for us.** Netlify hosts the site. Neon stores the database. Anthropic's Claude writes recipe ideas and recipes from the foods and targets you send. Google handles sign-in. Stripe processes payments, and we never see card numbers.

**No ads or trackers.** We don't show ads, sell data, or use tracking scripts.

**Chatting from your AI.** The MCP server only answers food and recipe questions. It's read-only and keeps nothing about you.

**Deleting your data.** [Contact us](/contact) with the topic "Delete my data" and we'll remove your account, everything it owns, and your messages to us. We keep the record of credits bought and used, with dates and amounts but nothing that names you, because tax rules require us to keep payment records.

**Changes.** We'll update this page if anything changes; the date above changes when we do.`;

export const POLICIES = {
  terms: { title: "Terms of use", updated, body: terms },
  refunds: { title: "Refunds", updated, body: refunds },
  privacy: { title: "Privacy", updated, body: privacy },
};

import { getAccount, refundCredit, spendCredit } from "./accounts.js";
import { UserFacingError } from "./chef.js";
import { requireActive } from "./roles.js";
import { readSession } from "./session.js";

// Runs an AI job for the signed-in account, paid with one credit. The credit
// is taken first and given back if the job fails, so no one pays for errors.
export async function withCredit(request, reason, job) {
  const accountId = readSession(request);
  if (!accountId)
    throw new UserFacingError(
      "Sign in to use the Recipe Builder. New accounts get 10 free credits.",
      401,
    );
  await requireActive(accountId);
  const spend = await spendCredit(accountId, reason);
  if (spend === null) {
    const account = await getAccount(accountId);
    if (!account)
      throw new UserFacingError(
        "Your account wasn't found. Sign in again.",
        401,
      );
    throw new UserFacingError("Not enough credits.", 402);
  }
  try {
    const result = await job();
    return { ...result, credits: spend.credits };
  } catch (error) {
    await refundCredit(accountId, reason, spend.paid);
    throw error;
  }
}

export type SubscriptionIdentity = {
  stripeSubscriptionId: string;
  stripeCustomerId: string;
};

export function shouldSyncSubscription(
  existing: SubscriptionIdentity | null,
  incoming: SubscriptionIdentity,
  allowReplacement = false,
): boolean {
  if (!existing) return true;
  if (existing.stripeCustomerId !== incoming.stripeCustomerId) return false;
  return existing.stripeSubscriptionId === incoming.stripeSubscriptionId || allowReplacement;
}

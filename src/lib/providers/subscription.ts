/** Architecture-only seam for a future supported account-usage source. */
export interface SubscriptionUsage {
  fiveHourUsed?: number; fiveHourRemaining?: number; weeklyUsed?: number; weeklyRemaining?: number;
  weeklyResetAt?: string; creditsRemaining?: number; bankedResets?: number; plan?: string;
}
export interface SubscriptionUsageProvider { getSubscriptionUsage(): Promise<SubscriptionUsage | undefined>; }

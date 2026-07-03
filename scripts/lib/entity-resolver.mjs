export function resolveEntitySlug(account, transactionDate) {
  const rules = Array.isArray(account.date_rules) ? account.date_rules : [];

  // A rule matches only when BOTH bounds are satisfied (C17). The old code returned on the `until`
  // check ALONE, so a rule with both `from` and `until` matched ANY date <= until regardless of
  // `from`. Missing bounds stay open-ended; first match wins in rule order.
  for (const rule of rules) {
    if (!rule.entity_slug) continue;
    const afterFrom = !rule.from || transactionDate >= rule.from;
    const beforeUntil = !rule.until || transactionDate <= rule.until;
    if (afterFrom && beforeUntil) return rule.entity_slug;
  }

  return account.default_entity?.slug ?? null;
}

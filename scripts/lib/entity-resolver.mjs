export function resolveEntitySlug(account, transactionDate) {
  const rules = Array.isArray(account.date_rules) ? account.date_rules : [];

  for (const rule of rules) {
    if (rule.until && transactionDate <= rule.until && rule.entity_slug) {
      return rule.entity_slug;
    }

    if (rule.from && transactionDate >= rule.from && rule.entity_slug) {
      return rule.entity_slug;
    }
  }

  return account.default_entity?.slug ?? null;
}

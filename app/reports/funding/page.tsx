import { redirect } from "next/navigation";

type Props = {
  searchParams: Promise<Record<string, string | undefined>>;
};

/** @deprecated Use /reports/business-expenses-personal-cards */
export default async function FundingRedirectPage({ searchParams }: Props) {
  const params = await searchParams;
  const query = new URLSearchParams();
  if (params.period) query.set("period", params.period);
  if (params.at) query.set("at", params.at);
  if (params.month) query.set("month", params.month);
  const suffix = query.toString() ? `?${query.toString()}` : "";
  redirect(`/reports/business-expenses-personal-cards${suffix}`);
}

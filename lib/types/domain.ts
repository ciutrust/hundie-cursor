// Hand-written domain types. Survives `npm run gen:types` (which now writes database.generated.ts).
import type { Database } from "./database.generated";

export type Entity = Database["public"]["Tables"]["entities"]["Row"]
export type Category = Database["public"]["Tables"]["categories"]["Row"]
export type Transaction = Database["public"]["Tables"]["transactions"]["Row"]
export type Classification = Database["public"]["Tables"]["classifications"]["Row"]
export type Account = Database["public"]["Tables"]["accounts"]["Row"]

export type TransactionWithDetails = Transaction & {
  account: Pick<Account, "id" | "display_name" | "slug" | "account_type">
  classification: Classification & {
    entity: Pick<Entity, "id" | "name" | "slug">
    category: Pick<Category, "id" | "full_path"> | null
  }
}

export type EntitySummary = {
  slug: string
  name: string
  total: number
  previousMonthTotal: number | null
  transactionCount: number
  unclassifiedCount: number
  /** Gross positive spend (operating + excluded + still-to-classify) so the total reconciles. */
  grossTotal: number
  /** Categorized but non-expense (transfers, refunds, redirects) — excluded from `total`. */
  excludedTotal: number
  /** Positive amount still uncategorized / AMA — the "$ remaining to classify". */
  unclassifiedTotal: number
}

export type ReviewDashboardStats = {
  grandTotal: number
  previousGrandTotal: number
  totalTransactions: number
  unclassifiedCount: number
  amaCount: number
  aiPreclassifiedCount: number
  taxReadyCount: number
  taxReadyNames: string[]
  classifiableEntityCount: number
}

export type MonthlyEntityRow = {
  slug: string
  name: string
  months: Record<number, number>
  monthCounts: Record<number, number>
  ytd: number
  ytdCount: number
  isUnclassified?: boolean
}

export type MonthlyCategoryRow = {
  categoryId: string | null
  categoryName: string
  months: Record<number, number>
  monthCounts: Record<number, number>
  ytd: number
  ytdCount: number
  isUnclassified?: boolean
}

export type CategoryGroup = {
  categoryId: string | null
  categoryName: string
  total: number
  transactions: TransactionWithDetails[]
}

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      accounts: {
        Row: {
          account_type: Database["public"]["Enums"]["account_type"]
          created_at: string
          date_rules: Json
          default_entity_id: string | null
          display_name: string
          id: string
          is_active: boolean
          issuer_parser: string
          mixed_use: boolean
          slug: string
          updated_at: string
        }
        Insert: {
          account_type?: Database["public"]["Enums"]["account_type"]
          created_at?: string
          date_rules?: Json
          default_entity_id?: string | null
          display_name: string
          id?: string
          is_active?: boolean
          issuer_parser: string
          mixed_use?: boolean
          slug: string
          updated_at?: string
        }
        Update: {
          account_type?: Database["public"]["Enums"]["account_type"]
          created_at?: string
          date_rules?: Json
          default_entity_id?: string | null
          display_name?: string
          id?: string
          is_active?: boolean
          issuer_parser?: string
          mixed_use?: boolean
          slug?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "accounts_default_entity_id_fkey"
            columns: ["default_entity_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
        ]
      }
      categories: {
        Row: {
          created_at: string
          entity_id: string
          full_path: string
          id: string
          is_active: boolean
          name: string
          parent_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          entity_id: string
          full_path: string
          id?: string
          is_active?: boolean
          name: string
          parent_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          entity_id?: string
          full_path?: string
          id?: string
          is_active?: boolean
          name?: string
          parent_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "categories_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "categories_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      classifications: {
        Row: {
          category_id: string | null
          classified_at: string
          classified_by: string
          entity_id: string
          id: string
          notes: string | null
          transaction_id: string
        }
        Insert: {
          category_id?: string | null
          classified_at?: string
          classified_by?: string
          entity_id: string
          id?: string
          notes?: string | null
          transaction_id: string
        }
        Update: {
          category_id?: string | null
          classified_at?: string
          classified_by?: string
          entity_id?: string
          id?: string
          notes?: string | null
          transaction_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "classifications_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "classifications_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "classifications_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: true
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      entities: {
        Row: {
          created_at: string
          display_order: number
          id: string
          is_classifiable: boolean
          name: string
          slug: string
          status: Database["public"]["Enums"]["entity_status"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_order?: number
          id?: string
          is_classifiable?: boolean
          name: string
          slug: string
          status?: Database["public"]["Enums"]["entity_status"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_order?: number
          id?: string
          is_classifiable?: boolean
          name?: string
          slug?: string
          status?: Database["public"]["Enums"]["entity_status"]
          updated_at?: string
        }
        Relationships: []
      }
      import_batches: {
        Row: {
          account_id: string | null
          entity_id: string | null
          id: string
          imported_at: string
          row_count: number
          source_file: string
          source_type: string
        }
        Insert: {
          account_id?: string | null
          entity_id?: string | null
          id?: string
          imported_at?: string
          row_count?: number
          source_file: string
          source_type: string
        }
        Update: {
          account_id?: string | null
          entity_id?: string | null
          id?: string
          imported_at?: string
          row_count?: number
          source_file?: string
          source_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "import_batches_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "import_batches_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
        ]
      }
      qb_training_expenses: {
        Row: {
          amount: number
          category_id: string | null
          category_name: string
          created_at: string
          description: string | null
          entity_id: string
          id: string
          import_batch_id: string | null
          import_hash: string
          source_account: string
          transaction_date: string
          transaction_num: string | null
          transaction_type: string
          vendor_name: string | null
        }
        Insert: {
          amount: number
          category_id?: string | null
          category_name: string
          created_at?: string
          description?: string | null
          entity_id: string
          id?: string
          import_batch_id?: string | null
          import_hash: string
          source_account: string
          transaction_date: string
          transaction_num?: string | null
          transaction_type: string
          vendor_name?: string | null
        }
        Update: {
          amount?: number
          category_id?: string | null
          category_name?: string
          created_at?: string
          description?: string | null
          entity_id?: string
          id?: string
          import_batch_id?: string | null
          import_hash?: string
          source_account?: string
          transaction_date?: string
          transaction_num?: string | null
          transaction_type?: string
          vendor_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "qb_training_expenses_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qb_training_expenses_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qb_training_expenses_import_batch_id_fkey"
            columns: ["import_batch_id"]
            isOneToOne: false
            referencedRelation: "import_batches"
            referencedColumns: ["id"]
          },
        ]
      }
      raw_import_rows: {
        Row: {
          account_id: string
          created_at: string
          id: string
          import_batch_id: string
          raw_data: Json
          row_number: number
        }
        Insert: {
          account_id: string
          created_at?: string
          id?: string
          import_batch_id: string
          raw_data: Json
          row_number: number
        }
        Update: {
          account_id?: string
          created_at?: string
          id?: string
          import_batch_id?: string
          raw_data?: Json
          row_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "raw_import_rows_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "raw_import_rows_import_batch_id_fkey"
            columns: ["import_batch_id"]
            isOneToOne: false
            referencedRelation: "import_batches"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_suggestions: {
        Row: {
          confidence: string
          created_at: string
          entity_id: string
          entity_slug: string
          id: string
          input_tokens: number | null
          is_current: boolean
          model: string
          output_tokens: number | null
          rationale: string
          suggested_category_id: string | null
          suggested_category_path: string | null
          transaction_id: string
          vendor_group_key: string
        }
        Insert: {
          confidence: string
          created_at?: string
          entity_id: string
          entity_slug: string
          id?: string
          input_tokens?: number | null
          is_current?: boolean
          model: string
          output_tokens?: number | null
          rationale: string
          suggested_category_id?: string | null
          suggested_category_path?: string | null
          transaction_id: string
          vendor_group_key?: string
        }
        Update: {
          confidence?: string
          created_at?: string
          entity_id?: string
          entity_slug?: string
          id?: string
          input_tokens?: number | null
          is_current?: boolean
          model?: string
          output_tokens?: number | null
          rationale?: string
          suggested_category_id?: string | null
          suggested_category_path?: string | null
          transaction_id?: string
          vendor_group_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_suggestions_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_suggestions_suggested_category_id_fkey"
            columns: ["suggested_category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_suggestions_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      suggestion_events: {
        Row: {
          chosen_category_id: string | null
          classification_id: string | null
          created_at: string
          created_by: string | null
          entity_id: string
          event_type: "accept" | "reject" | "manual"
          id: string
          suggested_category_id: string | null
          suggestion_source: string | null
          transaction_id: string | null
          vendor_key: string
        }
        Insert: {
          chosen_category_id?: string | null
          classification_id?: string | null
          created_at?: string
          created_by?: string | null
          entity_id: string
          event_type: "accept" | "reject" | "manual"
          id?: string
          suggested_category_id?: string | null
          suggestion_source?: string | null
          transaction_id?: string | null
          vendor_key?: string
        }
        Update: {
          chosen_category_id?: string | null
          classification_id?: string | null
          created_at?: string
          created_by?: string | null
          entity_id?: string
          event_type?: "accept" | "reject" | "manual"
          id?: string
          suggested_category_id?: string | null
          suggestion_source?: string | null
          transaction_id?: string | null
          vendor_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "suggestion_events_chosen_category_id_fkey"
            columns: ["chosen_category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "suggestion_events_classification_id_fkey"
            columns: ["classification_id"]
            isOneToOne: false
            referencedRelation: "classifications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "suggestion_events_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "suggestion_events_suggested_category_id_fkey"
            columns: ["suggested_category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "suggestion_events_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      transactions: {
        Row: {
          account_id: string
          amount: number
          created_at: string
          description: string
          id: string
          import_batch_id: string | null
          import_hash: string
          posted_date: string | null
          raw_category: string | null
          transaction_date: string
          vendor: string | null
        }
        Insert: {
          account_id: string
          amount: number
          created_at?: string
          description: string
          id?: string
          import_batch_id?: string | null
          import_hash: string
          posted_date?: string | null
          raw_category?: string | null
          transaction_date: string
          vendor?: string | null
        }
        Update: {
          account_id?: string
          amount?: number
          created_at?: string
          description?: string
          id?: string
          import_batch_id?: string | null
          import_hash?: string
          posted_date?: string | null
          raw_category?: string | null
          transaction_date?: string
          vendor?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "transactions_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_import_batch_id_fkey"
            columns: ["import_batch_id"]
            isOneToOne: false
            referencedRelation: "import_batches"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      account_type: "credit_card" | "checking" | "savings"
      entity_status: "active" | "dormant" | "trust"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

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

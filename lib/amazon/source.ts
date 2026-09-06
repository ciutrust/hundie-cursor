/**
 * Amazon order source adapters.
 * Personal CSV/zip is implemented; Business API is a documented stub for phase 2.
 */

import { parseAmazonExportBytes } from "@/lib/amazon/parse";
import type { AmazonImportSource, ParsedAmazonExport } from "@/lib/amazon/types";

export type AmazonOrderSource = {
  source: AmazonImportSource;
  /** Ingest bytes into the shared shipment model. */
  parse(bytes: Uint8Array, fileName: string): Promise<ParsedAmazonExport> | ParsedAmazonExport;
};

export const personalCsvSource: AmazonOrderSource = {
  source: "personal_export",
  parse(bytes, fileName) {
    return parseAmazonExportBytes(bytes, fileName);
  },
};

/**
 * Phase 2: Amazon Business purchasing API / Analytics.
 * Same `amazon_*` tables with source = 'business_api'. Not implemented in v1.
 */
export const businessApiSource: AmazonOrderSource = {
  source: "business_api",
  parse() {
    throw new Error(
      "Amazon Business sync is not configured yet. Use a personal Your Orders export for now — see docs/AMAZON-DESK.md.",
    );
  },
};

export function getAmazonOrderSource(source: AmazonImportSource): AmazonOrderSource {
  return source === "business_api" ? businessApiSource : personalCsvSource;
}

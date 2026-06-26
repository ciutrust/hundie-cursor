export type AiConfidence = "high" | "medium" | "low";

/** Model-reported confidence, calibrated down — never auto-apply. */
export function calibrateConfidence(reported: string | null | undefined): AiConfidence {
  const value = reported?.toLowerCase().trim();
  if (value === "high") return "medium";
  if (value === "medium") return "low";
  return "low";
}

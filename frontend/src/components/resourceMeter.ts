export type ResourceSeverity = "healthy" | "mid" | "low";

export function resourceSeverity(percent: number): ResourceSeverity {
  if (percent <= 15) return "low";
  if (percent <= 40) return "mid";
  return "healthy";
}

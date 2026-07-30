export * from "../formatting/numbers";

// Compatibility names for callers that have not yet migrated to named presets.
export { formatStageDeltaV as formatDeltaV } from "../formatting/numbers";
export { formatInclination as formatDegrees } from "../formatting/numbers";
export { formatRateColumn as formatRate } from "../formatting/numbers";

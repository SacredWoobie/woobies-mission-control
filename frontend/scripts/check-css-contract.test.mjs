import { describe, expect, it } from "vitest";
import {
  checkCssContract,
  collectCustomProperties,
  contrastRatio,
  maskCommentsAndStrings,
} from "./check-css-contract.mjs";

describe("CSS contract checker", () => {
  it("ignores comments and quoted text while preserving line positions", () => {
    const source = `/* var(--comment-only) */\n.demo::after { content: "var(--string-only)"; color: var(--real); }`;
    const masked = maskCommentsAndStrings(source);
    const properties = collectCustomProperties(source);

    expect(masked.split("\n")).toHaveLength(2);
    expect(properties.references.map((reference) => reference.name)).toEqual(["--real"]);
  });

  it("reports undefined properties but accepts CSS and runtime declarations", () => {
    const result = checkCssContract([{
      file: "src/styles.css",
      text: `:root { --panel: #0f151f; --danger: #f87171; }\n.a { color: var(--missing); }\n.b { margin-left: var(--contract-depth); }`,
    }]);

    expect(result.failures).toContain("src/styles.css:2 references undefined --missing.");
    expect(result.failures.some((failure) => failure.includes("--contract-depth"))).toBe(false);
  });

  it("calculates stable WCAG contrast ratios", () => {
    expect(contrastRatio("#748197", "#0f151f")).toBeCloseTo(4.65, 2);
    expect(contrastRatio("#4a5568", "#0f151f")).toBeCloseTo(2.43, 2);
  });
});

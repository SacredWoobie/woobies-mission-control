import { describe, expect, it } from "vitest";
import {
  checkCssContract,
  collectPixelFontSizes,
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

  it("finds undersized font-size and font shorthand declarations", () => {
    const source = `.ok { font-size: 8px; }\n.too-small { font: 700 7px/1 var(--mono); }\n/* .ignored { font-size: 6px; } */`;

    expect(collectPixelFontSizes(source).map((size) => size.pixels)).toEqual([8, 7]);
    const result = checkCssContract([{ file: "src/styles.css", text: `:root { --panel: #0f151f; --danger: #f87171; }\n${source}` }]);
    expect(result.failures).toContain("src/styles.css:3 sets 7px text; the operational text floor is 8px.");
  });

  it("reserves slate-dim for non-text decoration", () => {
    const result = checkCssContract([{
      file: "src/styles.css",
      text: `:root { --panel: #0f151f; --danger: #f87171; --slate-dim: #4a5568; }\n.label { color: var(--slate-dim); }\n.rule { border-color: var(--slate-dim); }`,
    }]);

    expect(result.failures).toContain("src/styles.css:2 uses low-contrast --slate-dim for text; use --slate-muted-text or a stronger semantic text token.");
    expect(result.failures.some((failure) => failure.includes("src/styles.css:3"))).toBe(false);
  });
});

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cssFiles = [
  "src/styles.css",
  "src/resonantOrbit/resonantOrbit.css",
];

// These properties are supplied by React style objects rather than CSS.
const runtimeCustomProperties = new Set([
  "--contract-depth",
  "--flight-fixed-region-width",
  "--flight-tabbed-region-width",
]);

// Literal enforcement is deliberately incremental. Add a token here only
// after every ordinary use of its exact color has migrated to var(...).
const canonicalLiteralTokens = new Set([
  "--accent-border",
  "--accent-border-hover",
  "--amber-accent",
  "--control-surface",
  "--control-surface-hover",
  "--danger",
  "--error-text",
  "--error-text-muted",
  "--instrument-surface",
  "--surface-amber-face-bottom",
  "--surface-amber-face-edge",
  "--surface-amber-face-text",
  "--surface-amber-face-top",
  "--surface-bezel-color",
  "--surface-bezel-lit",
  "--surface-cyan-face-bottom",
  "--surface-cyan-face-edge",
  "--surface-cyan-face-top",
  "--surface-grout",
  "--surface-panel-bottom",
  "--surface-panel-top",
  "--surface-plate-bottom",
  "--surface-plate-edge",
  "--surface-plate-top",
  "--surface-progress-bottom",
  "--surface-progress-top",
  "--surface-raised-top",
  "--surface-rail-bottom",
  "--surface-rail-top",
  "--surface-status-cell-top",
  "--surface-status-frame",
  "--surface-track",
  "--surface-well-bottom",
  "--surface-well-top",
  "--success-border",
  "--text-primary",
  "--text-value",
]);

// Surface gradients must be composed from inspectable, opaque stops. Keeping
// this separate from literal migration lets a stop participate in a gradient
// without making every intentional screw, lens, or illustration literal fail.
const opaqueSurfaceBackgroundTokens = new Set([
  "--surface-panel-top",
  "--surface-panel-bottom",
  "--surface-plate-top",
  "--surface-plate-bottom",
  "--surface-well-top",
  "--surface-well-bottom",
  "--surface-rail-top",
  "--surface-rail-bottom",
  "--surface-raised-top",
  "--surface-raised-bottom",
  "--surface-amber-face-top",
  "--surface-amber-face-bottom",
  "--surface-cyan-face-top",
  "--surface-cyan-face-bottom",
  "--surface-status-frame",
  "--surface-status-cell-top",
  "--surface-status-cell-bottom",
  "--surface-track",
  "--surface-progress-top",
  "--surface-progress-bottom",
]);

const contrastContracts = [
  { foreground: "--slate-muted-text", background: "--panel", minimum: 4.5 },
  { foreground: "--slate", background: "--panel", minimum: 4.5 },
  { foreground: "--text-primary", background: "--panel", minimum: 4.5 },
  { foreground: "--text-value", background: "--panel", minimum: 4.5 },
  { foreground: "--cyan", background: "--panel", minimum: 4.5 },
  { foreground: "--amber", background: "--panel", minimum: 4.5 },
  { foreground: "--warn", background: "--panel", minimum: 4.5 },
  { foreground: "--danger", background: "--panel", minimum: 4.5 },
  { foreground: "--error-text", background: "--panel", minimum: 4.5 },
  { foreground: "--error-text-muted", background: "--panel", minimum: 4.5 },
  { foreground: "--text-primary", background: "--surface-panel-top", minimum: 4.5 },
  { foreground: "--text-primary", background: "--surface-plate-top", minimum: 4.5 },
  { foreground: "--text-value", background: "--surface-well-bottom", minimum: 4.5 },
  { foreground: "--slate", background: "--surface-rail-top", minimum: 4.5 },
  { foreground: "--slate-muted-text", background: "--surface-status-cell-top", minimum: 4.5 },
  { foreground: "--cyan", background: "--surface-cyan-face-top", minimum: 4.5 },
  { foreground: "--surface-amber-face-text", background: "--surface-amber-face-top", minimum: 4.5 },
];

const minimumPixelFontSize = 8;

export function maskCommentsAndStrings(source) {
  let output = "";
  let state = "code";
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];
    if (state === "code" && character === "/" && next === "*") {
      output += "  ";
      index += 1;
      state = "comment";
    } else if (state === "comment" && character === "*" && next === "/") {
      output += "  ";
      index += 1;
      state = "code";
    } else if (state === "code" && (character === "\"" || character === "'")) {
      output += " ";
      state = character === "\"" ? "double-quote" : "single-quote";
    } else if (
      (state === "double-quote" && character === "\"")
      || (state === "single-quote" && character === "'")
    ) {
      output += " ";
      state = "code";
    } else if ((state === "double-quote" || state === "single-quote") && character === "\\") {
      output += " ";
      if (index + 1 < source.length) {
        output += source[index + 1] === "\n" ? "\n" : " ";
        index += 1;
      }
    } else if (state === "code") {
      output += character;
    } else {
      output += character === "\n" ? "\n" : " ";
    }
  }
  return output;
}

export function collectCustomProperties(source) {
  const masked = maskCommentsAndStrings(source);
  const declarations = new Map();
  const references = [];
  for (const match of masked.matchAll(/(--[a-z0-9-]+)\s*:/gi)) {
    if (!declarations.has(match[1])) declarations.set(match[1], []);
    declarations.get(match[1]).push(match.index);
  }
  for (const match of masked.matchAll(/var\(\s*(--[a-z0-9-]+)(?:\s*,[^)]*)?\)/gi)) {
    references.push({ name: match[1], index: match.index });
  }
  return { declarations, references };
}

export function lineNumberAt(source, index) {
  return source.slice(0, index).split("\n").length;
}

export function collectPixelFontSizes(source) {
  const masked = maskCommentsAndStrings(source);
  const sizes = [];
  for (const match of masked.matchAll(/\b(font-size|font)\s*:\s*([^;{}]+)/gi)) {
    const property = match[1].toLowerCase();
    const value = match[2];
    const sizeMatch = property === "font-size"
      ? value.match(/^\s*(\d*\.?\d+)px\b/i) ?? value.match(/^\s*clamp\(\s*(\d*\.?\d+)px\b/i)
      : value.match(/(?:^|\s)(\d*\.?\d+)px(?:\s*\/|\s|$)/i)
        ?? value.match(/(?:^|\s)clamp\(\s*(\d*\.?\d+)px\b/i);
    if (!sizeMatch) continue;
    sizes.push({ index: match.index, pixels: Number.parseFloat(sizeMatch[1]) });
  }
  return sizes;
}

function expandHex(value) {
  const normalized = value.toLowerCase();
  if (/^#[0-9a-f]{3}$/.test(normalized)) {
    return `#${[...normalized.slice(1)].map((character) => character.repeat(2)).join("")}`;
  }
  return normalized;
}

function channelLuminance(value) {
  const channel = value / 255;
  return channel <= 0.04045
    ? channel / 12.92
    : ((channel + 0.055) / 1.055) ** 2.4;
}

export function contrastRatio(foreground, background) {
  const luminance = (hex) => {
    const value = expandHex(hex).slice(1);
    const channels = [0, 2, 4].map((offset) => channelLuminance(Number.parseInt(value.slice(offset, offset + 2), 16)));
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  };
  const first = luminance(foreground);
  const second = luminance(background);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

export function checkCssContract(sources) {
  const failures = [];
  const declarations = new Map();
  const references = [];
  for (const source of sources) {
    const collected = collectCustomProperties(source.text);
    for (const [name, indexes] of collected.declarations) {
      if (!declarations.has(name)) declarations.set(name, []);
      declarations.get(name).push(...indexes.map((index) => ({ file: source.file, index, text: source.text })));
    }
    references.push(...collected.references.map((reference) => ({ ...reference, file: source.file, text: source.text })));
  }

  for (const reference of references) {
    if (declarations.has(reference.name) || runtimeCustomProperties.has(reference.name)) continue;
    failures.push(`${reference.file}:${lineNumberAt(reference.text, reference.index)} references undefined ${reference.name}.`);
  }

  for (const source of sources) {
    for (const size of collectPixelFontSizes(source.text)) {
      if (size.pixels >= minimumPixelFontSize) continue;
      failures.push(`${source.file}:${lineNumberAt(source.text, size.index)} sets ${size.pixels}px text; the operational text floor is ${minimumPixelFontSize}px.`);
    }
    const masked = maskCommentsAndStrings(source.text);
    for (const match of masked.matchAll(/(?:^|[;{])\s*color\s*:\s*var\(\s*--slate-dim\s*\)/gim)) {
      failures.push(`${source.file}:${lineNumberAt(source.text, match.index)} uses low-contrast --slate-dim for text; use --slate-muted-text or a stronger semantic text token.`);
    }
  }

  const rootSource = sources.find((source) => source.file === "src/styles.css");
  const rootBlock = rootSource?.text.match(/:root\s*\{([\s\S]*?)\}/)?.[1] ?? "";
  const rootStart = rootSource?.text.indexOf(rootBlock) ?? -1;
  const rootColorDefinitions = new Map(
    [...rootBlock.matchAll(/(--[a-z0-9-]+)\s*:\s*(#[0-9a-f]{3}|#[0-9a-f]{6})\s*;/gi)]
      .map((match) => [match[1], {
        line: lineNumberAt(rootSource.text, rootStart + match.index),
        literal: expandHex(match[2]),
      }]),
  );
  const rootColors = new Map([...rootColorDefinitions].map(([name, definition]) => [name, definition.literal]));

  for (const token of opaqueSurfaceBackgroundTokens) {
    if (!rootColors.has(token)) {
      failures.push(`Surface background stop ${token} must be defined as an opaque hex color in :root.`);
    }
  }

  for (const token of canonicalLiteralTokens) {
    const literal = rootColors.get(token);
    if (!literal) {
      failures.push(`Canonical literal token ${token} must be defined as an opaque hex color in :root.`);
      continue;
    }
    for (const source of sources) {
      const masked = maskCommentsAndStrings(source.text);
      const lines = masked.split("\n");
      lines.forEach((line, index) => {
        const definition = rootColorDefinitions.get(token);
        if (source.file === rootSource?.file && index + 1 === definition?.line) return;
        const literals = [...line.matchAll(/#[0-9a-f]{3}(?:[0-9a-f]{3})?\b/gi)].map((match) => expandHex(match[0]));
        if (literals.includes(literal)) {
          failures.push(`${source.file}:${index + 1} uses ${literal} directly; use var(${token}).`);
        }
      });
    }
  }

  for (const contract of contrastContracts) {
    const foreground = rootColors.get(contract.foreground);
    const background = rootColors.get(contract.background);
    if (!foreground || !background) continue;
    const ratio = contrastRatio(foreground, background);
    if (ratio + Number.EPSILON < contract.minimum) {
      failures.push(`${contract.foreground} contrast against ${contract.background} is ${ratio.toFixed(2)}:1; expected at least ${contract.minimum.toFixed(1)}:1.`);
    }
  }

  return {
    declarations: declarations.size,
    failures,
    references: references.length,
  };
}

function run() {
  const sources = cssFiles.map((file) => ({
    file,
    text: fs.readFileSync(path.join(frontendRoot, file), "utf8"),
  }));
  const result = checkCssContract(sources);
  if (result.failures.length > 0) {
    console.error("CSS contract check failed:");
    result.failures.forEach((failure) => console.error(`- ${failure}`));
    process.exitCode = 1;
    return;
  }
  console.log(`CSS contract check passed (${cssFiles.length} files, ${result.declarations} declared properties, ${result.references} references).`);
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) run();

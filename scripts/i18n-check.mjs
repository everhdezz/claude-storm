// Lists English source strings used with t()/tn() that a locale catalog does not translate,
// and catalog entries no longer used. Usage: npm run i18n:check
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const SRC = new URL("../src/", import.meta.url).pathname;
const LOCALES = join(SRC, "i18n/locales");

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "i18n" || name === "dev" ? [] : walk(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

// t("…") and tn(count, "…", "…"); only plain double-quoted literals are translatable keys.
const LITERAL = String.raw`"((?:[^"\\]|\\.)*)"`;
const CALL = new RegExp(String.raw`\bt\(\s*${LITERAL}|\btn\(\s*[^,]+,\s*${LITERAL}\s*,\s*${LITERAL}`, "g");
const used = new Set();
for (const file of walk(SRC)) {
  for (const m of readFileSync(file, "utf8").matchAll(CALL)) {
    for (const key of [m[1], m[2], m[3]]) if (key !== undefined) used.add(JSON.parse(`"${key}"`));
  }
}

let missingTotal = 0;
for (const file of readdirSync(LOCALES).filter((f) => f.endsWith(".ts"))) {
  const text = readFileSync(join(LOCALES, file), "utf8");
  const keys = new Set([...text.matchAll(new RegExp(String.raw`^\s*${LITERAL}:`, "gm"))].map((m) => JSON.parse(`"${m[1]}"`)));
  const missing = [...used].filter((k) => !keys.has(k));
  const unused = [...keys].filter((k) => !used.has(k));
  missingTotal += missing.length;
  console.log(`${file}: ${keys.size} entries, ${missing.length} missing, ${unused.length} unused`);
  for (const k of missing) console.log(`  missing: ${JSON.stringify(k)}`);
  for (const k of unused) console.log(`  unused:  ${JSON.stringify(k)}`);
}
console.log(`${used.size} translatable strings in the code.`);
process.exit(missingTotal > 0 ? 1 : 0);

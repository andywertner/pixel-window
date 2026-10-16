// Flags CSS and JS features newer than Chrome 103 (school Chromebooks) in source and built output.
import fs from "node:fs";
import path from "node:path";

const root = new URL("..", import.meta.url).pathname;
const files = [];
for (const dir of ["src", "dist/assets"]) {
  const full = path.join(root, dir);
  if (!fs.existsSync(full)) continue;
  for (const name of fs.readdirSync(full)) if (/\.(css|ts|js)$/.test(name) && !name.endsWith(".test.ts")) files.push(path.join(full, name));
}

const cssRules = [
  [/:has\(/, ":has() needs Chrome 105"],
  [/(^|[;{\s])(translate|rotate|scale)\s*:/, "individual transform properties need Chrome 104; use transform"],
  [/\d(cqw|cqh|cqi|cqb|cqmin|cqmax)\b/, "container query units need Chrome 105"],
  [/\d(dvh|svh|lvh|dvw|svw|lvw|dvb|svb)\b/, "dvh/svh need Chrome 108; use vh"],
  [/@container/, "container queries need Chrome 105"],
  [/color-mix\(/, "color-mix() needs Chrome 111"],
  [/text-wrap\s*:/, "text-wrap needs Chrome 114"],
  [/\d(lh|rlh)\b/, "lh units need Chrome 109"],
  [/:nth-child\([^)]*\bof\b/, ":nth-child(of) needs Chrome 111"],
  [/\bsubgrid\b/, "subgrid needs Chrome 117"],
  [/inset-area|position-area|anchor\(/, "anchor positioning needs Chrome 125"],
  [/\{[^}]*&[\s.:>#[]/, "CSS nesting needs Chrome 112"],
  [/@scope/, "@scope needs Chrome 118"],
  [/\bpopover\b/, "popover needs Chrome 114"],
  [/\binitial-letter\b/, "initial-letter needs Chrome 110"],
];
const jsRules = [
  [/AbortSignal\.timeout/, "AbortSignal.timeout is Chrome 103 exactly; avoid"],
  [/\.(toSorted|toReversed|toSpliced)\(/, "change-by-copy arrays need Chrome 110"],
  [/\.with\(\s*\d/, "Array.prototype.with needs Chrome 110"],
  [/Object\.groupBy|Map\.groupBy/, "groupBy needs Chrome 117"],
  [/Promise\.withResolvers/, "Promise.withResolvers needs Chrome 119"],
  [/URL\.canParse/, "URL.canParse needs Chrome 120"],
  [/Array\.fromAsync/, "Array.fromAsync needs Chrome 121"],
  [/\.(union|intersection|difference|symmetricDifference|isSubsetOf|isSupersetOf|isDisjointFrom)\(/, "Set methods need Chrome 122"],
  [/isWellFormed|toWellFormed/, "String well-formed needs Chrome 111"],
  [/navigator\.userAgentData/, "userAgentData is fine but unneeded; check usage"],
  [/\bstructuredClone\b/, "structuredClone is Chrome 98; fine, listed for awareness"],
  [/showPopover|hidePopover/, "popover API needs Chrome 114"],
  [/\bscheduler\.(yield|postTask)/, "scheduler API needs Chrome 115/94"],
  [/\.replaceChildren\(/, "replaceChildren is Chrome 86; fine"],
  [/\bat\(-?\d+\)/, "Array.at is Chrome 92; fine"],
];

let problems = 0;
for (const file of files) {
  // Comments may mention the very features we ban, so strip them first.
  const text = fs.readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  const isCss = file.endsWith(".css");
  // Inline styles in template strings can carry CSS too, so JS files get the value-level CSS rules.
  const all = isCss ? cssRules : [...jsRules, ...cssRules.filter(([, why]) => !/nesting|popover|individual transform/.test(why))];
  for (const [regex, why] of all) {
    const match = regex.exec(text);
    if (!match) continue;
    if (/fine/.test(why)) continue;
    const line = text.slice(0, match.index).split("\n").length;
    console.log(`${path.relative(root, file)}:${line}: ${why} -> ${match[0].trim().slice(0, 40)}`);
    problems += 1;
  }
}
if (problems) {
  console.log(`${problems} problem(s)`);
  process.exit(1);
}
console.log(`css/js audit ok (${files.length} files)`);

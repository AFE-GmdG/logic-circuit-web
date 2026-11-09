import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DOCS_DIR = path.resolve(__dirname, "../docs");
const NUMBERED_PATTERN = /^(\s*#{1,6}\s*\d+[\.\)]|\s*\d+[\.\)]\s+|\s*\/\/\s*\d+[\.\)])/m;

// Dateien mit legitimen Negativbeispielen
const IGNORED_FILES = new Set([
  "coding-rules.md",
]);

function scanDir(dir) {
  let hasErrors = false;
  if (!fs.existsSync(dir)) {
    return false;
  }
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== "node_modules") {
      if (scanDir(fullPath)) {
        hasErrors = true;
      }
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      if (IGNORED_FILES.has(entry.name)) {
        continue;
      }

      const content = fs.readFileSync(fullPath, "utf-8");
      const lines = content.split("\n");
      for (const [index, line] of lines.entries()) {
        if (NUMBERED_PATTERN.test(line)) {
          console.error(
            `\x1b[31m[Lint Markdown]\x1b[0m ${fullPath}:${index + 1}: Nummerierte Struktur gefunden: "${line.trim()}"`,
          );
          hasErrors = true;
        }
      }
    }
  }
  return hasErrors;
}

if (scanDir(DOCS_DIR)) {
  process.exit(1);
} else {
  console.log("Markdown-Prüfung erfolgreich.");
}

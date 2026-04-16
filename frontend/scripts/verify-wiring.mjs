#!/usr/bin/env node
/**
 * scripts/verify-wiring.mjs
 * --------------------------
 * Statically verify that every import in the frontend source resolves
 * to an existing file. Run before `npm run build` in CI.
 *
 * Usage:
 *   node scripts/verify-wiring.mjs
 */

import { readFileSync, existsSync, readdirSync, statSync } from "fs";
import { join, dirname, resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC       = resolve(__dirname, "../src");
const ALIAS     = { "@": SRC };
const EXTS      = [".js", ".jsx", ".ts", ".tsx"];

let errors = 0;
let checks = 0;

function resolveAlias(path) {
  for (const [alias, target] of Object.entries(ALIAS)) {
    if (path.startsWith(alias + "/")) {
      return path.replace(alias, target);
    }
  }
  return null;
}

function fileExists(importPath) {
  if (existsSync(importPath)) return true;
  for (const ext of EXTS) {
    if (existsSync(importPath + ext)) return true;
  }
  // Check index file
  for (const ext of EXTS) {
    if (existsSync(join(importPath, "index" + ext))) return true;
  }
  return false;
}

function scanFile(filePath) {
  const content = readFileSync(filePath, "utf-8");
  const importRe = /(?:import|from)\s+["'](@\/[^"']+)["']/g;
  let match;
  while ((match = importRe.exec(content)) !== null) {
    const importStr = match[1];
    const resolved  = resolveAlias(importStr);
    if (!resolved) continue;
    checks++;
    if (!fileExists(resolved)) {
      console.error(`  ❌  ${filePath.replace(SRC, "src")}`);
      console.error(`       └─ cannot resolve: "${importStr}"`);
      errors++;
    }
  }
}

function scanDir(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      scanDir(full);
    } else if (EXTS.some((e) => entry.endsWith(e))) {
      scanFile(full);
    }
  }
}

console.log("🔍  Verifying frontend imports…\n");
scanDir(SRC);

if (errors === 0) {
  console.log(`✅  All ${checks} imports resolve correctly.\n`);
  process.exit(0);
} else {
  console.error(`\n❌  ${errors} broken import(s) found in ${checks} total checks.\n`);
  process.exit(1);
}

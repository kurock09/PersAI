#!/usr/bin/env node
// One-shot utility used during ADR-128 Slice 4 to bulk-flatten test fixtures
// after the `/workspace/input/` and `/workspace/outbound/<handle>/` subdirs
// were retired in favour of a single `/workspace/` namespace.
//
// This script is intentionally narrow: it only edits the path strings that
// were used as fixture data inside test files. It does NOT touch comments,
// migrations, or anything outside the listed test directories.
//
// After this lands, the script is no longer needed and can be deleted as
// part of the next sweep.

import { readFileSync, writeFileSync } from "node:fs";
import { argv } from "node:process";

const files = argv.slice(2);
if (files.length === 0) {
  console.error("usage: node flatten-workspace-test-paths.mjs <file1> <file2> ...");
  process.exit(1);
}

let totalChanged = 0;
for (const file of files) {
  const original = readFileSync(file, "utf8");
  let next = original;

  // Order matters: the longest-match path goes first so the smaller patterns
  // don't accidentally chew off the prefix.
  next = next.replaceAll(/\/workspace\/outbound\/self\/([^\s"'`]+)/g, "/workspace/$1");
  next = next.replaceAll(/\/workspace\/outbound\/[a-z0-9_-]+\/([^\s"'`]+)/g, "/workspace/$1");
  next = next.replaceAll(/\/workspace\/outbound\/self\b/g, "/workspace");
  next = next.replaceAll(/\/workspace\/outbound\b/g, "/workspace");
  next = next.replaceAll(/\/workspace\/input\/([^\s"'`]+)/g, "/workspace/$1");
  next = next.replaceAll(/\/workspace\/input\b/g, "/workspace");

  if (next !== original) {
    writeFileSync(file, next, "utf8");
    totalChanged += 1;
    console.log(`updated: ${file}`);
  }
}

console.log(`done. files changed: ${totalChanged}`);

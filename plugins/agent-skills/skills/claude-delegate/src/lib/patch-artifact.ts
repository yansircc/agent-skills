/**
 * Generate unified diff patches from workspace snapshots without requiring git.
 */
import { renameSync, writeFileSync } from "node:fs";
import path from "node:path";

import { createTwoFilesPatch } from "diff";

import { hasSemanticChange } from "./workspace.js";

function unifiedDiff(
  pathStr: string,
  beforeContent: string,
  afterContent: string,
): string {
  return createTwoFilesPatch(
    `a/${pathStr}`,
    `b/${pathStr}`,
    beforeContent,
    afterContent,
    undefined,
    undefined,
    { context: 3 },
  );
}

export function generatePatch(
  snapshotBefore: Record<string, Record<string, unknown>>,
  snapshotAfter: Record<string, Record<string, unknown>>,
  cwd: string,
): string {
  const patchLines: string[] = [];
  const allPaths = [
    ...new Set([
      ...Object.keys(snapshotBefore),
      ...Object.keys(snapshotAfter),
    ]),
  ].sort();
  const cwdPath = path.resolve(cwd);

  for (const pathStr of allPaths) {
    const beforeEntry = snapshotBefore[pathStr] ?? null;
    const afterEntry = snapshotAfter[pathStr] ?? null;

    if (!hasSemanticChange(beforeEntry, afterEntry)) continue;

    // Compute relative path for display
    const rel = path.relative(cwdPath, pathStr);
    const relative = rel.startsWith("..") ? pathStr : rel;

    // Get content from snapshots (may be undefined for binary/large files)
    const beforeContent =
      beforeEntry !== null ? (beforeEntry.content as string | undefined) ?? null : null;
    const afterContent =
      afterEntry !== null ? (afterEntry.content as string | undefined) ?? null : null;

    if (beforeContent === null && afterContent === null) {
      // Both binary/large — skip patch generation but note it
      if (beforeEntry !== null && afterEntry === null) {
        patchLines.push(`--- a/${relative}\n`);
        patchLines.push("+++ /dev/null\n");
        patchLines.push("Binary file deleted (content not captured)\n");
      } else if (afterEntry !== null && beforeEntry === null) {
        patchLines.push("--- /dev/null\n");
        patchLines.push(`+++ b/${relative}\n`);
        patchLines.push("Binary file added (content not captured)\n");
      } else {
        patchLines.push(`--- a/${relative}\n`);
        patchLines.push(`+++ b/${relative}\n`);
        patchLines.push("Binary file modified (content not captured)\n");
      }
      continue;
    }

    // File was deleted
    if (beforeEntry !== null && afterEntry === null) {
      if (beforeContent !== null) {
        patchLines.push(unifiedDiff(relative, beforeContent, ""));
      } else {
        patchLines.push(`--- a/${relative}\n`);
        patchLines.push("+++ /dev/null\n");
        patchLines.push("Binary file deleted\n");
      }
      continue;
    }

    // File was added
    if (beforeEntry === null && afterEntry !== null) {
      if (afterContent !== null) {
        patchLines.push(unifiedDiff(relative, "", afterContent));
      } else {
        patchLines.push("--- /dev/null\n");
        patchLines.push(`+++ b/${relative}\n`);
        patchLines.push("Binary file added\n");
      }
      continue;
    }

    // File was modified
    if (beforeEntry !== null && afterEntry !== null) {
      if (beforeContent !== null && afterContent !== null) {
        patchLines.push(unifiedDiff(relative, beforeContent, afterContent));
      } else {
        const beforeSize = beforeEntry.size ?? "?";
        const afterSize = afterEntry.size ?? "?";
        patchLines.push(`--- a/${relative}\n`);
        patchLines.push(`+++ b/${relative}\n`);
        patchLines.push(
          `Binary file modified (${beforeSize} -> ${afterSize} bytes)\n`,
        );
      }
    }
  }

  return patchLines.join("");
}

export function writePatchArtifact(
  patchContent: string,
  patchPath: string,
): void {
  const tmpPath = patchPath + ".tmp";
  writeFileSync(tmpPath, patchContent);
  renameSync(tmpPath, patchPath);
}

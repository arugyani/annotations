import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { cpus, platform, release, arch } from "node:os";
import { gzipSync } from "node:zlib";

/** Identify the measured source and actual build, independently of report edits. */
export function benchmarkMetadata() {
  const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
  const assets = Object.fromEntries(
    ["main.js", "styles.css", "manifest.json"].map((name) => {
      const bytes = readFileSync(name);
      return [
        name,
        {
          bytes: bytes.length,
          gzipBytes: gzipSync(bytes).length,
          sha256: createHash("sha256").update(bytes).digest("hex"),
        },
      ];
    }),
  );
  return {
    measuredAt: new Date().toISOString(),
    pluginVersion: manifest.version,
    sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim(),
    pluginSourceChanged: Boolean(
      execFileSync(
        "git",
        ["status", "--porcelain", "--", "src", "manifest.json"],
        {
          encoding: "utf8",
        },
      ).trim(),
    ),
    runtime: process.version,
    platform: platform(),
    osRelease: release(),
    architecture: arch(),
    cpu: cpus()[0]?.model,
    logicalCpus: cpus().length,
    assets,
  };
}

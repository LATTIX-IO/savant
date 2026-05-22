import { spawnSync } from "node:child_process";
import { readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const IGNORED_DIRECTORIES = new Set([
  ".git",
  ".next",
  ".turbo",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "out",
]);
const TEST_FILE_PATTERN = /\.(?:test|spec)\.(?:[cm]?[jt]s)$/i;

async function collectTestFiles(directoryPath) {
  const entries = await readdir(directoryPath, { withFileTypes: true });
  const testFiles = [];

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (IGNORED_DIRECTORIES.has(entry.name)) {
        continue;
      }

      testFiles.push(...(await collectTestFiles(path.join(directoryPath, entry.name))));
      continue;
    }

    if (entry.isFile() && TEST_FILE_PATTERN.test(entry.name)) {
      testFiles.push(path.join(directoryPath, entry.name));
    }
  }

  return testFiles;
}

const absoluteTestFiles = (await collectTestFiles(ROOT_DIR)).sort((left, right) =>
  left.localeCompare(right),
);

if (absoluteTestFiles.length === 0) {
  console.error("No test files matching *.test.[jt]s or *.spec.[jt]s were found.");
  process.exit(1);
}

const relativeTestFiles = absoluteTestFiles.map((filePath) => path.relative(ROOT_DIR, filePath));
console.log(`Running ${relativeTestFiles.length} test file(s)...`);

const result = spawnSync(
  process.execPath,
  ["--test", "--experimental-strip-types", ...relativeTestFiles],
  {
    cwd: ROOT_DIR,
    stdio: "inherit",
  },
);

if (result.error) {
  throw result.error;
}

if (result.signal) {
  console.error(`Node test runner exited due to signal ${result.signal}.`);
  process.exit(1);
}

process.exit(result.status ?? 1);

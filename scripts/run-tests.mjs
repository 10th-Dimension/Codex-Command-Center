import { spawn } from "node:child_process";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const testsDirectory = fileURLToPath(new URL("../tests/", import.meta.url));
const testFilePattern = /\.(?:test|spec)\.(?:[cm]?[jt]sx?)$/i;

async function findTestFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return findTestFiles(path);
    return entry.isFile() && testFilePattern.test(entry.name) ? [path] : [];
  }));

  return files.flat();
}

let testFiles = [];

try {
  testFiles = await findTestFiles(testsDirectory);
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

testFiles.sort((left, right) => left.localeCompare(right));

if (testFiles.length === 0) {
  console.log("No test files found.");
  process.exit(0);
}

const child = spawn(
  process.execPath,
  ["--import", "tsx", "--test", ...testFiles],
  { stdio: "inherit" },
);

child.on("error", (error) => {
  console.error("Unable to start the test runner:", error.message);
  process.exitCode = 1;
});

child.on("exit", (code, signal) => {
  process.exitCode = signal ? 1 : code ?? 1;
});

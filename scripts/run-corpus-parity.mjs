import { spawnSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { availableParallelism } from "node:os";
import { resolve } from "node:path";

const requestedDir = process.env.COFLAT_PARITY_CORPUS_DIR;
const fallbackCandidates = [
  "/tmp/coflat-poa-network-game-clean",
  resolve("..", "poa-network-game-clean"),
];

function isDirectory(path) {
  try {
    return existsSync(path) && statSync(path).isDirectory();
  } catch {
    return false;
  }
}

if (requestedDir && !isDirectory(requestedDir)) {
  console.error(`COFLAT_PARITY_CORPUS_DIR is not a directory: ${requestedDir}`);
  process.exit(1);
}

const corpusDir = requestedDir || fallbackCandidates.find(isDirectory);

if (!corpusDir) {
  console.error("Missing Cosheaf parity corpus.");
  console.error("Set COFLAT_PARITY_CORPUS_DIR, or clone it with:");
  console.error("  git clone jupiter:/srv/forgejo/data/gitea/data/repos/cosheaf-admin/poa-network-game-clean.git /tmp/coflat-poa-network-game-clean");
  process.exit(1);
}

const env = {
  ...process.env,
  COFLAT_PARITY_CORPUS_DIR: corpusDir,
};
delete env.NO_COLOR;
delete env.FORCE_COLOR;

const playwrightArgs = process.argv.slice(2).filter((arg) => arg !== "--");
const hasWorkerArg = playwrightArgs.some((arg, index) => (
  arg === "--workers" ||
  arg.startsWith("--workers=") ||
  playwrightArgs[index - 1] === "--workers"
));
const defaultWorkers = process.env.COFLAT_PARITY_WORKERS ??
  String(Math.min(10, availableParallelism()));
const playwrightBin = resolve(
  "node_modules",
  ".bin",
  process.platform === "win32" ? "playwright.cmd" : "playwright",
);

const result = spawnSync(
  playwrightBin,
  [
    "test",
    "tests/e2e/corpus-parity.spec.ts",
    ...(hasWorkerArg ? [] : [`--workers=${defaultWorkers}`]),
    ...playwrightArgs,
  ],
  {
    env,
    stdio: "inherit",
  },
);

process.exit(result.status ?? 1);

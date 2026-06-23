#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const registry =
  process.env.COFLAT_NPM_REGISTRY ?? "http://packages.lab/api/packages/chaoxu/npm/";
const tokenEnv = process.env.GITEA_NPM_TOKEN ?? process.env.NPM_TOKEN ?? "";
const packageJson = await import("../package.json", { with: { type: "json" } });
const { name, version } = packageJson.default;

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    stdio: options.stdio ?? "pipe",
    input: options.input,
    env: options.env ?? process.env,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
    throw new Error(`${command} ${args.join(" ")} failed${detail ? `:\n${detail}` : ""}`);
  }
  return typeof result.stdout === "string" ? result.stdout.trim() : "";
}

function runQuiet(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    stdio: "pipe",
    env: options.env ?? process.env,
  });
  return result;
}

function readHostId() {
  const result = runQuiet("cat", ["/etc/lab-host"]);
  return result.status === 0 ? result.stdout.trim() : "";
}

function requireCleanWorktree() {
  const status = run("git", ["status", "--short"]);
  if (status) {
    throw new Error("refusing to publish from a dirty worktree");
  }
}

function createGeneratedToken() {
  const hostId = readHostId();
  if (hostId !== "jupiter") {
    return null;
  }
  const tokenName = `coflat-publish-${Date.now()}`;
  const token = run("docker", [
    "exec",
    "-u",
    "git",
    "gitea",
    "gitea",
    "admin",
    "user",
    "generate-access-token",
    "-u",
    "chaoxu",
    "-t",
    tokenName,
    "--scopes",
    "write:package",
    "--raw",
  ])
    .split("\n")
    .at(-1)
    ?.trim();
  if (!token) {
    throw new Error("Gitea did not return a package publish token");
  }
  return { token, tokenName };
}

function deleteGeneratedToken(tokenName) {
  const escaped = tokenName.replaceAll("'", "''");
  const sql = `delete from access_token where uid=1 and name='${escaped}' and scope='write:package';`;
  const result = runQuiet("docker", [
    "exec",
    "-u",
    "git",
    "gitea",
    "sqlite3",
    "/data/gitea/gitea.db",
    sql,
  ]);
  if (result.status !== 0) {
    console.error(`warning: failed to remove temporary Gitea token ${tokenName}`);
  }
}

function writeNpmrc(token) {
  const dir = mkdtempSync(join(tmpdir(), "coflat-publish-"));
  const file = join(dir, ".npmrc");
  const url = new URL(registry);
  const authPath = `${url.host}${url.pathname}`;
  writeFileSync(
    file,
    `@chaoxu:registry=${registry}\n//${authPath}:_authToken=${token}\n`,
    { mode: 0o600 },
  );
  return { dir, file };
}

function publishWithToken(token) {
  const npmrc = writeNpmrc(token);
  try {
    run(
      "npm",
      ["publish", "--registry", registry, "--access", "public"],
      {
        stdio: "inherit",
        env: { ...process.env, NPM_CONFIG_USERCONFIG: npmrc.file },
      },
    );
  } finally {
    rmSync(npmrc.dir, { recursive: true, force: true });
  }
}

requireCleanWorktree();

const existing = runQuiet("npm", [
  "view",
  `${name}@${version}`,
  "version",
  "--registry",
  registry,
]);
if (existing.status === 0 && existing.stdout.trim() === version) {
  throw new Error(`${name}@${version} is already published at ${registry}`);
}

const generated = tokenEnv ? null : createGeneratedToken();
const token = tokenEnv || generated?.token;
if (!token) {
  throw new Error(
    "set GITEA_NPM_TOKEN, or run this command on jupiter so it can create a temporary package token",
  );
}

try {
  publishWithToken(token);
} finally {
  if (generated) deleteGeneratedToken(generated.tokenName);
}

console.log(`published ${name}@${version} to ${registry}`);

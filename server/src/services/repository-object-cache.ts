import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { execFile as execute } from "node:child_process";
import { promisify } from "node:util";
import { tryWithDirectoryMergeLock } from "@paperclipai/adapter-utils/workspace-restore-merge";
import { assertWorkspaceManifestDiskSpace } from "@paperclipai/adapter-utils/workspace-manifest";
import type { GitAuthInvocation } from "./git-credentials.js";
import { sanitizeRuntimeServiceBaseEnv } from "./runtime-service-env.js";

const execFile = promisify(execute);
const REPOSITORY_BYTES = 2 * 1024 ** 3;
const COMPANY_BYTES = 4 * 1024 ** 3;
const COMPANY_REPOSITORIES = 64;
const hash = (value: string) => createHash("sha256").update(value).digest("hex");

export interface RepositoryObjectCache {
  companyDirectory: string;
  directory: string;
  key: string;
  repoUrl: string;
}

export async function resolveRepositoryObjectCache(companyDirectory: string, repoUrl: string, auth: GitAuthInvocation | null): Promise<RepositoryObjectCache | null> {
  try {
    const remote = new URL(repoUrl);
    if (remote.username || remote.password || remote.search || remote.hash) return null;
    const parent = path.dirname(companyDirectory);
    await fs.mkdir(parent, { recursive: true, mode: 0o700 });
    for (const directory of [parent, companyDirectory]) {
      if (directory === companyDirectory) await fs.mkdir(directory, { mode: 0o700 }).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "EEXIST") throw error;
      });
      const stat = await fs.lstat(directory);
      if (!stat.isDirectory() || stat.isSymbolicLink()) return null;
    }
    companyDirectory = await fs.realpath(companyDirectory);
    const scope = auth ? [auth.source, auth.secretName, auth.configArgs, Object.entries(auth.env).sort(([a], [b]) => a.localeCompare(b))] : null;
    const key = hash(JSON.stringify([repoUrl, scope]));
    return { companyDirectory, directory: path.join(companyDirectory, key), key, repoUrl };
  } catch { return null; }
}

export async function readRepositoryObjectCache(cache: RepositoryObjectCache): Promise<string | null> {
  try {
    for (const directory of [cache.companyDirectory, cache.directory]) {
      const stat = await fs.lstat(directory);
      if (!stat.isDirectory() || stat.isSymbolicLink()) return null;
    }
    if (await fs.realpath(cache.companyDirectory) !== cache.companyDirectory) return null;
    const objects = await fs.lstat(path.join(cache.directory, "objects"));
    if (!objects.isDirectory() || objects.isSymbolicLink()) return null;
    if (await fs.lstat(path.join(cache.directory, "objects/info/alternates")).then(() => true, () => false)) return null;
    const receiptPath = path.join(cache.directory, "paperclip-object-cache.json");
    const stat = await fs.lstat(receiptPath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4096) return null;
    const receipt = JSON.parse(await fs.readFile(receiptPath, "utf8"));
    if (receipt.version !== 1 || receipt.key !== cache.key) return null;
    const options = { timeout: 10000, maxBuffer: 16384, env: sanitizeRuntimeServiceBaseEnv(process.env) };
    const bare = await execFile("git", ["-C", cache.directory, "rev-parse", "--is-bare-repository"], options);
    const origin = await execFile("git", ["-C", cache.directory, "config", "--local", "--null", "--get-all", "remote.origin.url"], options);
    if (bare.stdout.trim() !== "true" || origin.stdout !== `${cache.repoUrl}\0`) return null;
    return cache.directory;
  } catch { return null; }
}

async function storageBytes(directory: string, ceiling: number, budget: { entries: number; deadline: number }): Promise<number> {
  let bytes = 0;
  for await (const entry of await fs.opendir(directory)) {
    if (--budget.entries < 0 || performance.now() > budget.deadline) throw new Error("Repository object cache work budget exhausted");
    const target = path.join(directory, entry.name);
    const stat = await fs.lstat(target);
    if (stat.isSymbolicLink()) throw new Error("Invalid repository object cache entry");
    bytes += stat.isDirectory() ? await storageBytes(target, ceiling - bytes, budget) : stat.size;
    if (bytes > ceiling) throw new Error("Repository object cache capacity exhausted");
  }
  return bytes;
}

export async function publishRepositoryObjectCache(cache: RepositoryObjectCache, checkout: string): Promise<void> {
  try {
    if (await readRepositoryObjectCache(cache)) return;
    await tryWithDirectoryMergeLock(cache.companyDirectory, async () => {
      const company = await fs.lstat(cache.companyDirectory);
      if (!company.isDirectory() || company.isSymbolicLink() || await fs.realpath(cache.companyDirectory) !== cache.companyDirectory) return;
      const budget = { entries: 4096, deadline: performance.now() + 5000 };
      let repositories = 0, bytes = 0;
      for await (const entry of await fs.opendir(cache.companyDirectory)) {
        if (++repositories >= COMPANY_REPOSITORIES) return;
        const directory = path.join(cache.companyDirectory, entry.name);
        const stat = await fs.lstat(directory);
        if (!stat.isDirectory() || stat.isSymbolicLink()) return;
        bytes += await storageBytes(directory, COMPANY_BYTES - bytes, budget);
      }
      if (await fs.lstat(cache.directory).then(() => true, () => false)) return;
      const incoming = await storageBytes(path.join(checkout, ".git"), REPOSITORY_BYTES, budget) + 65536;
      if (bytes + incoming > COMPANY_BYTES) return;
      assertWorkspaceManifestDiskSpace(cache.companyDirectory, incoming);
      const temporary = path.join(cache.companyDirectory, `.pending-${randomUUID()}`);
      try {
        const options = () => ({ timeout: Math.max(1, Math.ceil(budget.deadline - performance.now())), maxBuffer: 16384, env: sanitizeRuntimeServiceBaseEnv(process.env) });
        await execFile("git", ["clone", "--bare", "--no-hardlinks", "--", checkout, temporary], options());
        await execFile("git", ["-C", temporary, "remote", "set-url", "origin", cache.repoUrl], options());
        await fs.writeFile(path.join(temporary, "paperclip-object-cache.json"), JSON.stringify({ version: 1, key: cache.key }));
        const actual = await storageBytes(temporary, REPOSITORY_BYTES, budget);
        if (bytes + actual > COMPANY_BYTES) return;
        await fs.rename(temporary, cache.directory);
      } finally { await fs.rm(temporary, { recursive: true, force: true }); }
    });
  } catch {}
}

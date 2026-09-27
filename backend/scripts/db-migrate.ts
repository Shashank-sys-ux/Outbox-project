import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const backendRoot = join(import.meta.dirname, "..");
const migrationsDir = join(backendRoot, "prisma", "migrations");
const prismaCli = join(backendRoot, "node_modules", "prisma", "build", "index.js");
const MIGRATION_NAME = /^[a-z0-9_]{1,60}$/;

function runPrisma(args: string[]): void {
  const result = spawnSync(process.execPath, [prismaCli, ...args], {
    cwd: backendRoot,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function stripLineComments(filePath: string, marker: string): void {
  const original = readFileSync(filePath, "utf8");
  const cleaned = original
    .split(/\r?\n/)
    .filter((line) => !line.trimStart().startsWith(marker))
    .join("\n")
    .replace(/^\n+/, "")
    .replace(/\n{3,}/g, "\n\n");
  if (cleaned !== original) {
    writeFileSync(filePath, cleaned);
  }
}

function stripGeneratedComments(): void {
  if (!existsSync(migrationsDir)) {
    return;
  }
  for (const entry of readdirSync(migrationsDir, { withFileTypes: true })) {
    const sqlFile = join(migrationsDir, entry.name, "migration.sql");
    if (entry.isDirectory() && existsSync(sqlFile)) {
      stripLineComments(sqlFile, "--");
    }
  }
  const lockFile = join(migrationsDir, "migration_lock.toml");
  if (existsSync(lockFile)) {
    stripLineComments(lockFile, "#");
  }
}

function listMigrationFolders(): Set<string> {
  if (!existsSync(migrationsDir)) {
    return new Set();
  }
  return new Set(
    readdirSync(migrationsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name),
  );
}

function removeEmptyNewMigrations(before: Set<string>): void {
  for (const folder of listMigrationFolders()) {
    const sqlFile = join(migrationsDir, folder, "migration.sql");
    if (!before.has(folder) && existsSync(sqlFile) && readFileSync(sqlFile, "utf8").trim() === "") {
      rmSync(join(migrationsDir, folder), { recursive: true, force: true });
      console.log(`No schema changes detected, removed empty migration ${folder}`);
    }
  }
}

const name = process.argv[2];
if (!name || !MIGRATION_NAME.test(name)) {
  console.error("Usage: npm run db:migrate -- <name>   (lowercase letters, digits and underscores)");
  process.exit(1);
}

const foldersBefore = listMigrationFolders();
runPrisma(["migrate", "dev", "--create-only", "--name", name]);
stripGeneratedComments();
removeEmptyNewMigrations(foldersBefore);
runPrisma(["migrate", "dev"]);
runPrisma(["generate"]);

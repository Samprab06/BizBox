import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isMain, isSensitiveName, serverEnvNames } from "./env-policy";

const credentialPattern =
  /(?:sk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[A-Z0-9]{16}|(?:postgres(?:ql)?|mysql|redis):\/\/[^\s:/]+:[^\s@]+@|-----BEGIN [A-Z ]*PRIVATE KEY-----)/;

export function publicEnvIssues(env: Record<string, string | undefined>) {
  const serverValues = serverEnvNames.map((name) => env[name]).filter(Boolean);
  return Object.entries(env).flatMap(([name, value]) => {
    if (!name.startsWith("NEXT_PUBLIC_") || !value?.trim()) return [];
    if (
      isSensitiveName(name) ||
      credentialPattern.test(value) ||
      serverValues.includes(value)
    ) {
      return [`${name} appears to contain a credential`];
    }
    return [];
  });
}

export function scanClientBundle(
  directory: string,
  env: Record<string, string | undefined> = {},
): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return scanClientBundle(path, env);
    if (!entry.isFile()) return [];
    const contents = readFileSync(path);
    return serverEnvNames.flatMap((name) => {
      const issues = contents.includes(name)
        ? [`${path}: found server-only name ${name}`]
        : [];
      if (env[name]?.trim() && contents.includes(env[name]!))
        issues.push(`${path}: found server-only value for ${name}`);
      return issues;
    });
  });
}

if (isMain(import.meta.url)) {
  const issues = publicEnvIssues(process.env);
  if (!process.argv.includes("--env-only")) {
    issues.push(...scanClientBundle(".next/static", process.env));
  }
  for (const issue of issues) console.error(issue);
  if (issues.length) process.exitCode = 1;
}

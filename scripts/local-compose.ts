import { spawnSync } from "node:child_process";
import { config } from "dotenv";
import { isMain } from "./env-policy";

export function composeInvocation(
  args: string[],
  env: Record<string, string | undefined> = process.env,
) {
  const engine = env.CONTAINER_ENGINE || "docker";
  if (!["docker", "podman"].includes(engine))
    throw new Error("CONTAINER_ENGINE must be docker or podman");
  if (env.CONTAINER_USE_SUDO === "1") {
    // Explicit opt-in only; -n never prompts or bypasses sudo authorization.
    const provider =
      engine === "podman" && env.PODMAN_COMPOSE_PROVIDER
        ? [`PODMAN_COMPOSE_PROVIDER=${env.PODMAN_COMPOSE_PROVIDER}`]
        : [];
    return {
      command: "sudo",
      args: ["-n", "env", ...provider, engine, "compose", ...args],
    };
  }
  return { command: engine, args: ["compose", ...args] };
}
export function runCompose(args: string[]): number {
  const invocation = composeInvocation(args);
  const result = spawnSync(invocation.command, invocation.args, {
    stdio: "inherit",
  });
  if (result.error)
    console.error("Container engine unavailable; see docs/local-postgis.md");
  return result.status ?? 1;
}
if (isMain(import.meta.url)) {
  config({ path: [".env.local", ".env"], quiet: true });
  process.exitCode = runCompose(process.argv.slice(2));
}

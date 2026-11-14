import { config } from "dotenv";
import { runCompose } from "./local-compose";

config({ path: [".env.local", ".env"], quiet: true });

// Never silently delete persistent data. This only targets this Compose project.
if (!process.argv.includes("--confirm")) {
  console.error(
    "This deletes the local Compose database volume. Run pnpm db:reset --confirm to confirm.",
  );
  process.exitCode = 1;
} else {
  const down = runCompose(["--profile", "app", "down", "--volumes"]);
  if (down !== 0) process.exitCode = down;
  else {
    process.exitCode = runCompose(["up", "-d", "--build", "--wait", "db"]);
  }
}

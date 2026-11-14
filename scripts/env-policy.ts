import { pathToFileURL } from "node:url";

export const serverEnvNames = [
  "DATABASE_URL",
  "JEV_API_KEY",
  "CENSUS_API_KEY",
  "OPENAI_API_KEY",
  "MATTERPORT_API_TOKEN",
] as const;

// MATTERPORT_SDK_KEY is a client-permitted Showcase application key. It is kept
// out of serverEnvNames; the Model API token above is always server-only.
export const clientPermittedEnvNames = ["MATTERPORT_SDK_KEY"] as const;

export function isSensitiveName(name: string) {
  return /(?:^|_)(?:KEY|SECRET|TOKEN|PASSWORD|DATABASE_URL)(?:_|$)/i.test(name);
}

export function isMain(url: string) {
  return !!process.argv[1] && pathToFileURL(process.argv[1]).href === url;
}

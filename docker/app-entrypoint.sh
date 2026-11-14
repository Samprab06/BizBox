#!/bin/sh
set -eu

# The host uses localhost; containers must use the Compose service name instead.
# Construct the URL at runtime and encode credentials without printing them.
DATABASE_URL="$(node -e '
  const required = ["POSTGRES_USER", "POSTGRES_PASSWORD", "POSTGRES_DB"];
  if (required.some((name) => !process.env[name])) {
    console.error("Set POSTGRES_USER, POSTGRES_PASSWORD and POSTGRES_DB in .env.local");
    process.exit(1);
  }
  const encode = encodeURIComponent;
  process.stdout.write(`postgresql://${encode(process.env.POSTGRES_USER)}:${encode(process.env.POSTGRES_PASSWORD)}@db:5432/${encode(process.env.POSTGRES_DB)}`);
')"
export DATABASE_URL
exec "$@"

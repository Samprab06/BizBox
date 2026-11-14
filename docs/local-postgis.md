# Local Postgres/PostGIS for development

The existing Drizzle schema and `postgres` client work with local PostgreSQL.
Use PostGIS too: catchment queries need spatial types and functions. Neon remains
the hosted choice for Vercel; local development does not require a Neon account.

## Docker / Podman (recommended)

Prerequisites: running Docker-compatible engine and Compose provider, Node 22/24,
pnpm 11.25.0 and the [DuckDB CLI](https://duckdb.org/docs/installation/).
Verify `docker compose version` and `duckdb --version`. DuckDB is a local import
tool, not part of the app image. Check existing services before using ports 5432
and 3000; both Compose ports bind to **127.0.0.1 only**.

`compose.yaml` builds PostgreSQL 16 plus PostGIS 3.x from `postgres:16-bookworm`
and signed Debian/PGDG packages for native **arm64 and amd64**. Apple Silicon and
Oracle ARM do not need amd64 emulation. The app uses a multi-stage Node 22 build,
standalone output and a non-root runtime. Vercel still uses its normal build.

In a fresh checkout copy `.env.example` to `.env.local` only if it does not already
exist; otherwise preserve existing settings. Set these disposable local values:

```dotenv
POSTGRES_USER=postgres
POSTGRES_PASSWORD=postgres
POSTGRES_DB=hackprinceton
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/hackprinceton
```

This is a known local-development password, **never a production credential**.
If choosing another password, percent-encode it in the host connection URL.
Never commit `.env.local`. Sensitive template assignments remain empty, with the
local URL present only as a comment.

Put the licensed kit at `./costar-hackathon-kit` (a symlink is fine), then run:

```sh
pnpm install --frozen-lockfile
pnpm db:up
pnpm db:migrate
pnpm db:load
docker compose --profile app up -d --build --wait
pnpm db:verify
```

`db:up` waits for a healthy database; initialization enables PostGIS. `db:load`
runs migrations, replaces CoStar observations, prepares/imports keyless
`--acs-summary` + TIGER/LODES/Overture data, ensures geography indexes, creates a
`local-dev` project and prints actual SQL counts. Pinned expectations are 3,339
properties, 3,955 lease spaces and 12,816 block groups; other source tables must
also be nonempty. It rejects nonlocal database hosts. First-time downloads need
internet; reruns reuse SHA-256-verified caches under ignored `data/public/` and
replace rows rather than duplicate them. Source replacement is atomic per source,
not a global transaction across all imports.

Open http://localhost:3000. `/api/health` must confirm connected/PostGIS true.
`db:verify` checks real site/catchment responses for both cities with a synthetic
business plan and prints aggregates only, not licensed names or addresses. Set
`LOCAL_APP_URL` for a separate local port. The app entrypoint constructs its
runtime URL for **db:5432**, not host localhost.

`.dockerignore` excludes `.env*`, local datasets, dependencies, host build output
and Git metadata. No secret build args are used. Runtime values are injected by
Compose, not image layers. Inspect with `docker history <app-image>` or
`docker image inspect <app-image>`; never publish **container** inspect output,
which includes runtime credentials.

`pnpm db:down` stops this stack but retains the named volume.
`pnpm db:reset --confirm` explicitly deletes this Compose project's volumes and
starts a fresh database. Do not reset a shared development database.

### Podman on the Oracle server

For working rootless Podman, start `systemctl --user start podman.socket` and set
`CONTAINER_ENGINE=podman` in `.env.local`. Install a Compose provider; if needed
set `PODMAN_COMPOSE_PROVIDER` to its absolute path.

This server's stale rootless systemd private socket prevents scheduled
healthchecks. Verification therefore uses explicitly opted-in rootful Podman,
without restarting unrelated user services: run `sudo systemctl start
podman.socket`, then set `CONTAINER_ENGINE=podman`, `CONTAINER_USE_SUDO=1` and the
provider path in ignored `.env.local`. The wrapper uses `sudo -n` and never asks
for or bypasses authorization. Leave sudo disabled for Docker Desktop or healthy
rootless Podman. The two engines have separate images and volumes.

Use the configured wrapper instead of bare Docker commands when needed:

```sh
pnpm exec tsx scripts/local-compose.ts --profile app up -d --build --wait
```

## Native macOS (Homebrew, alternative)

These steps use a native PostgreSQL 17 service. Before installing or starting
anything, inspect existing services and port 5432 (`brew services list` and
`lsof -nP -iTCP:5432 -sTCP:LISTEN`). Reuse an authorized development instance
or choose a separate port; never overwrite another database or its configuration.
Homebrew must already be installed and package downloads must be available.

```sh
brew install postgresql@17 postgis
brew services start postgresql@17
export PATH="$(brew --prefix postgresql@17)/bin:$PATH"
pg_isready -h 127.0.0.1 -p 5432
```

Confirm that PostgreSQL 17 finds the installed PostGIS control file before
proceeding (`ls "$(pg_config --sharedir)/extension/postgis.control"`). If it is
missing, use a matching PostGIS build for this PostgreSQL installation; do not
copy extension binaries between versions. Create a dedicated database only if it
does not already exist, using the local PostgreSQL role created for your macOS
account. Connect to that exact database and enable and verify the extension:

```sh
createdb -h 127.0.0.1 -p 5432 hackprinceton_dev
psql -h 127.0.0.1 -p 5432 -d hackprinceton_dev -v ON_ERROR_STOP=1 \
  -c 'CREATE EXTENSION IF NOT EXISTS postgis; SELECT PostGIS_Full_Version();'
```

If TCP authentication requires a password, use PostgreSQL's password prompt or
a protected password file. Set `DATABASE_URL` in the existing ignored `.env.local`
without overwriting other variables. For a local role whose connection works
without a password, its format is:

```dotenv
DATABASE_URL=postgresql://YOUR_POSTGRES_ROLE@127.0.0.1:5432/hackprinceton_dev
```

Replace the role with the actual PostgreSQL role, and include a password if your
server requires it. Percent-encode reserved characters in URL credentials. Do
not put real credentials in Git or shell output. Homebrew services may be stopped
and restarted with `brew services stop postgresql@17` and `brew services start
postgresql@17`; don't stop a shared service without checking who uses it.

## Native Windows (EDB PostgreSQL + Stack Builder, alternative)

1. Check for an existing PostgreSQL installation and port 5432 before making
   changes. Preserve existing databases and use an authorized development server.
2. Download the [Windows PostgreSQL installer](https://www.postgresql.org/download/windows/).
   Install a supported PostgreSQL release, noting its port and the `postgres`
   administrator password. The installer includes pgAdmin and Stack Builder.
3. Open Stack Builder, select the installed server, then select **Spatial
   Extensions → PostGIS bundle** compatible with that PostgreSQL major version.
   See [PostGIS Windows instructions](https://postgis.net/documentation/getting_started/install_windows/released_versions/).
   Windows administrator/UAC prompts or installer dialogs can require user input;
   agents must not bypass them.
4. In pgAdmin, connect to that server and create `hackprinceton_dev` only if it
   does not already exist. Open its Query Tool and execute:

   ```sql
   CREATE EXTENSION IF NOT EXISTS postgis;
   SELECT PostGIS_Full_Version();
   ```

   The role executing `CREATE EXTENSION` needs the required database privileges.
   Confirm the query returns a PostGIS version. A missing extension control file
   indicates a missing or mismatched PostGIS installation.

5. Preserve the existing project `.env.local` and set `DATABASE_URL` to the
   local development database, using the actual PostgreSQL role, port and
   password. Example format: `postgresql://ROLE:PASSWORD@127.0.0.1:5432/hackprinceton_dev`.
   Percent-encode reserved URL characters in the credentials; do not commit the
   file or paste real credentials into logs. Ensure the PostgreSQL Windows
   service is running before connecting.

## Initialize and verify the app

For either native setup, from the project directory run `pnpm install`,
`pnpm db:migrate`, then `pnpm dev`. Check `GET /api/health` for the database and
PostGIS status. Source tables use separate importer DDL; follow
[public-data-import.md](public-data-import.md) for the Census and full-source
commands. The full import needs DuckDB for Overture. These native instructions
have not been executed on either platform in this PR. Vercel deployments need a
reachable hosted PostgreSQL/PostGIS database; localhost is development-only.

Hosted Neon/Vercel verification remains HAC-44. Local containers do not require
hosted credentials or authorize any hosted resource changes.

# Local Postgres/PostGIS for development

The existing Drizzle schema and `postgres` client work with local PostgreSQL.
Use PostGIS too: catchment queries need spatial types and functions. Neon remains
the hosted choice for Vercel; local development does not require a Neon account.

Install and start a Docker-compatible engine first (the Docker CLI alone is not
enough). The [PostGIS community image](https://github.com/postgis/docker-postgis)
initializes PostGIS in the configured database. This example uses PostgreSQL 17,
a dedicated persistent volume and localhost port 5433 to avoid the usual 5432.
The image supports amd64; Apple Silicon needs Docker's amd64 emulation.

```sh
docker run --name hackprinceton-dev-db --platform linux/amd64 \
  -e POSTGRES_USER=hackprinceton \
  -e POSTGRES_PASSWORD=local-development-only \
  -e POSTGRES_DB=hackprinceton \
  -p 127.0.0.1:5433:5432 \
  -v hackprinceton-dev-db:/var/lib/postgresql/data \
  -d postgis/postgis:17-3.7

docker exec hackprinceton-dev-db pg_isready -U hackprinceton -d hackprinceton
docker exec hackprinceton-dev-db psql -U hackprinceton -d hackprinceton \
  -c 'SELECT PostGIS_Full_Version();'
```

Set this development-only connection in ignored `.env.local`, preserving other
settings already in that file:

```dotenv
DATABASE_URL=postgresql://hackprinceton:local-development-only@127.0.0.1:5433/hackprinceton
```

Then initialize application tables and start the app:

```sh
pnpm db:migrate
pnpm dev
```

`GET /api/health` should report database/PostGIS availability. Application
migrations and the source import DDL are separate: the source importer creates
its own tables. [Census preparation](public-data-import.md#keyless-census-download-hac-46)
works before the database starts. The full public-data import also needs DuckDB
for Overture, and replaces all three public source tables transactionally:

```sh
pnpm exec tsx scripts/fetch-public-data.ts --acs-summary
```

Stop/resume the same database with `docker stop hackprinceton-dev-db` and
`docker start hackprinceton-dev-db`. Data remains in the named volume. Keep this
localhost connection out of Vercel: deployed functions need a reachable hosted
Postgres connection, such as Neon with PostGIS enabled.

These setup instructions were checked against the image documentation. Local
database startup/import was not executed for HAC-46 because this machine has a
Docker CLI but no running daemon. Hosted verification remains HAC-44.

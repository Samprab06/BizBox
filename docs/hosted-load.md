# Hosted data load (Neon)

`pnpm db:load:hosted --confirm-hosted` migrates and loads the hosted Postgres (Neon) used by the
Vercel deployment. It is separate from the local-only `pnpm db:load` on purpose.

- **Connection:** reads `DATABASE_URL_UNPOOLED` (direct Neon connection) from `.env.local`.
  It rejects localhost and pooled (`-pooler.`) hosts, and never prints the connection string.
  Never `source` an env file in a shell: the Neon URLs contain `&`, which bash treats as a
  command separator and echoes.
- **Data:** CoStar properties, spaces and tenancies plus the keyless public data (ACS block
  groups, LODES jobs, Overture places), then the catchment indexes and the demo project
  `houston-coffee`. Reuse an existing public-data cache with `--public-cache=<dir>`.
- **Size:** `costar_attachments` is counted but not stored. No runtime route reads it, and with it
  the load (about 1.08 GB) exceeds the 1 GB `neon.max_cluster_size`. Without it the database is
  about 780 MB.
- **Batches:** inserts are smaller than the local defaults (25 CoStar rows, 20 block groups, 250
  jobs, 100 places), because large JSONB rows exhausted the small Neon compute's memory (53200).
- **Verification:** the script checks 3,339 properties, 3,955 spaces, 0 attachments and 12,816
  block groups. Each source import is one transaction that truncates and reloads, so a rerun
  replaces the data instead of duplicating it.

Last hosted load (HAC-44): properties 3,339 · spaces 3,955 · tenancies 11,179 · block groups
12,816 · job blocks 114,284 · places 137,469 · database 776 MB. Production `/api/health` reports
the database connected with PostGIS.

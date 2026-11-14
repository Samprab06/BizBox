-- Runs only for a fresh volume, in POSTGRES_DB, before the DB is healthy.
-- Application schema/data are deliberately left to the host migration scripts.
CREATE EXTENSION IF NOT EXISTS postgis;

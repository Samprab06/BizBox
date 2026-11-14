# Official multi-architecture Postgres 16 (amd64 + arm64), Debian bookworm.
# This image already configures the signed PGDG apt repository on both arches.
FROM postgres:16-bookworm
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       postgresql-16-postgis-3 postgresql-16-postgis-3-scripts \
    && rm -rf /var/lib/apt/lists/*
COPY init.sql /docker-entrypoint-initdb.d/10-postgis.sql

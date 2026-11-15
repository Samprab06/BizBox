-- Requires an explicitly approved writable DEVELOPMENT database and sealed CLI handoff.
-- psql -v historical_reserved_microusd=LATEST_SEALED_TOTAL -v handoff_receipt=SEALED_LEDGER_SHA256 -f scripts/interior-policy-grant-init.sql
-- Never seed from a stale original reservation after new CLI calls. No reset/upsert exists.
\if :{?historical_reserved_microusd}
\else
 \echo 'Missing latest sealed historical reservation; refusing grant initialization'
 \quit
\endif
\if :{?handoff_receipt}
\else
 \echo 'Missing sealed CLI handoff receipt; refusing grant initialization'
 \quit
\endif
INSERT INTO interior_jev_grants(grant_id,limit_microusd,reserved_microusd,handoff_receipt,active)
VALUES('bizbox-interior-2026-11-15',1000000,:'historical_reserved_microusd'::bigint,:'handoff_receipt',true);

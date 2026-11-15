import "server-only";
import { sql, type SQL } from "drizzle-orm";
import {
  InteriorJevResponseSchema,
  InteriorPolicyError,
  type InteriorPolicyStore,
} from "./policies";
type Executor = { execute(query: SQL): PromiseLike<unknown> };
type Database = Executor & {
  transaction<T>(work: (tx: Executor) => Promise<T>): Promise<T>;
};
const rows = (value: unknown) =>
  Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
/** Dedicated grant/cache tables only; never initializes grants or alters source tables. */
export function createPostgresInteriorPolicyStore(
  database: Database,
): InteriorPolicyStore {
  return {
    async claim(projectId, key, owner) {
      const claimed = rows(
        await database.execute(
          sql`INSERT INTO interior_jev_policy_claims(project_id,cache_key,owner,expires_at) VALUES(${projectId},${key},${owner},now()+interval '120 seconds') ON CONFLICT(project_id,cache_key) DO UPDATE SET owner=excluded.owner,expires_at=excluded.expires_at WHERE interior_jev_policy_claims.expires_at<now() RETURNING owner`,
        ),
      );
      return claimed[0]?.owner === owner;
    },
    async release(projectId, key, owner) {
      await database.execute(
        sql`DELETE FROM interior_jev_policy_claims WHERE project_id=${projectId} AND cache_key=${key} AND owner=${owner}`,
      );
    },
    async assertReady(grantId) {
      const found = rows(
        await database.execute(
          sql`SELECT grant_id FROM interior_jev_grants WHERE grant_id=${grantId} AND active=true AND limit_microusd=1000000 AND reserved_microusd>=26864 LIMIT 1`,
        ),
      );
      if (!found.length)
        throw new InteriorPolicyError(
          "unavailable",
          "Durable interior Jev budget grant unavailable",
        );
    },
    async get(projectId, key) {
      const found = rows(
        await database.execute(
          sql`SELECT response FROM interior_jev_policy_cache WHERE project_id=${projectId} AND cache_key=${key} LIMIT 1`,
        ),
      )[0];
      return found ? InteriorJevResponseSchema.parse(found.response) : null;
    },
    async reserve(grantId, attemptId, projectId, key, amount) {
      if (!Number.isSafeInteger(amount) || amount <= 0)
        throw new Error("Invalid budget reservation");
      return database.transaction(async (tx) => {
        const grant = rows(
          await tx.execute(
            sql`UPDATE interior_jev_grants SET reserved_microusd=reserved_microusd+${amount},updated_at=now() WHERE grant_id=${grantId} AND active=true AND limit_microusd=1000000 AND reserved_microusd+${amount}<=limit_microusd RETURNING grant_id`,
          ),
        );
        if (!grant.length) {
          const exists = rows(
            await tx.execute(
              sql`SELECT grant_id FROM interior_jev_grants WHERE grant_id=${grantId} AND active=true`,
            ),
          );
          return exists.length
            ? ("exhausted" as const)
            : ("unavailable" as const);
        }
        await tx.execute(
          sql`INSERT INTO interior_jev_reservations(id,grant_id,project_id,cache_key,reserved_microusd) VALUES(${attemptId},${grantId},${projectId},${key},${amount})`,
        );
        return "reserved" as const;
      });
    },
    async put(projectId, key, result) {
      const valid = InteriorJevResponseSchema.parse(result);
      await database.execute(
        sql`INSERT INTO interior_jev_policy_cache(project_id,cache_key,response) VALUES(${projectId},${key},${JSON.stringify(valid)}::jsonb) ON CONFLICT(project_id,cache_key) DO NOTHING`,
      );
    },
  };
}

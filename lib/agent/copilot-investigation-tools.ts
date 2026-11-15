import "server-only";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { BusinessProfileSchema } from "@/lib/contracts";
import { profiles } from "@/lib/db/schema";
import { getDb } from "@/lib/db/client";
import { createPostgresScenarioRepository } from "@/lib/scenario/repository";
import { createPostgresInvestigationToolDependencies } from "./tools-postgres";
import { InvestigationToolSchemas } from "./tools";
import type { CopilotMutationContext } from "./copilot-tools";

/** Reuses the investigation adapters for scoped reads, never starts a Jev panel.
 * The completed saved comparison tools expose prior Jev/fallback results; no
 * model-selected tool can authorize a new paid panel in this conversation. */
export function createCopilotInvestigationReads(
  deps = createPostgresInvestigationToolDependencies(),
  scenarios = createPostgresScenarioRepository(),
) {
  const definitions = [
    {
      name: "get_catchment" as const,
      schema: InvestigationToolSchemas.get_catchment,
      description:
        "Read the selected scoped site's catchment using the existing investigation adapter; label modeled/default data and source evidence.",
    },
    {
      name: "read_nessie_cash_buffer" as const,
      schema: InvestigationToolSchemas.read_nessie_cash_buffer,
      description:
        "Read a simulated Nessie demo account cash buffer; never imply real founder bank ownership or sales. Site affordability projection is unavailable without a saved scoped comparison.",
    },
  ];
  return {
    definitions,
    async execute(
      name: (typeof definitions)[number]["name"],
      raw: unknown,
      context: CopilotMutationContext,
    ) {
      context.signal.throwIfAborted();
      if (!context.scenarioId)
        return {
          status: "rejected",
          code: "STALE_CONTEXT",
          message: "Select a saved scenario first.",
        };
      const scenario = await scenarios.get(
        context.projectId,
        context.scenarioId,
      );
      if (
        !scenario ||
        scenario.projectId !== context.projectId ||
        (context.profileVersion &&
          scenario.profileVersion !== context.profileVersion)
      )
        return {
          status: "rejected",
          code: "STALE_CONTEXT",
          message: "Scenario/profile context changed.",
        };
      const [row] = await getDb()
        .select({ snapshot: profiles.snapshot })
        .from(profiles)
        .where(
          and(
            eq(profiles.projectId, context.projectId),
            eq(profiles.version, scenario.profileVersion),
          ),
        )
        .limit(1);
      if (!row)
        return {
          status: "rejected",
          code: "NOT_FOUND",
          message: "Profile snapshot unavailable.",
        };
      const profile = BusinessProfileSchema.parse(row.snapshot);
      if (
        profile.projectId !== context.projectId ||
        profile.version !== scenario.profileVersion
      )
        return {
          status: "rejected",
          code: "STALE_CONTEXT",
          message: "Profile snapshot is not scoped.",
        };
      if (name === "get_catchment") {
        const input = InvestigationToolSchemas.get_catchment.parse(raw);
        if (!scenario.siteIds.includes(input.site_id))
          return {
            status: "rejected",
            code: "STALE_CONTEXT",
            message: "Site is not shortlisted in this scenario.",
          };
        const result = await deps.catchment(
          profile,
          input.site_id,
          context.signal,
        );
        context.signal.throwIfAborted();
        return {
          status: "ok",
          source: "public_or_modeled",
          result: z.json().parse(JSON.parse(JSON.stringify(result))),
        };
      }
      const input = InvestigationToolSchemas.read_nessie_cash_buffer.parse(raw);
      if (input.comparison_id || input.site_id)
        return {
          status: "unsupported",
          code: "SCOPED_COMPARISON_REQUIRED",
          message:
            "Use a saved, scoped scenario comparison before requesting an affordability projection.",
        };
      if (!deps.readNessieCashBuffer)
        return {
          status: "unsupported",
          code: "ADAPTER_UNAVAILABLE",
          message: "Nessie simulated banking is unavailable.",
        };
      const result = await deps.readNessieCashBuffer({
        projectId: context.projectId,
        investigationId: `copilot:${context.projectId}`,
        attempt: 1,
        profileId: profile.id,
        profileVersion: profile.version,
        accountId: input.account_id,
        signal: context.signal,
      });
      context.signal.throwIfAborted();
      return { status: "ok", source: "nessie_synthetic", result };
    },
  };
}

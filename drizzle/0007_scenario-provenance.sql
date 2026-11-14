ALTER TABLE "scenarios" DROP CONSTRAINT "scenarios_agent_never_founder";--> statement-breakpoint
ALTER TABLE "scenarios" ADD CONSTRAINT "scenarios_agent_never_founder" CHECK ("scenarios"."author" <> 'agent' or "scenarios"."parent_id" is not null or not jsonb_path_exists("scenarios"."overrides", '$.**.origin ? (@ == "founder")'));
--> statement-breakpoint
-- Agent-authored children may retain founder evidence, never invent or modify it.
-- Scenarios and their parent snapshots are already immutable (migration 0003).
CREATE FUNCTION check_scenario_founder_inheritance() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  inherited jsonb;
  leaf record;
BEGIN
  IF NEW.author <> 'agent' OR NEW.parent_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.parent_id IS NOT NULL THEN
    SELECT overrides INTO inherited FROM scenarios
      WHERE project_id = NEW.project_id AND id = NEW.parent_id;
  END IF;
  FOR leaf IN
    WITH RECURSIVE nodes(path, value) AS (
      SELECT ARRAY[]::text[], NEW.overrides
      UNION ALL
      SELECT nodes.path || child.key, child.value
      FROM nodes
      CROSS JOIN LATERAL jsonb_each(
        CASE WHEN jsonb_typeof(nodes.value) = 'object' THEN nodes.value ELSE '{}'::jsonb END
      ) AS child
    )
    SELECT path, value FROM nodes
    WHERE value ->> 'origin' = 'founder' AND value ? 'evidenceIds'
  LOOP
    IF inherited IS NULL OR (inherited #> leaf.path) IS DISTINCT FROM leaf.value THEN
      RAISE EXCEPTION 'Agent cannot introduce or change founder provenance at %', leaf.path
        USING ERRCODE = '23514', CONSTRAINT = 'scenarios_agent_founder_inheritance';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER scenarios_agent_founder_inheritance
BEFORE INSERT ON scenarios
FOR EACH ROW EXECUTE FUNCTION check_scenario_founder_inheritance();

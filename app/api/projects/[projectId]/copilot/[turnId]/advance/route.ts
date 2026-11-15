import { createCopilotHandlers } from "../../handler";
import { createPostgresCopilotRuntime } from "@/lib/agent/copilot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const POST = createCopilotHandlers(
  createPostgresCopilotRuntime(),
).advance;

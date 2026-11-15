import { createCopilotHandlers } from "./handler";
import { createPostgresCopilotRuntime } from "@/lib/agent/copilot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const handlers = createCopilotHandlers(createPostgresCopilotRuntime());
export const GET = handlers.GET;
export const POST = handlers.POST;

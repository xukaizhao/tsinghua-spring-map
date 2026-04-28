import { clientTools } from "@cloudbase/agent-adapter-langchain";
import { MemorySaver } from "@langchain/langgraph";
import { createAgent as createLangchainAgent } from "langchain";

import { createPlannerModel } from "./llm.js";
import { SYSTEM_PROMPT } from "./prompts.js";
import { createServerTools } from "./server-tools.js";

export function createPlannerAgent() {
  const model = createPlannerModel();
  const checkpointer = new MemorySaver();

  return createLangchainAgent({
    model,
    checkpointer,
    tools: createServerTools(),
    middleware: [clientTools()],
    systemPrompt: SYSTEM_PROMPT,
  });
}

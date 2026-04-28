import { ChatOpenAI } from "@langchain/openai";

export function createPlannerModel() {
  return new ChatOpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    model: process.env.OPENAI_MODEL || "deepseek-chat",
    temperature: 0.2,
    timeout: Number(process.env.LLM_REQUEST_TIMEOUT_MS || process.env.TASK_ROUTER_TIMEOUT_MS || 200000),
    maxRetries: Number(process.env.LLM_MAX_RETRIES || 1),
    configuration: process.env.OPENAI_BASE_URL
      ? {
          baseURL: process.env.OPENAI_BASE_URL,
        }
      : undefined,
  });
}

import "dotenv/config";

import { LangchainAgent } from "@cloudbase/agent-adapter-langchain";
import { createExpressRoutes } from "@cloudbase/agent-server";
import cors from "cors";
import express from "express";

import { createPlannerAgent } from "./agent.js";
import { planDemoRoute, searchDemoPois } from "./demo-planner.js";

const port = Number(process.env.PORT || 9000);
const host = process.env.HOST || "0.0.0.0";

function createAgent() {
  const langchainAgent = createPlannerAgent();
  return {
    agent: new LangchainAgent({
      agent: langchainAgent,
    }),
  };
}

const app = express();
app.use(cors());
app.use(express.json());

app.get("/healthz", (_req, res) => {
  const mapProvider = process.env.MAP_PROVIDER === "baidu" ? "baidu" : "tencent";
  res.json({
    ok: true,
    service: "cloudbase-agent-service",
    model: process.env.OPENAI_API_KEY ? (process.env.OPENAI_MODEL || "deepseek-chat") : "",
    strategy: process.env.OPENAI_API_KEY ? "llm+tools" : "rules+tools",
    llmConfigured: Boolean(process.env.OPENAI_API_KEY),
    llmBaseUrl: process.env.OPENAI_BASE_URL || "",
    mapProvider,
  });
});

app.post("/demo/route-plan", async (req, res) => {
  try {
    const plan = await planDemoRoute(req.body || {});
    res.json({
      ok: true,
      plan,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "route planning failed";
    res.status(500).json({
      ok: false,
      error: message,
    });
  }
});

app.post("/demo/poi-search", async (req, res) => {
  try {
    const result = await searchDemoPois(req.body || {});
    res.json({
      ok: true,
      result,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "poi search failed";
    res.status(500).json({
      ok: false,
      error: message,
    });
  }
});

createExpressRoutes({
  createAgent,
  express: app,
});

app.listen(port, host, () => {
  console.log(`[cloudbase-agent-service] listening on ${host}:${port}`);
});

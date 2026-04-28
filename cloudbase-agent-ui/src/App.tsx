import cloudbase from "@cloudbase/js-sdk";
import { AgentUI } from "@cloudbase/agent-ui-react";
import { useEffect, useState } from "react";

import ToolCard from "./components/ToolCard";

const envId = import.meta.env.VITE_CLOUDBASE_ENV_ID;
const botId = import.meta.env.VITE_CLOUDBASE_AGENT_BOT_ID;

const tcb = cloudbase.init({
  env: envId,
});

const auth = tcb.auth({
  persistence: "local",
});

export default function App() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    auth
      .signInAnonymously()
      .then(() => setReady(true))
      .catch((error) => {
        console.error("anonymous sign-in failed", error);
      });
  }, []);

  if (!ready) {
    return (
      <main className="page-shell">
        <section className="hero">
          <h1>花路校园 Agent</h1>
          <p>正在初始化 CloudBase 身份与 Agent 会话。</p>
        </section>
      </main>
    );
  }

  return (
    <main className="page-shell">
      <section className="hero">
        <h1>花路校园 Agent</h1>
        <p>
          面向校园春日漫游场景的 Agent UI React 骨架。它会调用 CloudBase Agent，并把腾讯地图 MCP
          的结果渲染成自定义 ToolCard。
        </p>
      </section>

      <section className="agent-frame">
        <AgentUI
          tcb={tcb}
          style={{ width: "100%", height: "72vh" }}
          chatMode="bot"
          showBotAvatar={true}
          toolCardComponent={ToolCard as never}
          agentConfig={{
            botId,
            allowPullRefresh: true,
            allowUploadImage: true,
            allowMultiConversation: true,
            showToolCallDetail: true,
          }}
        />
      </section>
    </main>
  );
}

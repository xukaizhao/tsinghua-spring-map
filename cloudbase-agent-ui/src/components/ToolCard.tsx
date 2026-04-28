import type { ToolCardProps } from "../types";
import { TencentMapToolCard } from "./cards/TencentMapToolCard";

function resolveToolName(props: ToolCardProps) {
  return (
    props.toolName ||
    props.name ||
    props.tool?.name ||
    props.message?.toolName ||
    props.message?.tool?.name ||
    ""
  );
}

function safeStringify(value: unknown) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export default function ToolCard(props: ToolCardProps) {
  const toolName = resolveToolName(props);

  if (/place|geocoder|direction|weather|waypoint/i.test(toolName)) {
    return <TencentMapToolCard {...props} />;
  }

  return (
    <section className="tool-card fallback-card">
      <h3>工具执行结果</h3>
      <p>当前尚未为这个工具定制卡片，先展示原始结果。</p>
      <pre>{safeStringify(props.result ?? props.output ?? props.data ?? props.message)}</pre>
    </section>
  );
}

import type { ToolCardProps } from "../../types";

function safeParse(value: unknown) {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function pickPayload(props: ToolCardProps) {
  return safeParse(
    props.result ??
      props.output ??
      props.data ??
      props.message?.result ??
      props.message?.output
  );
}

function pickToolName(props: ToolCardProps) {
  return (
    props.toolName ||
    props.name ||
    props.tool?.name ||
    props.message?.toolName ||
    props.message?.tool?.name ||
    "unknown_tool"
  );
}

function renderRouteSegments(payload: any) {
  const segments = Array.isArray(payload?.segments) ? payload.segments : [];
  if (!segments.length) return null;
  return (
    <ul className="segment-list">
      {segments.slice(0, 4).map((segment: any, index: number) => (
        <li className="segment-item" key={`${segment?.title || "segment"}-${index}`}>
          <strong>{segment?.title || `第 ${index + 1} 段`}</strong>
          <p>{segment?.objective || "路线阶段说明待补充"}</p>
          <div className="pill-row">
            {segment?.durationText ? <span className="pill">{segment.durationText}</span> : null}
            {segment?.distanceText ? <span className="pill">{segment.distanceText}</span> : null}
          </div>
        </li>
      ))}
    </ul>
  );
}

function renderPoiList(payload: any) {
  const list =
    payload?.data?.length
      ? payload.data
      : payload?.pois?.length
        ? payload.pois
        : payload?.markers?.length
          ? payload.markers
          : [];

  if (!Array.isArray(list) || !list.length) return null;

  return (
    <ul className="poi-list">
      {list.slice(0, 5).map((poi: any, index: number) => (
        <li className="poi-item" key={`${poi?.name || "poi"}-${index}`}>
          <strong>{poi?.title || poi?.name || `候选点 ${index + 1}`}</strong>
          <p>{poi?.address || poi?.reason || poi?.category || "地图结果项"}</p>
        </li>
      ))}
    </ul>
  );
}

export function TencentMapToolCard(props: ToolCardProps) {
  const toolName = pickToolName(props);
  const payload = pickPayload(props) as any;
  const summary =
    payload?.summary ||
    payload?.result?.summary ||
    payload?.message ||
    payload?.formatted_address ||
    "腾讯地图工具已返回结果。";

  return (
    <section className="tool-card">
      <h3>腾讯地图工具卡</h3>
      <p>{summary}</p>
      <div className="pill-row">
        <span className="pill">{toolName}</span>
        {payload?.distanceText ? <span className="pill">{payload.distanceText}</span> : null}
        {payload?.durationText ? <span className="pill">{payload.durationText}</span> : null}
      </div>
      {renderRouteSegments(payload)}
      {renderPoiList(payload)}
    </section>
  );
}

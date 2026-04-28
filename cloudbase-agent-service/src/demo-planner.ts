import type { PoiSelectionDebug, RoutePlanCard, RouteStop, ToolCallTrace } from "./types.js";
import { createPlannerModel } from "./llm.js";
import { getSceneFlowerHotspots, type FlowerHotspot } from "./scene-flower-hotspots.js";
import { getScenePois, type CuratedPoi } from "./scene-pois.js";
import { getSceneProfile } from "./scene-profile.js";

type DemoPlannerRequest = {
  query?: string;
  sceneId?: string;
  durationMinutes?: number;
  style?: string;
  theme?: string;
  startPoint?: {
    name?: string;
    lat?: number;
    lng?: number;
  };
};

type PoiSearchDemoRequest = {
  query?: string;
  sceneId?: string;
  radiusMeters?: number;
  anchor?: {
    name?: string;
    lat?: number;
    lng?: number;
  };
};

type ParsedIntent = {
  rawQuery: string;
  sceneId: string;
  durationMinutes: number;
  style: string;
  theme: string;
  preferredColor?: "pink" | "white" | "yellow";
  preferredSpecies: string[];
  scenicQuery?: string;
  scenicCount?: number;
  startPointName?: string;
  wantsPhoto: boolean;
  wantsShade: boolean;
  wantsRest: boolean;
  wantsLunch: boolean;
  lunchMode: "none" | "nearby" | "explicit";
  lunchQuery?: string;
  targetPoiName?: string;
  targetPoiId?: string;
  targetPoiQuery?: string;
  planMode: "single" | "multi";
  planReasoning: string[];
};

type TaskKind =
  | "scene_profile"
  | "flower_filter"
  | "poi_search"
  | "target_resolution"
  | "reverse_geocode"
  | "route_planning";

type PlannedSearch = {
  purpose: "lunch" | "target" | "poi";
  keywords: string[];
  around: "scene_center" | "last_scenic_stop" | "last_stop";
  radiusMeters: number;
  reason: string;
};

type TaskPlan = {
  routerMode: "heuristic" | "llm";
  tasks: TaskKind[];
  searches: PlannedSearch[];
  reasoning: string[];
};

type RouterDebug = {
  used: boolean;
  mode: "llm" | "heuristic";
  rawResponse?: string;
  error?: string;
};

type AnchorPoint = {
  name?: string;
  lat: number;
  lng: number;
};

type SearchPoi = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  address?: string;
  aliases?: string[];
  tags?: string[];
  stayMinutes?: number;
  species?: string[];
  plants?: string;
  images?: string[];
  photoScore?: number;
  bloomScore?: number;
  shadeScore?: number;
  restScore?: number;
  searchDistanceMeters?: number;
};

type PlannerStop = CuratedPoi | SearchPoi | FlowerHotspot;
type RankedPoiCandidate = SearchPoi & { heuristicScore: number; textScore: number };
type MapProvider = "tencent" | "baidu";

const COLOR_SPECIES_MAP = {
  pink: ["樱花", "垂丝海棠", "山桃", "桃花", "玉兰"],
  white: ["玉兰", "梨花", "白玉兰"],
  yellow: ["连翘"],
} as const;

const FLOWER_KEYWORDS = ["樱花", "玉兰", "紫玉兰", "望春玉兰", "桃花", "山桃", "垂丝海棠", "海棠", "紫叶李", "连翘", "梨花"];
const GENERIC_ALIAS_BLACKLIST = new Set(["食堂", "吃饭", "午饭", "午餐", "咖啡"]);
const GENERIC_PLACE_SUFFIXES = ["清华大学", "清华", "校园", "校内", "附近", "这里", "那边", "那儿"];
const GENERIC_PLACE_TAILS = ["食堂", "公寓", "图书馆", "教学楼", "学院", "中心", "大楼", "楼", "馆", "门", "系"];
const LUNCH_QUERY_PATTERN = /食堂|餐厅|咖啡|麦当劳|肯德基|便利店|轻食|简餐|午饭|午餐|吃饭|吃个饭/;
const MAP_PROVIDER: MapProvider = process.env.MAP_PROVIDER === "baidu" ? "baidu" : "tencent";
const MAP_PROVIDER_LABEL = MAP_PROVIDER === "baidu" ? "百度地图" : "腾讯地图";
const TMAP_MIN_INTERVAL_MS = Math.max(220, Number(process.env.TMAP_MIN_INTERVAL_MS || 240));
const TMAP_CACHE_TTL_MS = Math.max(5000, Number(process.env.TMAP_CACHE_TTL_MS || 15000));
const TMAP_MAX_RETRIES = Math.max(1, Number(process.env.TMAP_RATE_LIMIT_MAX_RETRIES || 4));
const TMAP_RETRY_DELAYS_MS = [600, 1200, 2200, 3600];
let tmapQueue: Promise<void> = Promise.resolve();
let tmapLastRequestAt = 0;
const tmapResponseCache = new Map<string, { expiresAt: number; value?: any; inFlight?: Promise<any> }>();

function normalizeSpecies(species?: string) {
  const text = String(species || "");
  if (text.includes("海棠")) return "垂丝海棠";
  if (text.includes("玉兰")) return text.includes("白") ? "白玉兰" : "玉兰";
  if (text.includes("樱花") || text.includes("早樱")) return "樱花";
  if (text.includes("山桃")) return "山桃";
  if (text.includes("桃花")) return "桃花";
  if (text.includes("紫叶李")) return "紫叶李";
  if (text.includes("连翘")) return "连翘";
  if (text.includes("梨花")) return "梨花";
  return text;
}

function stopHasSpecies(stop: PlannerStop, species: string) {
  const targets = new Set([
    ...String((stop as { plants?: string }).plants || "")
      .split(/[、,，/\s]+/)
      .map((item) => normalizeSpecies(item))
      .filter(Boolean),
    ...(((stop as { species?: string[] }).species || []).map((item) => normalizeSpecies(item)).filter(Boolean)),
  ]);
  return targets.has(normalizeSpecies(species));
}

function nearestDuration(value?: number) {
  const source = Number.isFinite(value) ? Number(value) : 45;
  return [30, 45, 60].reduce((best, current) => (Math.abs(current - source) < Math.abs(best - source) ? current : best), 45);
}

function normalizePlaceName(value?: string) {
  return String(value || "")
    .replace(/\s+/g, "")
    .replace(/[（）()·,，\-—_.]/g, "")
    .trim();
}

function stripGenericPlaceWords(value?: string) {
  let next = normalizePlaceName(value);
  GENERIC_PLACE_SUFFIXES.forEach((word) => {
    if (next.startsWith(word)) next = next.slice(word.length);
    if (next.endsWith(word)) next = next.slice(0, Math.max(0, next.length - word.length));
  });
  GENERIC_PLACE_TAILS.forEach((word) => {
    if (next.endsWith(word) && next.length > word.length) next = next.slice(0, next.length - word.length);
  });
  return next.trim();
}

function getMeaningfulPlaceTokens(value?: string) {
  const cleaned = stripGenericPlaceWords(value);
  if (!cleaned) return [];
  return Array.from(new Set(
    cleaned
      .split(/[、,，/\s]+/)
      .map((item) => item.trim())
      .filter(Boolean),
  ));
}

function scorePlaceNameMatch(query: string, candidate?: string) {
  const q = normalizePlaceName(query);
  const c = normalizePlaceName(candidate);
  if (!q || !c) return 0;
  if (q === c) return 120;
  if (c.includes(q) || q.includes(c)) return 92;
  const qCore = stripGenericPlaceWords(q);
  const cCore = stripGenericPlaceWords(c);
  if (qCore && cCore && qCore === cCore) return 86;
  if (qCore && cCore && (cCore.includes(qCore) || qCore.includes(cCore))) return 70;
  const tokens = getMeaningfulPlaceTokens(q);
  const tokenHits = tokens.filter((token) => token && c.includes(token));
  if (!tokenHits.length) return 0;
  return tokenHits.reduce((score, token) => score + (token.length >= 2 ? 28 : 10), 0);
}

function looksLikeDiningQuery(value?: string) {
  return LUNCH_QUERY_PATTERN.test(String(value || ""));
}

function buildCampusSearchKeywords(query?: string) {
  const safe = String(query || "").trim();
  if (!safe) return [];
  return Array.from(new Set([
    safe,
    /^清华(?:大学)?/.test(safe) ? safe : `清华大学 ${safe}`,
  ]));
}

function findCuratedPoiMatch(query: string, pois: CuratedPoi[]) {
  const safeQuery = String(query || "").trim();
  if (!safeQuery) return null;
  let best: CuratedPoi | null = null;
  let bestScore = 0;
  for (const poi of pois) {
    const aliases = (poi.aliases || []).filter((alias) => !GENERIC_ALIAS_BLACKLIST.has(alias));
    const score = Math.max(
      scorePlaceNameMatch(safeQuery, poi.name),
      ...aliases.map((alias) => scorePlaceNameMatch(safeQuery, alias)),
    );
    if (score > bestScore) {
      best = poi;
      bestScore = score;
    }
  }
  return bestScore >= 28 ? best : null;
}

function resolveColorIntent(raw: string) {
  if (/粉色|粉粉|少女|浪漫/.test(raw)) return "pink";
  if (/白色|白花|纯白/.test(raw)) return "white";
  if (/黄色|黄花/.test(raw)) return "yellow";
  return undefined;
}

function extractTargetPoiQuery(raw: string) {
  const patterns = [
    /(?:最后去|再去|然后去|顺路去|前往|到达|去到|去)([^，。,；;]+)/,
    /(?:找个|找一家|找一间|找)([^，。,；;]+)/,
  ];
  for (const pattern of patterns) {
    const match = raw.match(pattern);
    const value = String(match?.[1] || "")
      .replace(/(休息一会|休息|坐一坐|吃个饭|吃饭|午饭|午餐|拍照|赏花|看看).*$/, "")
      .trim();
    if (value && value.length >= 2 && !FLOWER_KEYWORDS.includes(value)) return value;
  }
  return undefined;
}

function deriveSupplySearchKeywords(raw: string) {
  const text = String(raw || "");
  if (/麦当劳/.test(text)) return ["麦当劳", "快餐"];
  if (/肯德基/.test(text)) return ["肯德基", "快餐"];
  if (/咖啡|咖啡厅/.test(text)) return ["咖啡厅", "咖啡"];
  if (/奶茶|茶饮/.test(text)) return ["奶茶", "茶饮"];
  if (/餐厅|餐馆|饭店|快餐/.test(text)) return ["餐厅", "快餐"];
  return ["食堂", "餐厅"];
}

function getDefaultScenicCount(durationMinutes: number) {
  if (durationMinutes <= 30) return 2;
  if (durationMinutes <= 45) return 3;
  return 4;
}

function buildDefaultScenicQuery(intent: Pick<ParsedIntent, "preferredColor" | "preferredSpecies" | "wantsPhoto">) {
  if (intent.preferredColor === "pink") return "粉色的花";
  if (intent.preferredColor === "white") return "白色的花";
  if (intent.preferredColor === "yellow") return "黄色的花";
  if (intent.preferredSpecies.length) return intent.preferredSpecies.join(" / ");
  if (intent.wantsPhoto) return "适合拍照的春日景点";
  return "校园春景";
}

function createBaseIntent(input: DemoPlannerRequest): ParsedIntent {
  return {
    rawQuery: String(input.query || "").trim(),
    sceneId: input.sceneId || "tsinghua-spring",
    durationMinutes: nearestDuration(input.durationMinutes),
    style: input.style || "balanced",
    theme: input.theme || "flowers",
    preferredSpecies: [],
    scenicCount: getDefaultScenicCount(nearestDuration(input.durationMinutes)),
    startPointName: String(input.startPoint?.name || "").trim() || undefined,
    wantsPhoto: false,
    wantsShade: false,
    wantsRest: false,
    wantsLunch: false,
    lunchMode: "none",
    planMode: "single",
    planReasoning: [],
  };
}

function parseIntentFallback(input: DemoPlannerRequest, pois: CuratedPoi[]) {
  const raw = String(input.query || "").trim();
  const result = createBaseIntent(input);
  if (!raw) return result;
  if (/拍照|出片|摄影|机位/.test(raw)) {
    result.theme = "photo";
    result.wantsPhoto = true;
  }
  if (/赏花|春花|花卉|玉兰|樱花|海棠|桃花|山桃|连翘|紫叶李|梨花/.test(raw) && result.theme !== "photo") result.theme = "flowers";
  if (/避晒|不想晒|阴凉|树荫|凉快/.test(raw)) {
    result.style = "shade";
    result.wantsShade = true;
  }
  if (/休息|轻松|慢慢逛|不累|坐一坐|补给/.test(raw)) {
    result.style = result.style === "shade" ? result.style : "rest";
    result.wantsRest = true;
  }
  if (/午饭|吃饭|吃个饭|吃点东西|找地方吃|顺便吃|食堂|午餐|咖啡|补给/.test(raw)) result.wantsLunch = true;
  if (/然后|再去|最后去|先.+再/.test(raw)) result.planMode = "multi";
  const durationMatch = raw.match(/(\d+)\s*分钟/);
  if (durationMatch) result.durationMinutes = nearestDuration(Number(durationMatch[1]));
  else if (/走一段时间|逛一会|慢慢逛/.test(raw)) result.durationMinutes = 45;
  const species = FLOWER_KEYWORDS.find((keyword) => raw.includes(keyword));
  const preferredColor = resolveColorIntent(raw);
  if (species) result.preferredSpecies.push(normalizeSpecies(species));
  if (preferredColor) {
    result.preferredColor = preferredColor;
    for (const item of COLOR_SPECIES_MAP[preferredColor]) {
      if (!result.preferredSpecies.includes(item)) result.preferredSpecies.push(item);
    }
  }
  result.scenicQuery = buildDefaultScenicQuery(result);
  result.scenicCount = getDefaultScenicCount(result.durationMinutes);
  const targetQuery = extractTargetPoiQuery(raw);
  const target = findCuratedPoiMatch(targetQuery || raw, pois);
  if (target && looksLikeDiningQuery(target.name)) {
    result.wantsLunch = true;
    result.lunchMode = "explicit";
    result.lunchQuery = target.name;
    result.targetPoiName = target.name;
    result.targetPoiId = target.id;
  } else if (target) {
    result.targetPoiName = target.name;
    result.targetPoiId = target.id;
  } else if (targetQuery) {
    if (looksLikeDiningQuery(targetQuery)) {
      result.wantsLunch = true;
      result.lunchMode = "explicit";
      result.lunchQuery = targetQuery;
    } else {
      result.targetPoiQuery = targetQuery;
    }
  }
  if (result.wantsLunch && result.lunchMode === "none") {
    result.lunchMode = "nearby";
    result.lunchQuery = deriveSupplySearchKeywords(raw)[0] || "食堂";
  }
  result.planReasoning = [
    result.scenicQuery ? `先围绕“${result.scenicQuery}”选赏花段，再安排后续补给或目标点。` : "先选一段校园春景路线。",
  ];
  if (result.lunchMode !== "none") result.planReasoning.push(`用户有用餐诉求，按“${result.lunchQuery || "食堂"}”补给需求处理。`);
  if (result.targetPoiQuery || result.targetPoiName) result.planReasoning.push(`需要把 ${result.targetPoiQuery || result.targetPoiName} 放进后半程。`);
  return result;
}

function getTextContent(content: unknown) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object" && "text" in item) return String((item as { text?: unknown }).text || "");
        return "";
      })
      .join("\n");
  }
  return String(content || "");
}

function extractJsonObject(text: string) {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

function mergeParsedIntent(intent: ParsedIntent, parsed: any, pois: PlannerStop[]) {
  const next = { ...intent };
  if (Number.isFinite(parsed?.durationMinutes)) next.durationMinutes = nearestDuration(Number(parsed.durationMinutes));
  if (parsed?.preferredColor === "pink" || parsed?.preferredColor === "white" || parsed?.preferredColor === "yellow") next.preferredColor = parsed.preferredColor;
  if (Array.isArray(parsed?.preferredSpecies)) {
    next.preferredSpecies = Array.from(new Set([...next.preferredSpecies, ...parsed.preferredSpecies.map((item: string) => normalizeSpecies(item)).filter(Boolean)]));
  }
  if (typeof parsed?.scenicQuery === "string" && parsed.scenicQuery.trim()) next.scenicQuery = parsed.scenicQuery.trim();
  if (Number.isFinite(parsed?.scenicCount)) next.scenicCount = Math.max(1, Math.min(4, Number(parsed.scenicCount)));
  if (typeof parsed?.theme === "string" && parsed.theme) next.theme = parsed.theme;
  if (typeof parsed?.style === "string" && parsed.style) next.style = parsed.style;
  next.wantsPhoto = Boolean(parsed?.wantsPhoto ?? next.wantsPhoto);
  next.wantsShade = Boolean(parsed?.wantsShade ?? next.wantsShade);
  next.wantsRest = Boolean(parsed?.wantsRest ?? next.wantsRest);
  if (parsed?.planMode === "multi") next.planMode = "multi";
  if (parsed?.lunchMode === "none" || parsed?.lunchMode === "nearby" || parsed?.lunchMode === "explicit") next.lunchMode = parsed.lunchMode;
  if (typeof parsed?.lunchQuery === "string") next.lunchQuery = parsed.lunchQuery.trim() || undefined;
  if (typeof parsed?.targetPoiName === "string" && parsed.targetPoiName.trim()) {
    const curatedPois = pois.filter((poi): poi is CuratedPoi => "id" in poi && typeof poi.id === "string");
    const target = findCuratedPoiMatch(parsed.targetPoiName, curatedPois);
    const shouldTrustCuratedTarget = !next.targetPoiQuery || scorePlaceNameMatch(next.targetPoiQuery, parsed.targetPoiName) >= 42;
    if (target && shouldTrustCuratedTarget && !looksLikeDiningQuery(parsed.targetPoiName)) {
      next.targetPoiName = target.name;
      next.targetPoiId = target.id;
      next.targetPoiQuery = undefined;
    } else {
      if (looksLikeDiningQuery(parsed.targetPoiName) && next.lunchMode === "none") {
        next.lunchMode = "explicit";
        next.lunchQuery = parsed.targetPoiName.trim();
      } else {
        next.targetPoiQuery = parsed.targetPoiName.trim();
      }
    }
  }
  if (typeof parsed?.targetPoiQuery === "string" && parsed.targetPoiQuery.trim() && !next.targetPoiId) {
    if (looksLikeDiningQuery(parsed.targetPoiQuery) && next.lunchMode === "none") {
      next.lunchMode = "explicit";
      next.lunchQuery = parsed.targetPoiQuery.trim();
    } else {
      next.targetPoiQuery = parsed.targetPoiQuery.trim();
    }
  }
  if (!next.scenicQuery) next.scenicQuery = buildDefaultScenicQuery(next);
  if (!Number.isFinite(next.scenicCount)) next.scenicCount = getDefaultScenicCount(next.durationMinutes);
  next.planReasoning = Array.isArray(parsed?.reasoning)
    ? parsed.reasoning.map((item: string) => String(item).trim()).filter(Boolean)
    : next.planReasoning;
  if (next.lunchMode === "none" && Boolean(parsed?.wantsLunch)) {
    next.lunchMode = "nearby";
    next.lunchQuery = next.lunchQuery || "食堂";
  }
  if (next.lunchMode !== "none" && !next.lunchQuery) next.lunchQuery = "食堂";
  next.wantsLunch = next.lunchMode !== "none";
  if (next.targetPoiQuery && !next.targetPoiId) {
    const curatedPois = pois.filter((poi): poi is CuratedPoi => "id" in poi && typeof poi.id === "string");
    const target = findCuratedPoiMatch(next.targetPoiQuery, curatedPois);
    if (target && !looksLikeDiningQuery(next.targetPoiQuery)) {
      next.targetPoiName = target.name;
      next.targetPoiId = target.id;
    }
  }
  return next;
}

function buildHeuristicTaskPlan(intent: ParsedIntent, mode: TaskPlan["routerMode"] = "heuristic"): TaskPlan {
  const tasks: TaskKind[] = ["scene_profile"];
  const searches: PlannedSearch[] = [];
  const reasoning: string[] = [];
  if ((intent.scenicCount || 0) > 0) {
    tasks.push("flower_filter");
    reasoning.push(...(intent.planReasoning.length ? intent.planReasoning.slice(0, 2) : [`先围绕 ${intent.scenicQuery || "校园春景"} 做花点筛选，再决定后续停靠点。`]));
  }
  if (intent.lunchMode !== "none") {
    tasks.push("poi_search");
    if (intent.lunchMode === "nearby") {
      searches.push({
        purpose: "lunch",
        keywords: [intent.lunchQuery || "食堂"],
        around: "last_scenic_stop",
        radiusMeters: 1400,
        reason: "用户要顺路补给，需要在赏花段附近搜一个午餐 POI。",
      });
    }
    reasoning.push(`用户有用餐诉求，按“${intent.lunchQuery || "食堂"}”做地点解析。`);
  }
  if (intent.targetPoiId || intent.targetPoiQuery) {
    tasks.push("target_resolution");
    if (intent.targetPoiQuery) {
      searches.push({
        purpose: "target",
        keywords: [intent.targetPoiQuery],
        around: "last_stop",
        radiusMeters: 2600,
        reason: "用户提到了额外目标地，需要做一次地点解析。",
      });
    }
    reasoning.push(`用户还提到了 ${intent.targetPoiName || intent.targetPoiQuery || "目标点位"}，需要把它放进后半程。`);
  }
  tasks.push("reverse_geocode", "route_planning");
  if (!reasoning.length) reasoning.push("先理解基础需求，再直接进入步行路线规划。");
  return {
    routerMode: mode,
    tasks: Array.from(new Set(tasks)),
    searches,
    reasoning,
  };
}

async function invokeModelWithTimeout(prompt: string, timeoutMs: number, label: string) {
  const model = createPlannerModel();
  return Promise.race([
    model.invoke(prompt),
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`${label} timeout after ${timeoutMs}ms`)), timeoutMs);
    }),
  ]);
}

function getTaskRouterTimeoutMs() {
  const raw = Number(process.env.TASK_ROUTER_TIMEOUT_MS || 200000);
  if (!Number.isFinite(raw)) return 200000;
  return Math.max(30000, raw);
}

async function maybeRefineIntent(input: DemoPlannerRequest, scene: ReturnType<typeof getSceneProfile>, pois: CuratedPoi[]) {
  const fallbackIntent = parseIntentFallback(input, pois);
  const fallbackPlan = buildHeuristicTaskPlan(fallbackIntent, "heuristic");
  if (!process.env.OPENAI_API_KEY) return { intent: fallbackIntent, taskPlan: fallbackPlan, routerDebug: { used: false, mode: "heuristic", error: "OPENAI_API_KEY missing" } satisfies RouterDebug };
  const baseIntent = createBaseIntent(input);
  try {
    const timeoutMs = getTaskRouterTimeoutMs();
    const poiNames = pois.map((poi) => poi.name).slice(0, 16).join("、");
    const aliasNames = Object.entries(scene.poiAliases || {})
      .map(([name, aliases]) => `${name}:${aliases.slice(0, 3).join("/")}`)
      .join("；");
    const prompt = [
      "你是校园路线 Agent 的需求结构化器。",
      "你只做一件事：把用户需求拆成结构化 plan，不要规划路线，不要猜测 POI 坐标。",
      "请只输出一个 JSON 对象，不要输出任何解释。",
      "只允许输出一个 JSON 对象。",
      '输出字段: {"durationMinutes":45,"preferredColor":"pink","preferredSpecies":[],"wantsPhoto":false,"wantsShade":false,"wantsRest":false,"theme":"flowers","style":"balanced","planMode":"single","scenicQuery":"粉色的花","scenicCount":3,"lunchMode":"none","lunchQuery":"","targetPoiQuery":"","reasoning":[]}',
      `当前场景：${scene.sceneName}`,
      `当前起点：${baseIntent.startPointName || scene.center.name}`,
      `当前校园别名：${aliasNames}`,
      `当前核心点位：${poiNames}`,
      `推荐腾讯地图工具：${(scene.recommendedMcpTools || []).join("、")}`,
      "scenicQuery: 保留用户对赏花段/拍照段/漫步段的原始语义，例如“粉色的花”“适合拍照的春景”“轻松逛一段”。",
      "scenicCount: 1 到 4 个，按总时长和多阶段需求决定。",
      "lunchMode 只能是 none / nearby / explicit。",
      "如果用户只是想顺路吃饭但没指定地点，lunchMode=nearby，lunchQuery 只填一个简短搜索词，比如“食堂”“咖啡”“餐厅”。",
      "如果用户明确说了某个餐饮地点，lunchMode=explicit，lunchQuery 必须保留用户原词，不要擅自改写成同义词。",
      "targetPoiQuery 只填非餐饮的明确目标点，例如“情人坡”“图书馆”“计算机系馆”。",
      "不要把 lunchQuery 或 targetPoiQuery 改写成你猜测的别名；原词优先。",
      "reasoning 给 1 到 3 条简短中文理由。",
      `用户问题：${baseIntent.rawQuery}`,
    ].join("\n");
    const response = await invokeModelWithTimeout(prompt, timeoutMs, "task router");
    const rawResponse = getTextContent(response.content);
    const parsed = extractJsonObject(rawResponse);
    if (!parsed || typeof parsed !== "object") {
      throw new Error("模型未返回可解析的任务路由 JSON");
    }
    const next = mergeParsedIntent(baseIntent, parsed, pois);
    return {
      intent: next,
      taskPlan: buildHeuristicTaskPlan(next, "llm"),
      routerDebug: { used: true, mode: "llm", rawResponse } satisfies RouterDebug,
    };
  } catch (error) {
    return {
      intent: fallbackIntent,
      taskPlan: fallbackPlan,
      routerDebug: {
        used: true,
        mode: "heuristic",
        error: error instanceof Error ? error.message : "task router failed",
      } satisfies RouterDebug,
    };
  }
}

function stopMatchesSpecies(stop: PlannerStop, speciesList: string[]) {
  const normalizedSpecies = new Set(speciesList.map((item) => normalizeSpecies(item)));
  return Array.from(normalizedSpecies).some((species) => stopHasSpecies(stop, species));
}

function getDistanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const earth = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s1 = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * earth * Math.atan2(Math.sqrt(s1), Math.sqrt(1 - s1));
}

function optimizeSequence<T extends PlannerStop>(stops: T[], center: { lat: number; lng: number }) {
  const pool = [...stops];
  const ordered: T[] = [];
  let cursor = center;
  while (pool.length) {
    pool.sort((a, b) => getDistanceKm(cursor, a) - getDistanceKm(cursor, b));
    const next = pool.shift();
    if (!next) break;
    ordered.push(next);
    cursor = next;
  }
  return ordered;
}

function uniqueStops(list: PlannerStop[]) {
  const seen = new Set<string>();
  return list.filter((item) => {
    const key = item.id || `${item.name}-${item.lat}-${item.lng}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTencentRateLimitMessage(message: string) {
  const text = String(message || "");
  return /达到上限|请求量已达到上限|limit|too many|频率|QPS/i.test(text);
}

async function enqueueTencentRequest<T>(task: () => Promise<T>) {
  const run = async () => {
    const elapsed = Date.now() - tmapLastRequestAt;
    if (elapsed < TMAP_MIN_INTERVAL_MS) {
      await sleep(TMAP_MIN_INTERVAL_MS - elapsed);
    }
    const result = await task();
    tmapLastRequestAt = Date.now();
    return result;
  };
  const scheduled = tmapQueue.then(run, run);
  tmapQueue = scheduled.then(() => undefined, () => undefined);
  return scheduled;
}

function getMapProvider() {
  return MAP_PROVIDER;
}

function getMapProviderLabel() {
  return MAP_PROVIDER_LABEL;
}

async function tencentGet(path: string, params: Record<string, string | number | undefined>) {
  const key = process.env.TMAP_WEBSERVICE_KEY;
  if (!key) throw new Error("TMAP_WEBSERVICE_KEY is required");
  const url = new URL(`https://apis.map.qq.com${path}`);
  Object.entries({ ...params, key }).forEach(([name, value]) => {
    if (value === undefined || value === null || value === "") return;
    url.searchParams.set(name, String(value));
  });
  const cacheKey = url.toString();
  const cached = tmapResponseCache.get(cacheKey);
  if (cached?.value && cached.expiresAt > Date.now()) return cached.value;
  if (cached?.inFlight) return cached.inFlight;

  const requestPromise = enqueueTencentRequest(async () => {
    let lastError: Error | null = null;
    for (let attempt = 0; attempt < TMAP_MAX_RETRIES; attempt += 1) {
      try {
        const response = await fetch(url);
        if (!response.ok) {
          const message = `Tencent API ${path} failed: ${response.status}`;
          if (isTencentRateLimitMessage(message) && attempt < TMAP_MAX_RETRIES - 1) {
            await sleep(TMAP_RETRY_DELAYS_MS[Math.min(attempt, TMAP_RETRY_DELAYS_MS.length - 1)]);
            continue;
          }
          throw new Error(message);
        }
        const data = await response.json();
        if (data?.status !== 0) {
          const message = data?.message || `Tencent API ${path} returned status ${data?.status}`;
          if (isTencentRateLimitMessage(message) && attempt < TMAP_MAX_RETRIES - 1) {
            await sleep(TMAP_RETRY_DELAYS_MS[Math.min(attempt, TMAP_RETRY_DELAYS_MS.length - 1)]);
            continue;
          }
          throw new Error(message);
        }
        tmapResponseCache.set(cacheKey, {
          expiresAt: Date.now() + TMAP_CACHE_TTL_MS,
          value: data,
        });
        return data;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error || "Tencent request failed"));
        if (!isTencentRateLimitMessage(lastError.message) || attempt >= TMAP_MAX_RETRIES - 1) break;
        await sleep(TMAP_RETRY_DELAYS_MS[Math.min(attempt, TMAP_RETRY_DELAYS_MS.length - 1)]);
      }
    }
    throw lastError || new Error(`Tencent API ${path} failed`);
  });

  tmapResponseCache.set(cacheKey, {
    expiresAt: Date.now() + TMAP_CACHE_TTL_MS,
    inFlight: requestPromise,
  });

  try {
    return await requestPromise;
  } finally {
    const current = tmapResponseCache.get(cacheKey);
    if (current?.inFlight === requestPromise) {
      if (current.value) tmapResponseCache.set(cacheKey, current);
      else tmapResponseCache.delete(cacheKey);
    }
  }
}

async function baiduGet(path: string, params: Record<string, string | number | boolean | undefined>) {
  const key = process.env.BAIDU_MAP_AK;
  if (!key) throw new Error("BAIDU_MAP_AK is required");
  const url = new URL(`https://api.map.baidu.com${path}`);
  Object.entries({ ...params, ak: key, output: "json" }).forEach(([name, value]) => {
    if (value === undefined || value === null || value === "") return;
    url.searchParams.set(name, String(value));
  });
  const cacheKey = url.toString();
  const cached = tmapResponseCache.get(cacheKey);
  if (cached?.value && cached.expiresAt > Date.now()) return cached.value;
  if (cached?.inFlight) return cached.inFlight;

  const requestPromise = enqueueTencentRequest(async () => {
    let lastError: Error | null = null;
    for (let attempt = 0; attempt < TMAP_MAX_RETRIES; attempt += 1) {
      try {
        const response = await fetch(url);
        if (!response.ok) {
          const message = `Baidu API ${path} failed: ${response.status}`;
          if (isTencentRateLimitMessage(message) && attempt < TMAP_MAX_RETRIES - 1) {
            await sleep(TMAP_RETRY_DELAYS_MS[Math.min(attempt, TMAP_RETRY_DELAYS_MS.length - 1)]);
            continue;
          }
          throw new Error(message);
        }
        const data = await response.json();
        if (Number(data?.status) !== 0) {
          const message = data?.message || `Baidu API ${path} returned status ${data?.status}`;
          if (isTencentRateLimitMessage(message) && attempt < TMAP_MAX_RETRIES - 1) {
            await sleep(TMAP_RETRY_DELAYS_MS[Math.min(attempt, TMAP_RETRY_DELAYS_MS.length - 1)]);
            continue;
          }
          throw new Error(message);
        }
        tmapResponseCache.set(cacheKey, {
          expiresAt: Date.now() + TMAP_CACHE_TTL_MS,
          value: data,
        });
        return data;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error || "Baidu request failed"));
        if (!isTencentRateLimitMessage(lastError.message) || attempt >= TMAP_MAX_RETRIES - 1) break;
        await sleep(TMAP_RETRY_DELAYS_MS[Math.min(attempt, TMAP_RETRY_DELAYS_MS.length - 1)]);
      }
    }
    throw lastError || new Error(`Baidu API ${path} failed`);
  });

  tmapResponseCache.set(cacheKey, {
    expiresAt: Date.now() + TMAP_CACHE_TTL_MS,
    inFlight: requestPromise,
  });

  try {
    return await requestPromise;
  } finally {
    const current = tmapResponseCache.get(cacheKey);
    if (current?.inFlight === requestPromise) {
      if (current.value) tmapResponseCache.set(cacheKey, current);
      else tmapResponseCache.delete(cacheKey);
    }
  }
}

function decodeTencentPolyline(polyline: number[]) {
  const coors = [...polyline];
  for (let i = 2; i < coors.length; i += 1) coors[i] = coors[i - 2] + coors[i] / 1000000;
  const points = [];
  for (let i = 0; i < coors.length; i += 2) points.push({ lat: coors[i], lng: coors[i + 1] });
  return points;
}

function decodeBaiduPath(path?: string) {
  return String(path || "")
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((pair) => {
      const [lng, lat] = pair.split(",").map((value) => Number(value));
      return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
    })
    .filter(Boolean) as Array<{ lat: number; lng: number }>;
}

function normalizeSearchPoi(item: any, keyword: string, anchor?: { lat: number; lng: number }) {
  const location = item?.location || {};
  const lat = Number(location.lat);
  const lng = Number(location.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return {
    id: item.uid || item.id || `poi-${Date.now()}-${Math.random()}`,
    name: item.title || item.name || keyword,
    address: item.address || item.addr || "",
    lat,
    lng,
    aliases: [],
    tags: ["search-result"],
    plants: "",
    stayMinutes: 14,
    photoScore: 68,
    bloomScore: 52,
    shadeScore: 66,
    restScore: 70,
    searchDistanceMeters: anchor ? Number(item._distance || item.distance || getDistanceKm(anchor, { lat, lng }) * 1000) : undefined,
  } satisfies SearchPoi;
}

async function searchNearbyPoi(keyword: string, anchor: { lat: number; lng: number }, radius = 1200) {
  const items = await searchNearbyPoiCandidates(keyword, anchor, radius);
  return items[0] || null;
}

async function searchNearbyPoiCandidates(keyword: string, anchor: { lat: number; lng: number }, radius = 1200) {
  if (getMapProvider() === "baidu") {
    const data = await baiduGet("/place/v2/search", {
      query: keyword,
      location: `${anchor.lat},${anchor.lng}`,
      radius,
      radius_limit: true,
      page_size: 20,
      page_num: 0,
      scope: 2,
      ret_coordtype: "gcj02ll",
    });
    return (Array.isArray(data?.results) ? data.results : [])
      .map((item: any) => normalizeSearchPoi(item, keyword, anchor))
      .filter(Boolean) as SearchPoi[];
  }
  const data = await tencentGet("/ws/place/v1/search", {
    keyword,
    boundary: `nearby(${anchor.lat},${anchor.lng},${radius},1)`,
    orderby: "_distance",
    page_size: 20,
    page_index: 1,
  });
  return (Array.isArray(data?.data) ? data.data : [])
    .map((item: any) => normalizeSearchPoi(item, keyword, anchor))
    .filter(Boolean) as SearchPoi[];
}

async function searchTextPoiCandidates(
  keyword: string,
  anchor?: { lat: number; lng: number },
  options?: {
    nearbyRadiusMeters?: number;
    includeNearby?: boolean;
  },
) {
  const includeNearby = Boolean(anchor && options?.includeNearby);
  const nearbyRadiusMeters = Math.max(500, Number(options?.nearbyRadiusMeters || 3600));
  if (getMapProvider() === "baidu") {
    const [regionResults, nearbyResults] = await Promise.all([
      baiduGet("/place/v2/search", {
        query: keyword,
        region: "北京",
        page_size: 20,
        page_num: 0,
        scope: 2,
        ret_coordtype: "gcj02ll",
      }),
      includeNearby
        ? baiduGet("/place/v2/search", {
            query: keyword,
            location: `${anchor!.lat},${anchor!.lng}`,
            radius: nearbyRadiusMeters,
            radius_limit: true,
            page_size: 20,
            page_num: 0,
            scope: 2,
            ret_coordtype: "gcj02ll",
          })
        : Promise.resolve({ results: [] }),
    ]);
    const merged = [...(Array.isArray(regionResults?.results) ? regionResults.results : []), ...(Array.isArray(nearbyResults?.results) ? nearbyResults.results : [])];
    const seen = new Set<string>();
    return merged
      .map((item: any) => normalizeSearchPoi(item, keyword, anchor))
      .filter(Boolean)
      .filter((item) => {
        const key = `${item!.name}-${item!.lat}-${item!.lng}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      }) as SearchPoi[];
  }
  const [regionResults, nearbyResults] = await Promise.all([
    tencentGet("/ws/place/v1/search", {
      keyword,
      boundary: "region(北京,0)",
      page_size: 20,
      page_index: 1,
    }),
    includeNearby
      ? tencentGet("/ws/place/v1/search", {
          keyword,
          boundary: `nearby(${anchor!.lat},${anchor!.lng},${nearbyRadiusMeters},1)`,
          orderby: "_distance",
          page_size: 20,
          page_index: 1,
        })
      : Promise.resolve({ data: [] }),
  ]);
  const merged = [...(Array.isArray(regionResults?.data) ? regionResults.data : []), ...(Array.isArray(nearbyResults?.data) ? nearbyResults.data : [])];
  const seen = new Set<string>();
  return merged
    .filter((item: any) => item?.location)
    .map((item: any) => {
      const lat = Number(item.location.lat);
      const lng = Number(item.location.lng);
      const name = item.title || item.name || keyword;
      const key = `${name}-${lat}-${lng}`;
      if (seen.has(key)) return null;
      seen.add(key);
      return {
        id: item.id || `poi-${Date.now()}-${Math.random()}`,
        name,
        address: item.address || "",
        lat,
        lng,
        aliases: [],
        tags: ["search-result"],
        plants: "",
        stayMinutes: 14,
        photoScore: 68,
        bloomScore: 52,
        shadeScore: 66,
        restScore: 70,
        searchDistanceMeters: anchor ? Number(item._distance || getDistanceKm(anchor, { lat, lng }) * 1000) : undefined,
      } satisfies SearchPoi;
    })
    .filter(Boolean) as SearchPoi[];
}

export async function searchDemoPois(input: PoiSearchDemoRequest) {
  const query = String(input.query || "").trim();
  if (!query) {
    throw new Error("query is required");
  }

  const scene = getSceneProfile(input.sceneId || "tsinghua-spring");
  const curatedPois = getScenePois(scene.sceneId);
  const anchorName = String(input.anchor?.name || "").trim();
  let anchorResolvedBy = "scene_center";
  let anchor =
    Number.isFinite(input.anchor?.lat) && Number.isFinite(input.anchor?.lng)
      ? {
          name: anchorName || "自定义锚点",
          lat: Number(input.anchor?.lat),
          lng: Number(input.anchor?.lng),
        }
      : {
          name: scene.center.name || "场景中心",
          lat: scene.center.lat,
          lng: scene.center.lng,
        };
  if (Number.isFinite(input.anchor?.lat) && Number.isFinite(input.anchor?.lng)) {
    anchorResolvedBy = "manual_coordinates";
  } else if (anchorName) {
    const curatedAnchor = findCuratedPoiMatch(anchorName, curatedPois);
    if (curatedAnchor) {
      anchor = {
        name: curatedAnchor.name,
        lat: curatedAnchor.lat,
        lng: curatedAnchor.lng,
      };
      anchorResolvedBy = "curated_match";
    } else {
      const anchorCandidates = uniqueStops((await Promise.all(buildCampusSearchKeywords(anchorName).map((keyword) => searchTextPoiCandidates(keyword, scene.center)))).flat()) as SearchPoi[];
      const rankedAnchors = rankPoiCandidates(anchorCandidates, scene.center, anchorName, "start", scene);
      if (rankedAnchors[0]) {
        anchor = {
          name: rankedAnchors[0].name,
          lat: rankedAnchors[0].lat,
          lng: rankedAnchors[0].lng,
        };
        anchorResolvedBy = "poi_search";
      }
    }
  }
  const radiusMeters = Math.max(500, Math.min(20000, Number(input.radiusMeters || 3600)));
  const keywords = buildCampusSearchKeywords(query);
  const batches = await Promise.all(keywords.map((keyword) => searchTextPoiCandidates(keyword, anchor)));
  const merged = uniqueStops(batches.flat()) as SearchPoi[];
  const ranked = rankPoiCandidates(merged, anchor, query, looksLikeDiningQuery(query) ? "lunch" : "target", scene);

  return {
    sceneId: scene.sceneId,
    query,
    anchor,
    anchorQuery: anchorName || undefined,
    anchorResolvedBy,
    radiusMeters,
    keywords,
    selectionStrategy: "raw_query_recall + llm_first + heuristic_fallback",
    totalCandidates: ranked.length,
    candidates: ranked.map((item, index) => ({
      rank: index + 1,
      name: item.name,
      address: item.address || "",
      lat: item.lat,
      lng: item.lng,
      distanceMeters: Math.round(Number(item.searchDistanceMeters || getDistanceKm(anchor, item) * 1000)),
      heuristicScore: Math.round(item.heuristicScore),
    })),
  };
}

function buildScenicCandidateSummary(stop: PlannerStop) {
  const species = Array.isArray((stop as { species?: string[] }).species) ? ((stop as { species?: string[] }).species || []).join("/") : "";
  const plants = String((stop as { plants?: string }).plants || "");
  const tags = Array.isArray(stop.tags) ? stop.tags.join("/") : "";
  return [species, plants, tags].filter(Boolean).join(" | ");
}

function rankScenicCandidates(
  candidates: PlannerStop[],
  anchor: { lat: number; lng: number },
  query: string,
  intent: ParsedIntent,
) {
  const scenicQuery = String(query || intent.scenicQuery || intent.rawQuery || "校园春景");
  const queryTokens = getMeaningfulPlaceTokens(scenicQuery);
  return candidates
    .map((stop) => {
      const text = `${stop.name} ${buildScenicCandidateSummary(stop)}`;
      const normalizedText = normalizePlaceName(text);
      const textScore = Math.max(scorePlaceNameMatch(scenicQuery, stop.name), scorePlaceNameMatch(scenicQuery, text));
      const tokenScore = queryTokens.reduce((score, token) => {
        const normalizedToken = normalizePlaceName(token);
        if (!normalizedToken) return score;
        return normalizedText.includes(normalizedToken) ? score + 12 : score;
      }, 0);
      const biasScore =
        (intent.wantsPhoto && (stop.tags || []).includes("photo") ? 8 : 0)
        + (intent.wantsRest && (stop.tags || []).includes("rest") ? 10 : 0)
        + (intent.wantsShade && (stop.tags || []).includes("shade") ? 8 : 0);
      const distanceMeters = getDistanceKm(anchor, stop) * 1000;
      const heuristicScore = textScore + tokenScore + biasScore - distanceMeters / 85;
      return {
        stop,
        heuristicScore,
        textScore,
        distanceMeters,
      };
    })
    .sort((a, b) => b.heuristicScore - a.heuristicScore);
}

async function selectScenicStopsWithLLM(params: {
  userQuery: string;
  scenicQuery: string;
  scenicCount: number;
  anchor: AnchorPoint;
  candidates: PlannerStop[];
  sceneName: string;
  intent: ParsedIntent;
}) {
  const ranked = rankScenicCandidates(params.candidates, params.anchor, params.scenicQuery, params.intent);
  const fallbackStops = (
    ranked
    .filter((item) => item.textScore > 0 || !params.scenicQuery)
    .slice(0, Math.max(1, params.scenicCount))
    .map((item) => item.stop)
  );
  const safeFallbackStops = fallbackStops.length
    ? fallbackStops
    : ranked.slice(0, Math.max(1, params.scenicCount)).map((item) => item.stop);
  if (!ranked.length) {
    return {
      stops: [] as PlannerStop[],
      mode: "heuristic" as const,
      reason: "当前没有可用的花点候选。",
    };
  }
  if (!process.env.OPENAI_API_KEY) {
    return {
      stops: safeFallbackStops,
      mode: "heuristic" as const,
      reason: "未配置大模型，按原词相关度和距离做本地兜底选择。",
    };
  }
  const shortlist = ranked.slice(0, Math.max(params.scenicCount * 4, 12));
  const prompt = [
    "你是校园春日路线 Agent 的花点选择器。",
    "请从候选列表中挑选 1 到 N 个最适合本次路线前半段的停靠点。",
    "只输出 JSON，不要输出解释。",
    '格式: {"chosenIndexes":[0,2,1],"reason":"..."}',
    `用户原始请求：${params.userQuery}`,
    `本次赏花/漫步需求：${params.scenicQuery}`,
    `期望选择数量上限：${params.scenicCount}`,
    `当前起点：${params.anchor.name || `${params.anchor.lat},${params.anchor.lng}`}`,
    `当前场景：${params.sceneName}`,
    "规则：1. 优先保留与用户原始赏花语义最匹配的点。2. 点位之间尽量可串联，不要刻意跳得太散。3. 午餐点不要选进赏花段。4. 如果用户强调拍照/休息/阴凉，要把这些偏好一起考虑进去。",
    "候选列表：",
    ...shortlist.map((item, index) => `${index}. ${item.stop.name} | 信息:${buildScenicCandidateSummary(item.stop) || "-"} | 距离起点:${Math.round(item.distanceMeters)}m`),
  ].join("\n");
  try {
    const response = await invokeModelWithTimeout(prompt, getPoiSelectorTimeoutMs(), "scenic selector");
    const rawResponse = getTextContent(response.content);
    const parsed = extractJsonObject(rawResponse);
    const chosenIndexes = Array.isArray(parsed?.chosenIndexes)
      ? parsed.chosenIndexes
          .map((item: unknown) => Number(item))
          .filter((index: number) => Number.isInteger(index) && index >= 0 && index < shortlist.length)
      : [];
    const chosenStops = Array.from(new Set(chosenIndexes as number[]))
      .slice(0, params.scenicCount)
      .map((index) => shortlist[index]!.stop);
    if (chosenStops.length) {
      return {
        stops: chosenStops,
        mode: "llm" as const,
        reason: String(parsed?.reason || "模型在花点候选中做了二次判别。"),
        rawResponse,
      };
    }
    return {
      stops: safeFallbackStops,
      mode: "llm" as const,
      reason: safeFallbackStops.length
        ? `模型未返回有效花点索引，已回退到本地候选 ${safeFallbackStops.map((item) => item.name).join("、")}。`
        : "模型未返回有效花点索引，且本地没有可用花点。",
      rawResponse,
      error: "invalid_scenic_selector_output",
    };
  } catch (error) {
    return {
      stops: safeFallbackStops,
      mode: "heuristic" as const,
      reason: safeFallbackStops.length
        ? `花点选择模型暂不可用，已回退到本地候选 ${safeFallbackStops.map((item) => item.name).join("、")}。`
        : "花点选择模型暂不可用，且本地没有可用花点。",
      error: error instanceof Error ? error.message : "scenic selector failed",
    };
  }
}

function rankPoiCandidates(
  candidates: SearchPoi[],
  anchor: { lat: number; lng: number },
  query: string,
  phase: PoiSelectionDebug["phase"],
  scene?: ReturnType<typeof getSceneProfile>,
) {
  const queryStem = stripGenericPlaceWords(query);
  const queryTokens = getMeaningfulPlaceTokens(query);
  return [...candidates]
    .map((item) => {
      const normalizedName = normalizePlaceName(item.name);
      const normalizedAddress = normalizePlaceName(item.address || "");
      const textScore = Math.max(scorePlaceNameMatch(query, item.name), scorePlaceNameMatch(query, item.address || ""));
      const distanceMeters = Number(item.searchDistanceMeters || getDistanceKm(anchor, item) * 1000);
      const stemScore = queryStem
        ? Math.max(
            normalizedName.includes(queryStem) ? 28 : 0,
            normalizedAddress.includes(queryStem) ? 12 : 0,
          )
        : 0;
      const tokenScore = queryTokens.reduce((score, token) => {
        const normalizedToken = normalizePlaceName(token);
        if (!normalizedToken) return score;
        if (normalizedName.includes(normalizedToken)) return score + 12;
        if (normalizedAddress.includes(normalizedToken)) return score + 6;
        return score;
      }, 0);
      const campusBonus = ((item.address || "").includes("清华") || /清华/.test(item.name)) ? 8 : 0;
      const exactNameBonus = normalizedName === normalizePlaceName(query) ? 36 : 0;
      let score = textScore;
      score += stemScore + tokenScore + campusBonus + exactNameBonus;
      score -= distanceMeters / (phase === "lunch" ? 42 : phase === "target" ? 68 : 58);
      return { ...item, heuristicScore: score, textScore } satisfies RankedPoiCandidate;
    })
    .filter((entry) => entry.textScore > 0)
    .sort((a, b) => b.heuristicScore - a.heuristicScore);
}

function pickBestLunchCandidate(candidates: SearchPoi[], anchor: { lat: number; lng: number }, scene: ReturnType<typeof getSceneProfile>, query = "食堂") {
  return rankPoiCandidates(candidates, anchor, query, "lunch", scene)[0] || null;
}

function pickBestTargetCandidate(candidates: SearchPoi[], anchor: { lat: number; lng: number }, query: string) {
  return rankPoiCandidates(candidates, anchor, query, "target")[0] || null;
}

function getPoiSelectorTimeoutMs() {
  const raw = Number(process.env.POI_SELECTOR_TIMEOUT_MS || 200000);
  if (!Number.isFinite(raw)) return 200000;
  return Math.max(30000, raw);
}

async function selectPoiCandidateWithLLM(params: {
  phase: PoiSelectionDebug["phase"];
  query: string;
  userQuery: string;
  anchor: AnchorPoint;
  candidates: SearchPoi[];
  sceneName: string;
  scene?: ReturnType<typeof getSceneProfile>;
}) {
  const ranked = rankPoiCandidates(params.candidates, params.anchor, params.query, params.phase, params.scene).slice(0, 6);
  const heuristicTop = ranked[0] || null;
  const debugBase: PoiSelectionDebug = {
    phase: params.phase,
    query: params.query,
    anchorName: params.anchor.name,
    mode: "heuristic",
    chosenName: heuristicTop?.name,
    chosenReason: heuristicTop ? "按原词匹配强度和距离做轻量排序。" : "本次未召回可用候选。",
    candidates: ranked.map((item) => ({
      name: item.name,
      address: item.address,
      distanceMeters: item.searchDistanceMeters,
    })),
  };
  if (!ranked.length) return { candidate: null, debug: debugBase };
  if (!process.env.OPENAI_API_KEY || ranked.length === 1) return { candidate: heuristicTop, debug: debugBase };
  const phaseLabel = params.phase === "lunch" ? "午餐补给" : params.phase === "start" ? "起点解析" : "目标点位";
  const prompt = [
    "你是校园地图 Agent 的 POI 候选裁决器。",
    "请在候选列表中选出最符合用户原意的一个，或者返回 -1。",
    "优先保留用户原词，不要把相近但不是同一个地点的 POI 当成答案。",
    "如果用户说的是明确地点名，优先看名字和地址里的词是否真的对得上，而不是自己改写成别的地点。",
    "只输出 JSON，不要输出解释。",
    '格式: {"chosenIndex":0,"reason":"", "confidence":"high"}',
    `用户原始请求：${params.userQuery}`,
    `当前裁决阶段：${phaseLabel}`,
    `当前要匹配的原始 POI 词：${params.query}`,
    `当前锚点：${params.anchor.name || `${params.anchor.lat},${params.anchor.lng}`}`,
    `当前场景：${params.sceneName}`,
    "规则：1. 优先选择与原词最接近的名字。2. 地址中的补充信息可以作为佐证。3. 如果没有明显合适的候选，chosenIndex 返回 -1。",
    "候选列表：",
    ...ranked.map((item, index) => `${index}. ${item.name} | 地址:${item.address || "-"} | 距离:${Math.round(Number(item.searchDistanceMeters || 0))}m`),
  ].join("\n");
  try {
    const response = await invokeModelWithTimeout(prompt, getPoiSelectorTimeoutMs(), "poi selector");
    const rawResponse = getTextContent(response.content);
    const parsed = extractJsonObject(rawResponse);
    const chosenIndex = Number(parsed?.chosenIndex);
    if (Number.isInteger(chosenIndex) && chosenIndex >= 0 && chosenIndex < ranked.length) {
      return {
        candidate: ranked[chosenIndex],
        debug: {
          ...debugBase,
          mode: "llm" as const,
          chosenName: ranked[chosenIndex].name,
          chosenReason: String(parsed?.reason || "模型在召回候选中做了二次语义判别。"),
          rawResponse,
        },
      };
    }
    if (chosenIndex === -1) {
      return {
        candidate: null,
        debug: {
          ...debugBase,
          mode: "llm" as const,
          chosenName: undefined,
          chosenReason: String(parsed?.reason || "模型判断当前候选里没有明显正确的 POI。"),
          rawResponse,
        },
      };
    }
    return {
      candidate: heuristicTop,
      debug: {
        ...debugBase,
        mode: "llm" as const,
        chosenName: heuristicTop?.name,
        chosenReason: heuristicTop
          ? `模型未返回有效候选索引，已回退到原词匹配最强的候选 ${heuristicTop.name}。`
          : "模型未返回有效候选索引，且当前没有可用候选。",
        rawResponse,
        error: "invalid_poi_selector_output",
      },
    };
  } catch (error) {
    return {
      candidate: heuristicTop,
      debug: {
        ...debugBase,
        chosenName: heuristicTop?.name,
        chosenReason: heuristicTop
          ? `POI 二次裁决暂不可用，已回退到原词匹配最强的候选 ${heuristicTop.name}。`
          : "POI 二次裁决暂不可用，且当前没有可用候选。",
        error: error instanceof Error ? error.message : "poi selector failed",
      },
    };
  }
}

async function resolveRouteStart(startPoint: DemoPlannerRequest["startPoint"], scene: ReturnType<typeof getSceneProfile>, pois: CuratedPoi[]) {
  if (Number.isFinite(startPoint?.lat) && Number.isFinite(startPoint?.lng)) {
    return {
      name: String(startPoint?.name || "自定义起点"),
      lat: Number(startPoint?.lat),
      lng: Number(startPoint?.lng),
      resolvedBy: "manual" as const,
      query: String(startPoint?.name || "").trim(),
    };
  }
  const query = String(startPoint?.name || "").trim();
  if (!query || normalizePlaceName(query) === normalizePlaceName(scene.center.name)) {
    return {
      ...scene.center,
      resolvedBy: "default" as const,
      query: "",
    };
  }
  const curated = findCuratedPoiMatch(query, pois);
  if (curated) {
    return {
      name: curated.name,
      lat: curated.lat,
      lng: curated.lng,
      resolvedBy: "curated" as const,
      query,
    };
  }
  try {
    const batches = await Promise.all(buildCampusSearchKeywords(query).map((keyword) => searchTextPoiCandidates(keyword, scene.center)));
    const resolved = pickBestTargetCandidate(batches.flat(), scene.center, query);
    if (resolved) {
      return {
        name: resolved.name,
        lat: resolved.lat,
        lng: resolved.lng,
        resolvedBy: "poi_search" as const,
        query,
      };
    }
  } catch {
    return {
      ...scene.center,
      name: query,
      resolvedBy: "fallback" as const,
      query,
    };
  }
  return {
    ...scene.center,
    name: query,
    resolvedBy: "fallback" as const,
    query,
  };
}

async function fetchReverseGeocoder(point: { lat: number; lng: number }) {
  if (getMapProvider() === "baidu") {
    const data = await baiduGet("/reverse_geocoding/v3", {
      location: `${point.lat},${point.lng}`,
      coordtype: "gcj02ll",
      extensions_poi: 0,
    });
    return data?.result?.formatted_address || data?.result?.sematic_description || "";
  }
  const data = await tencentGet("/ws/geocoder/v1/", {
    location: `${point.lat},${point.lng}`,
  });
  return data?.result?.address || data?.result?.formatted_addresses?.recommend || "";
}

async function fetchWalkingRoute(points: Array<{ lat: number; lng: number }>) {
  const segmentResults = [];
  let totalDistanceMeters = 0;
  let totalDurationMinutes = 0;
  const mergedPolyline: Array<{ lat: number; lng: number }> = [];
  for (let index = 0; index < points.length - 1; index += 1) {
    const from = points[index];
    const to = points[index + 1];
    let route: any;
    let polyline: Array<{ lat: number; lng: number }> = [from, to];
    if (getMapProvider() === "baidu") {
      const data = await baiduGet("/directionlite/v1/walking", {
        origin: `${from.lat},${from.lng}`,
        destination: `${to.lat},${to.lng}`,
        coord_type: "gcj02",
        ret_coordtype: "gcj02",
      });
      route = data?.result?.routes?.[0];
      if (!route) throw new Error("walking route result missing");
      const steps = Array.isArray(route.steps) ? route.steps : [];
      const stepPath = steps.flatMap((step: any) => decodeBaiduPath(step?.path));
      polyline = stepPath.length ? stepPath : [from, to];
      totalDistanceMeters += Number(route.distance || 0);
      totalDurationMinutes += Number(route.duration || 0) / 60;
    } else {
      const data = await tencentGet("/ws/direction/v1/walking/", {
        from: `${from.lat},${from.lng}`,
        to: `${to.lat},${to.lng}`,
      });
      route = data?.result?.routes?.[0];
      if (!route) throw new Error("walking route result missing");
      polyline = Array.isArray(route.polyline) ? decodeTencentPolyline(route.polyline) : [from, to];
      totalDistanceMeters += Number(route.distance || 0);
      totalDurationMinutes += Number(route.duration || 0);
    }
    mergedPolyline.push(...(index === 0 ? polyline : polyline.slice(1)));
    segmentResults.push({
      distanceMeters: Number(route.distance || 0),
      durationMinutes: getMapProvider() === "baidu" ? Number(route.duration || 0) / 60 : Number(route.duration || 0),
      polyline,
    });
  }
  return { totalDistanceMeters, totalDurationMinutes, segmentResults, mergedPolyline };
}

function buildSegmentLabel(stop: PlannerStop, index: number, total: number, intent: ParsedIntent) {
  if ((stop.tags || []).includes("lunch")) return "中途午餐补给";
  if (index === total - 1 && (intent.wantsRest || (stop.tags || []).includes("rest"))) return "收尾休息";
  if (index === 0 && intent.preferredSpecies.length) return `先去看${intent.preferredSpecies[0]}`;
  if (index === 0) return "先进入赏花段";
  return `继续前往${stop.name}`;
}

function buildStopReason(stop: PlannerStop, intent: ParsedIntent) {
  if ((stop.tags || []).includes("lunch")) return `${stop.name} 适合作为中途补给点，方便把午餐嵌进步行路线。`;
  if ((stop.tags || []).includes("rest")) return `${stop.name} 更适合作为后半程的休息与收尾位置。`;
  if (intent.preferredSpecies.length && stopMatchesSpecies(stop, intent.preferredSpecies)) return `${stop.name} 更贴近你想看的 ${intent.preferredSpecies.slice(0, 2).join(" / ")}。`;
  if ((stop.tags || []).includes("flower-sample")) return `${stop.name} 来自花卉地图样本点，能把更分散的花况坐标纳入路线决策。`;
  if (intent.wantsPhoto) return `${stop.name} 适合停留拍照，能兼顾花景与校园氛围。`;
  return `${stop.name} 能把路线节奏和校园春景串得更自然。`;
}

function formatDistance(distanceMeters: number) {
  return `约 ${(distanceMeters / 1000).toFixed(2)} km`;
}

function formatDuration(minutes: number) {
  return `约 ${Math.max(1, Math.round(minutes))} 分钟`;
}

function normalizePlannerStops(stops: PlannerStop[]) {
  return stops.map((stop, index) => ({
    ...stop,
    id: stop.id || `agent-stop-${index + 1}`,
    tags: [...(stop.tags || [])],
    stayMinutes: stop.stayMinutes || ((stop.tags || []).includes("lunch") ? 18 : 10),
    plants: (stop as { plants?: string }).plants || ((stop as { species?: string[] }).species || []).join("、"),
  }));
}

function buildNeeds(intent: ParsedIntent) {
  const needs = [];
  if (intent.startPointName) needs.push(`从 ${intent.startPointName} 出发`);
  if (intent.scenicQuery) needs.push(`前半程优先满足“${intent.scenicQuery}”`);
  else if (intent.preferredSpecies.length) needs.push(`优先想看 ${intent.preferredSpecies.slice(0, 2).join(" / ")}`);
  if (intent.preferredColor) needs.push(`花色偏好 ${intent.preferredColor === "pink" ? "粉色系" : intent.preferredColor === "white" ? "白色系" : "黄色系"}`);
  if (intent.wantsLunch) needs.push("路线里要顺路吃饭");
  if (intent.wantsRest) needs.push("后半程要更适合休息");
  if (intent.wantsPhoto) needs.push("兼顾拍照");
  if (intent.targetPoiName || intent.targetPoiQuery) needs.push(`希望最终到 ${intent.targetPoiName || intent.targetPoiQuery}`);
  needs.push(`总步行约 ${intent.durationMinutes} 分钟`);
  return needs;
}

function buildSuggestions(intent: ParsedIntent, stops: PlannerStop[]) {
  const suggestions = [];
  const lunchStop = stops.find((stop) => (stop.tags || []).includes("lunch"));
  if (lunchStop) suggestions.push(`饭点建议直接在 ${lunchStop.name} 补给，避免先绕远再折返。`);
  if (intent.scenicQuery || intent.preferredSpecies.length) suggestions.push(`如果还想继续补景点，可继续围绕“${intent.scenicQuery || intent.preferredSpecies[0]}”查看周边散点。`);
  const finale = stops[stops.length - 1];
  if (finale && finale !== lunchStop) suggestions.push(`若体力还够，可以从 ${finale.name} 再向周边延伸 5 到 10 分钟。`);
  return suggestions.slice(0, 3);
}

function resolveSearchAnchor(around: PlannedSearch["around"], scene: ReturnType<typeof getSceneProfile>, scenicStops: PlannerStop[], assembledStops: PlannerStop[]): AnchorPoint {
  if (around === "scene_center") return scene.center;
  if (around === "last_scenic_stop") return scenicStops[scenicStops.length - 1] || scene.center;
  return assembledStops[assembledStops.length - 1] || scenicStops[scenicStops.length - 1] || scene.center;
}

export async function planDemoRoute(input: DemoPlannerRequest): Promise<RoutePlanCard & { totalDistanceKm: number; totalDurationMin: number }> {
  const sceneId = input.sceneId || process.env.DEFAULT_SCENE_ID || "tsinghua-spring";
  const scene = getSceneProfile(sceneId);
  const pois = getScenePois(sceneId);
  const flowerHotspots = getSceneFlowerHotspots(sceneId);
  const semanticStops = uniqueStops([...pois, ...flowerHotspots]);
  const { intent, taskPlan, routerDebug } = await maybeRefineIntent({ ...input, sceneId }, scene, pois);

  const decisionTrace: string[] = [];
  const toolCalls: ToolCallTrace[] = [];
  const routeStart = await resolveRouteStart(input.startPoint, scene, pois);
  intent.startPointName = intent.startPointName || routeStart.query || routeStart.name;
  const resolutionDebug: NonNullable<RoutePlanCard["debug"]>["resolutions"] = {
    start: {
      query: routeStart.query || undefined,
      resolvedName: routeStart.name,
      resolvedBy: routeStart.resolvedBy,
    },
  };
  const poiSelections: PoiSelectionDebug[] = [];

  if (routeStart.resolvedBy === "manual") {
    decisionTrace.push(`按你指定的起点 ${routeStart.name} 出发，再去串联后续赏花和补给节点。`);
  } else if (routeStart.resolvedBy === "curated") {
    decisionTrace.push(`已把自定义起点命中到校园点位 ${routeStart.name}，路线会从那里开始。`);
  } else if (routeStart.resolvedBy === "poi_search") {
    toolCalls.push({ tool: "placeSearchText", purpose: "解析用户自定义的出发位置" });
    decisionTrace.push(`已通过地点搜索把起点解析到 ${routeStart.name}，后续路线会以它为起步点。`);
  } else if (routeStart.resolvedBy === "fallback" && routeStart.query) {
    decisionTrace.push(`暂未精确命中起点“${routeStart.query}”，先按校园中心区域起步，同时保留你的出发语义。`);
  }

  if (routerDebug.used) {
    toolCalls.push({ tool: "task_router", purpose: routerDebug.mode === "llm" ? "用模型拆解用户任务并决定工具调用顺序" : "模型路由未成功，已回退到本地规则任务路由" });
  }
  if (taskPlan.routerMode === "llm" && taskPlan.reasoning.length) {
    decisionTrace.push(taskPlan.reasoning[0]);
  } else if (routerDebug.error) {
    decisionTrace.push(`任务路由暂未拿到稳定的模型输出，当前先按规则链路继续规划。`);
  }
  toolCalls.push({ tool: "get_scene_profile", purpose: "读取校园春日场景语义、中心点和别名规则" });
  decisionTrace.push(`识别到${intent.planMode === "multi" ? "多阶段" : "单阶段"}需求，当前赏花段重点关注“${intent.scenicQuery || "校园春景"}”。`);

  const scenicLimit = Math.max(1, Math.min(4, Number(intent.scenicCount || getDefaultScenicCount(intent.durationMinutes))));
  const lunchPoi = [...pois]
    .filter((poi) => (poi.tags || []).includes("lunch"))
    .sort((a, b) => getDistanceKm(routeStart, a) - getDistanceKm(routeStart, b))[0] || null;
  const targetPoi = intent.targetPoiId ? pois.find((poi) => poi.id === intent.targetPoiId) || null : null;
  const scenicCandidatePool = semanticStops.filter((poi) => !((poi.tags || []).includes("lunch")) && poi.id !== intent.targetPoiId);
  const scenicSelection = await selectScenicStopsWithLLM({
    userQuery: intent.rawQuery,
    scenicQuery: intent.scenicQuery || buildDefaultScenicQuery(intent),
    scenicCount: scenicLimit,
    anchor: routeStart,
    candidates: scenicCandidatePool,
    sceneName: scene.sceneName,
    intent,
  });
  if (scenicSelection.mode === "llm") {
    toolCalls.push({ tool: "scenicCandidateJudge", purpose: "让模型在花点候选中选择前半程停靠点" });
  }
  const scenicStops = optimizeSequence(uniqueStops(scenicSelection.stops).slice(0, scenicLimit), routeStart);
  const assembledStops: PlannerStop[] = [...scenicStops];
  if (scenicStops.length) {
    decisionTrace.push(`已围绕“${intent.scenicQuery || "校园春景"}”选择前半程花点：${scenicStops.map((stop) => stop.name).join("、")}。${scenicSelection.reason ? ` ${scenicSelection.reason}` : ""}`);
  } else {
    decisionTrace.push(`当前没有稳定命中与“${intent.scenicQuery || "校园春景"}”高度相关的花点，后续会优先保障你明确提出的地点诉求。`);
  }

  const lunchSearchPlans = taskPlan.searches.filter((item) => item.purpose === "lunch");
  const explicitDiningTargetQuery = intent.lunchMode === "explicit" ? (intent.lunchQuery || "") : "";
  let resolvedLunchTarget: PlannerStop | null = null;
  if (!resolvedLunchTarget && targetPoi && intent.lunchMode === "explicit" && looksLikeDiningQuery(intent.targetPoiName)) {
    resolvedLunchTarget = {
      ...targetPoi,
      tags: [...(targetPoi.tags || []), "lunch", "supply", "target-poi"],
    };
    resolutionDebug.lunch = {
      query: intent.targetPoiName,
      resolvedName: resolvedLunchTarget.name,
      resolvedBy: "curated_explicit_target",
    };
    resolutionDebug.target = {
      query: intent.targetPoiName,
      resolvedName: resolvedLunchTarget.name,
      resolvedBy: "curated_explicit_target",
    };
    decisionTrace.push(`你明确指定了 ${intent.targetPoiName} 作为吃饭地点，因此直接把它当作午餐目标加入路线。`);
  }
  if (explicitDiningTargetQuery) {
    toolCalls.push({ tool: "placeSearchText", purpose: "解析用户明确指定的餐饮目的地" });
    try {
      const diningKeywords = buildCampusSearchKeywords(explicitDiningTargetQuery);
      const diningAnchor = scenicStops[scenicStops.length - 1] || routeStart;
      const diningCandidates = uniqueStops((await Promise.all(diningKeywords.map((keyword) => searchTextPoiCandidates(keyword, diningAnchor)))).flat()) as SearchPoi[];
      const diningSelection = await selectPoiCandidateWithLLM({
        phase: "target",
        query: explicitDiningTargetQuery,
        userQuery: intent.rawQuery,
        anchor: diningAnchor,
        candidates: diningCandidates,
        sceneName: scene.sceneName,
        scene,
      });
      poiSelections.push(diningSelection.debug);
      if (diningSelection.debug.mode === "llm") {
        toolCalls.push({ tool: "poiCandidateJudge", purpose: "让模型在召回的 POI 候选中做二次判别" });
      }
      const diningResult = diningSelection.candidate || pickBestTargetCandidate(diningCandidates, diningAnchor, explicitDiningTargetQuery);
      if (diningResult) {
        resolvedLunchTarget = {
          ...diningResult,
          tags: [...(diningResult.tags || []), "lunch", "supply", "target-poi"],
        };
        resolutionDebug.lunch = {
          query: explicitDiningTargetQuery,
          resolvedName: resolvedLunchTarget.name,
          resolvedBy: "explicit_target_search",
        };
        resolutionDebug.target = {
          query: explicitDiningTargetQuery,
          resolvedName: resolvedLunchTarget.name,
          resolvedBy: "explicit_target_search",
        };
        decisionTrace.push(`你明确提到了 ${explicitDiningTargetQuery}，因此优先按指定餐饮 POI 检索，并命中了 ${resolvedLunchTarget.name}${diningSelection.debug.chosenReason ? `。${diningSelection.debug.chosenReason}` : "。"} `);
      }
    } catch (error) {
      throw error;
    }
  }

  if (!resolvedLunchTarget && (intent.wantsLunch || lunchSearchPlans.length)) {
    let lunchStop: PlannerStop | null = null;
    toolCalls.push({ tool: "placeSearchText", purpose: "在赏花段附近搜索食堂或午餐补给点" });
    try {
      const plans = lunchSearchPlans.length
        ? lunchSearchPlans
        : [{
            purpose: "lunch",
            keywords: deriveSupplySearchKeywords(intent.rawQuery),
            around: "last_scenic_stop",
            radiusMeters: 1400,
            reason: "午餐补给",
          } satisfies PlannedSearch];
      let lunchAnchor: AnchorPoint = scenicStops[scenicStops.length - 1] || routeStart;
      const lunchCandidates = uniqueStops((await Promise.all(plans.map(async (plan) => {
        lunchAnchor = resolveSearchAnchor(plan.around, scene, scenicStops, assembledStops);
        const batches = await Promise.all(plan.keywords.map((keyword) => searchNearbyPoiCandidates(keyword, lunchAnchor, plan.radiusMeters)));
        return batches.flat().map((item) => ({ ...item, tags: [...(item.tags || []), "lunch", "supply"] }));
      }))).flat()) as SearchPoi[];
      const lunchDecisionQuery = intent.lunchQuery || explicitDiningTargetQuery || "食堂";
      const lunchSelection = await selectPoiCandidateWithLLM({
        phase: "lunch",
        query: lunchDecisionQuery,
        userQuery: intent.rawQuery,
        anchor: lunchAnchor,
        candidates: lunchCandidates,
        sceneName: scene.sceneName,
        scene,
      });
      poiSelections.push(lunchSelection.debug);
      if (lunchSelection.debug.mode === "llm") {
        toolCalls.push({ tool: "poiCandidateJudge", purpose: "让模型在召回的 POI 候选中做二次判别" });
      }
      lunchStop = lunchSelection.candidate || pickBestLunchCandidate(lunchCandidates, lunchAnchor, scene, lunchDecisionQuery);
      if (lunchStop) {
        resolutionDebug.lunch = {
          query: plans.flatMap((plan) => plan.keywords).join(" / "),
          resolvedName: lunchStop.name,
          resolvedBy: "nearby_search",
        };
        decisionTrace.push(`已在 ${lunchAnchor.name || "当前赏花段"} 附近搜索到 ${lunchStop.name}，将它作为中途午餐补给${lunchSelection.debug.chosenReason ? `。${lunchSelection.debug.chosenReason}` : "。"} `);
      }
    } catch (error) {
      throw error;
    }
    if (!lunchStop && explicitDiningTargetQuery) {
      throw new Error(`未在${getMapProviderLabel()}召回结果中找到与“${explicitDiningTargetQuery}”足够匹配的校园 POI`);
    }
    if (!lunchStop && lunchPoi) {
      const fallbackAnchor = scenicStops[scenicStops.length - 1] || routeStart;
      lunchStop = [...pois]
        .filter((poi) => (poi.tags || []).includes("lunch"))
        .sort((a, b) => getDistanceKm(fallbackAnchor, a) - getDistanceKm(fallbackAnchor, b))[0] || lunchPoi;
      resolutionDebug.lunch = {
        query: "校园内食堂",
        resolvedName: lunchStop.name,
        resolvedBy: "curated_fallback",
      };
      decisionTrace.push(`地点搜索未返回更合适结果，先回退到校园内已知的 ${lunchStop.name}。`);
    }
    if (lunchStop) assembledStops.push(lunchStop);
  } else if (resolvedLunchTarget) {
    assembledStops.push(resolvedLunchTarget);
  }

  let resolvedTargetPoi = resolvedLunchTarget ? null : targetPoi;
  const targetSearchPlans = taskPlan.searches.filter((item) => item.purpose === "target");
  const unresolvedDiningTarget = Boolean(explicitDiningTargetQuery && !resolvedLunchTarget);
  const targetQueryForResolution: string = resolvedLunchTarget
    ? ""
    : unresolvedDiningTarget
      ? (explicitDiningTargetQuery || "")
      : (intent.targetPoiQuery || intent.targetPoiName || "");
  if (!resolvedTargetPoi && (targetQueryForResolution || targetSearchPlans.length) && (!explicitDiningTargetQuery || unresolvedDiningTarget)) {
    toolCalls.push({ tool: "placeSearchText", purpose: "解析用户额外提到的目标点位" });
    try {
      const plans = targetSearchPlans.length
        ? targetSearchPlans
        : [{
            purpose: "target",
            keywords: buildCampusSearchKeywords(targetQueryForResolution),
            around: "last_stop",
            radiusMeters: 2600,
            reason: "解析目标点位",
          } satisfies PlannedSearch];
      let targetAnchor: AnchorPoint = assembledStops[assembledStops.length - 1] || scenicStops[scenicStops.length - 1] || routeStart;
      const targetCandidates = (await Promise.all(plans.map(async (plan) => {
        targetAnchor = resolveSearchAnchor(plan.around, scene, scenicStops, assembledStops);
        const expandedKeywords = Array.from(new Set(plan.keywords.flatMap((keyword) => buildCampusSearchKeywords(keyword))));
        const batches = await Promise.all(expandedKeywords.map((keyword) => searchTextPoiCandidates(keyword, targetAnchor)));
        return batches.flat();
      }))).flat();
      const targetSelection = await selectPoiCandidateWithLLM({
        phase: "target",
        query: targetQueryForResolution,
        userQuery: intent.rawQuery,
        anchor: targetAnchor,
        candidates: targetCandidates,
        sceneName: scene.sceneName,
        scene,
      });
      poiSelections.push(targetSelection.debug);
      if (targetSelection.debug.mode === "llm") {
        toolCalls.push({ tool: "poiCandidateJudge", purpose: "让模型在召回的 POI 候选中做二次判别" });
      }
      const targetResult = targetSelection.candidate || pickBestTargetCandidate(targetCandidates, targetAnchor, targetQueryForResolution);
      if (targetResult) {
        resolvedTargetPoi = {
          ...targetResult,
          tags: [...(targetResult.tags || []), "target-poi", ...(looksLikeDiningQuery(targetQueryForResolution) ? ["lunch", "supply"] : [])],
        };
        resolutionDebug.target = {
          query: targetQueryForResolution,
          resolvedName: resolvedTargetPoi.name,
          resolvedBy: "target_search",
        };
        if (looksLikeDiningQuery(targetQueryForResolution)) {
          resolutionDebug.lunch = {
            query: targetQueryForResolution,
            resolvedName: resolvedTargetPoi.name,
            resolvedBy: "target_search_fallback",
          };
        }
        decisionTrace.push(`根据你的自然语言额外解析出“${targetQueryForResolution}”，并通过地点搜索命中了 ${resolvedTargetPoi.name}${targetSelection.debug.chosenReason ? `。${targetSelection.debug.chosenReason}` : "。"} `);
      }
    } catch (error) {
      throw error;
    }
  }
  if (!resolvedTargetPoi && targetQueryForResolution) {
    throw new Error(`未在${getMapProviderLabel()}召回结果中找到与“${targetQueryForResolution}”足够匹配的校园 POI`);
  }

  if (resolvedTargetPoi) {
    const resolvedName = resolvedTargetPoi.name;
    assembledStops.push(resolvedTargetPoi);
    decisionTrace.push(`将 ${resolvedName} 固定为后半程重点停留点。`);
  } else if (targetPoi) {
    assembledStops.push(targetPoi);
    decisionTrace.push(`将 ${targetPoi.name} 固定为后半程重点停留点。`);
  } else if (intent.wantsRest) {
    const restAnchor = assembledStops[assembledStops.length - 1] || scenicStops[scenicStops.length - 1] || routeStart;
    const restPoi = pois
      .filter((poi) => (poi.tags || []).includes("rest"))
      .sort((a, b) => getDistanceKm(restAnchor, a) - getDistanceKm(restAnchor, b))[0];
    if (restPoi) {
      assembledStops.push(restPoi);
      decisionTrace.push(`为收尾节奏补入 ${restPoi.name}，满足休息诉求。`);
    }
  }

  const normalizedStops = normalizePlannerStops(uniqueStops(assembledStops));

  let startAddress = routeStart.name || scene.center.name;
  try {
    startAddress = (await fetchReverseGeocoder(routeStart)) || routeStart.name || scene.center.name;
    toolCalls.push({ tool: "reverseGeocoder", purpose: "确认当前路线的起点语义" });
  } catch {
    startAddress = routeStart.name || scene.center.name;
  }

  const routing = await fetchWalkingRoute([routeStart, ...normalizedStops]);
  toolCalls.push({ tool: "directionWalking", purpose: "为多段停留点生成真实步行路线" });
  decisionTrace.push(`已调用${getMapProviderLabel()}步行规划，把 ${normalizedStops.map((stop) => stop.name).join("、")} 串成真实可走路径。`);

  const segments = normalizedStops.map((stop, index) => {
    const routeInfo = routing.segmentResults[index];
    return {
      title: buildSegmentLabel(stop, index, normalizedStops.length, intent),
      objective: buildStopReason(stop, intent),
      travelMode: "walking" as const,
      durationText: formatDuration(routeInfo?.durationMinutes || (stop.stayMinutes || 10)),
      distanceText: formatDistance(routeInfo?.distanceMeters || 0),
      stops: [
        {
          id: stop.id,
          name: stop.name,
          reason: buildStopReason(stop, intent),
          lat: stop.lat,
          lng: stop.lng,
          tags: stop.tags || [],
          species: (stop as { species?: string[] }).species || [],
          plants: (stop as { plants?: string }).plants || "",
          stayMinutes: stop.stayMinutes,
          photoScore: stop.photoScore,
          bloomScore: stop.bloomScore,
          shadeScore: stop.shadeScore,
          restScore: stop.restScore,
        } satisfies RouteStop,
      ],
    };
  });

  const lunchStop = normalizedStops.find((stop) => (stop.tags || []).includes("lunch"));
  const summary = `从 ${startAddress || "清华大学中心区域"} 出发，先满足“${intent.scenicQuery || intent.preferredSpecies[0] || "校园春景"}”这段漫步需求，${lunchStop ? `中途在 ${lunchStop.name} 吃饭补给，` : ""}${normalizedStops[normalizedStops.length - 1] ? `最后在 ${normalizedStops[normalizedStops.length - 1].name} 收尾` : "完成一段校园漫游"}。`;

  return {
    type: "route_plan",
    sceneId,
    userIntent: intent.rawQuery,
    routeTitle: `AI 为你整理的${intent.scenicQuery || intent.preferredSpecies[0] || "校园春日"}路线`,
    summary,
    decisionTrace,
    toolCalls,
    insights: {
      needs: buildNeeds(intent),
      reasons: [...taskPlan.reasoning.slice(0, 2), ...normalizedStops.slice(0, 2).map((stop) => buildStopReason(stop, intent))].slice(0, 4),
      suggestions: buildSuggestions(intent, normalizedStops),
    },
    segments,
    mapOverlays: {
      markers: normalizedStops.map((stop) => ({ name: stop.name, lat: stop.lat, lng: stop.lng })),
      polylines: [
        {
          label: "recommended-walk",
          coordinates: routing.mergedPolyline,
        },
      ],
    },
    debug: {
      agent: {
        llmConfigured: Boolean(process.env.OPENAI_API_KEY),
        llmModel: process.env.OPENAI_MODEL || undefined,
        llmBaseUrl: process.env.OPENAI_BASE_URL || undefined,
        strategy: process.env.OPENAI_API_KEY ? "llm+tools" : "rules+tools",
        mapProvider: getMapProvider(),
        mapProviderLabel: getMapProviderLabel(),
      },
      taskRouter: {
        used: routerDebug.used,
        mode: taskPlan.routerMode,
        input: {
          query: intent.rawQuery,
          startPoint: intent.startPointName,
          sceneId,
        },
        output: {
          tasks: taskPlan.tasks,
          searches: taskPlan.searches,
          reasoning: taskPlan.reasoning,
        },
        rawResponse: routerDebug.rawResponse,
        error: routerDebug.error,
      },
      resolutions: resolutionDebug,
      poiSelections,
    },
    totalDistanceKm: Number((routing.totalDistanceMeters / 1000).toFixed(2)),
    totalDurationMin: Math.max(1, Math.round(routing.totalDurationMinutes)),
  };
}

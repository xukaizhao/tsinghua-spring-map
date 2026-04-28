import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

import { wgs84ToGcj02 } from "./coord.js";

export type FlowerHotspot = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  aliases?: string[];
  species?: string[];
  tags?: string[];
  photoScore?: number;
  shadeScore?: number;
  restScore?: number;
  bloomScore?: number;
  stayMinutes?: number;
  clusterSize?: number;
};

type FrontendFlowerSummary = {
  species?: string;
  count?: number;
  samples?: Array<{ lat?: number; lng?: number }>;
};

type FrontendDataset = {
  databases?: {
    flowerSummary?: FrontendFlowerSummary[];
  };
};

let cachedHotspots: FlowerHotspot[] | null = null;

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

function getFlowerTags(species: string) {
  if (species === "紫叶李") return ["flower", "purple", "flower-sample"];
  if (species === "玉兰" || species === "白玉兰") return ["flower", "white", "flower-sample"];
  if (species === "连翘") return ["flower", "yellow", "flower-sample"];
  return ["flower", "pink", "flower-sample"];
}

function readFrontendDataset(): FrontendDataset {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const datasetPath = path.resolve(currentDir, "../../src/data/demo-data.js");
  const source = fs.readFileSync(datasetPath, "utf8");
  const sandbox = { window: {} as { SEASONAL_DEMO_DATA?: FrontendDataset } };
  vm.runInNewContext(source, sandbox, { filename: datasetPath });
  return sandbox.window.SEASONAL_DEMO_DATA || {};
}

function buildHotspotName(species: string, index: number) {
  const suffix = ["A", "B", "C"][index] || `${index + 1}`;
  return `${species} 观赏点 ${suffix}`;
}

function buildHotspotSummary(summary: FrontendFlowerSummary, index: number) {
  const species = normalizeSpecies(summary.species);
  if (!species) return [];
  return (summary.samples || [])
    .map((sample, sampleIndex) => {
      const lat = Number(sample?.lat);
      const lng = Number(sample?.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
      const coord = wgs84ToGcj02(lat, lng);
      const count = Math.max(1, Number(summary.count) || 1);
      return {
        id: `flower-hotspot-${index + 1}-${sampleIndex + 1}-${species}`,
        name: buildHotspotName(species, sampleIndex),
        lat: coord.lat,
        lng: coord.lng,
        aliases: [`${species} 花点`, `${species} 样本点`, `${species} 观赏点`],
        species: [species],
        tags: getFlowerTags(species),
        photoScore: 80 + Math.min(count, 12),
        shadeScore: 58,
        restScore: 54,
        bloomScore: 82 + Math.min(Math.floor(count / 2), 8),
        stayMinutes: 6,
        clusterSize: count,
      } satisfies FlowerHotspot;
    })
    .filter(Boolean) as FlowerHotspot[];
}

export function getSceneFlowerHotspots(sceneId?: string) {
  if ((sceneId || "tsinghua-spring") !== "tsinghua-spring") return [];
  if (cachedHotspots) return cachedHotspots;
  const dataset = readFrontendDataset();
  cachedHotspots = (dataset.databases?.flowerSummary || []).flatMap(buildHotspotSummary);
  return cachedHotspots;
}

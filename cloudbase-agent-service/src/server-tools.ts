import { tool } from "@langchain/core/tools";
import { z } from "zod";

import { getSceneFlowerHotspots } from "./scene-flower-hotspots.js";
import { getScenePois } from "./scene-pois.js";
import { getSceneProfile } from "./scene-profile.js";

export function createServerTools() {
  const getSceneProfileTool = tool(
    async ({ sceneId }) => {
      const profile = getSceneProfile(sceneId);
      return JSON.stringify(profile, null, 2);
    },
    {
      name: "get_scene_profile",
      description:
        "获取当前地图场景的业务语义、中心点、POI 别名、花色偏好和推荐 MCP 工具列表。使用它来理解“午饭”“情人坡”“粉色的花”这类场景词。",
      schema: z.object({
        sceneId: z.string().default("tsinghua-spring").describe("当前地图场景 ID"),
      }),
    }
  );

  const getScenePoisTool = tool(
    async ({ sceneId }) => {
      const pois = getScenePois(sceneId);
      return JSON.stringify(pois, null, 2);
    },
    {
      name: "get_scene_pois",
      description:
        "获取当前校园场景里已经整理好的核心点位，包括食堂、休息点、春季打卡点和别名。适合在路线规划前先建立候选集合。",
      schema: z.object({
        sceneId: z.string().default("tsinghua-spring").describe("当前地图场景 ID"),
      }),
    }
  );

  const getSceneFlowerHotspotsTool = tool(
    async ({ sceneId }) => {
      const hotspots = getSceneFlowerHotspots(sceneId);
      return JSON.stringify(hotspots, null, 2);
    },
    {
      name: "get_scene_flower_hotspots",
      description:
        "获取花卉地图聚合出来的观赏热点样本点，适合在用户指定花种或花色时做花点筛选，而不是只看少量核心打卡点。",
      schema: z.object({
        sceneId: z.string().default("tsinghua-spring").describe("当前地图场景 ID"),
      }),
    }
  );

  return [getSceneProfileTool, getScenePoisTool, getSceneFlowerHotspotsTool];
}

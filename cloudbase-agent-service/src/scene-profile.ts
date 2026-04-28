import { wgs84ToGcj02 } from "./coord.js";

const sceneCenter = wgs84ToGcj02(40.0032, 116.3269);

const SCENES = {
  "tsinghua-spring": {
    sceneId: "tsinghua-spring",
    sceneName: "清华大学春日赏花地图",
    center: {
      name: "清华大学中心区域",
      lat: sceneCenter.lat,
      lng: sceneCenter.lng,
    },
    poiAliases: {
      情人坡: ["情人坡", "休息草坡", "适合休息的地方"],
      万人食堂: ["万人食堂", "食堂", "午饭", "午餐", "吃饭"],
      新清华学堂东侧小路: ["新清华学堂东侧小路", "拍照小路", "花路"],
    },
    preferredSpeciesByColor: {
      pink: ["樱花", "垂丝海棠", "山桃", "桃花", "玉兰"],
      white: ["玉兰", "梨花"],
      yellow: ["连翘"],
    },
    routePolicy: {
      maxRecommendedStops: 5,
      lunchBiasTags: ["食堂", "咖啡", "补给"],
      restBiasTags: ["草坡", "长椅", "安静", "树荫"],
      lunchPreferredNames: ["桃李园", "紫荆园", "清芬园", "听涛园", "丁香园", "观畴园", "芝兰园", "万人食堂"],
    },
    recommendedMcpTools: [
      "placeSuggestion",
      "placeSearchText",
      "placeSearchNearby",
      "directionWalking",
      "waypointOrder",
      "reverseGeocoder",
      "weather",
    ],
  },
} as const;

export type SceneId = keyof typeof SCENES;

export function getSceneProfile(sceneId?: string) {
  const key = (sceneId || "tsinghua-spring") as SceneId;
  return SCENES[key] || SCENES["tsinghua-spring"];
}

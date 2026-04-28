import { wgs84ToGcj02 } from "./coord.js";

export type CuratedPoi = {
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
};

function toGcjPoi(poi: CuratedPoi): CuratedPoi {
  const coord = wgs84ToGcj02(poi.lat, poi.lng);
  return {
    ...poi,
    lat: coord.lat,
    lng: coord.lng,
  };
}

const RAW_TSINGHUA_SPRING_POIS: CuratedPoi[] = [
  {
    id: "core-1",
    name: "学生公寓32号楼",
    lat: 40.007079676084814,
    lng: 116.32210558016186,
    species: ["玉兰", "紫叶李"],
    tags: ["flower", "pink"],
    photoScore: 94,
    shadeScore: 58,
    restScore: 52,
    bloomScore: 82,
    stayMinutes: 8,
  },
  {
    id: "core-2",
    name: "蒙民伟人文楼",
    lat: 40.00284898505231,
    lng: 116.32185888741553,
    species: ["紫玉兰"],
    tags: ["flower", "pink", "landmark"],
    photoScore: 86,
    shadeScore: 65,
    restScore: 60,
    bloomScore: 82,
    stayMinutes: 10,
  },
  {
    id: "core-3",
    name: "新清华学堂东侧小路",
    lat: 40.00012083765635,
    lng: 116.32405034131212,
    aliases: ["花路", "拍照小路"],
    species: ["山桃", "迎春"],
    tags: ["flower", "pink", "photo"],
    photoScore: 94,
    shadeScore: 72,
    restScore: 68,
    bloomScore: 82,
    stayMinutes: 12,
  },
  {
    id: "core-4",
    name: "情人坡",
    lat: 40.00447137582617,
    lng: 116.31960767905376,
    aliases: ["休息草坡", "适合休息的地方"],
    species: ["山桃", "玉兰"],
    tags: ["flower", "pink", "rest", "quiet"],
    photoScore: 86,
    shadeScore: 79,
    restScore: 76,
    bloomScore: 82,
    stayMinutes: 8,
  },
  {
    id: "core-5",
    name: "逸夫馆",
    lat: 40.00375112054714,
    lng: 116.31814848597715,
    species: ["山桃"],
    tags: ["flower", "pink", "photo", "shade"],
    photoScore: 94,
    shadeScore: 86,
    restScore: 52,
    bloomScore: 82,
    stayMinutes: 10,
  },
  {
    id: "core-6",
    name: "伟清楼",
    lat: 40.001286607504696,
    lng: 116.32958064447885,
    species: ["望春玉兰"],
    tags: ["flower", "white"],
    photoScore: 86,
    shadeScore: 58,
    restScore: 60,
    bloomScore: 82,
    stayMinutes: 12,
  },
  {
    id: "core-7",
    name: "职业发展中心西侧",
    lat: 40.0041757495788,
    lng: 116.3216777052987,
    species: ["梨花"],
    tags: ["flower", "white"],
    photoScore: 86,
    shadeScore: 65,
    restScore: 68,
    bloomScore: 82,
    stayMinutes: 8,
  },
  {
    id: "core-8",
    name: "万人食堂",
    lat: 40.005189473525014,
    lng: 116.31617810167387,
    aliases: ["食堂", "午饭", "午餐", "吃饭"],
    species: ["紫叶李"],
    tags: ["flower", "lunch", "supply"],
    photoScore: 86,
    shadeScore: 72,
    restScore: 76,
    bloomScore: 82,
    stayMinutes: 18,
  },
  {
    id: "core-9",
    name: "郑裕彤医学楼",
    lat: 40.00230118062608,
    lng: 116.31186700888023,
    species: ["二乔玉兰", "白玉兰"],
    tags: ["flower", "white"],
    photoScore: 94,
    shadeScore: 79,
    restScore: 52,
    bloomScore: 82,
    stayMinutes: 12,
  },
  {
    id: "core-10",
    name: "罗姆楼",
    lat: 40.00453184467371,
    lng: 116.33035690432085,
    species: ["早樱"],
    tags: ["flower", "pink", "shade"],
    photoScore: 86,
    shadeScore: 86,
    restScore: 60,
    bloomScore: 82,
    stayMinutes: 8,
  },
  {
    id: "core-11",
    name: "工字厅",
    lat: 40.00105206651334,
    lng: 116.31678406189899,
    species: ["早樱"],
    tags: ["flower", "pink", "landmark"],
    photoScore: 92,
    shadeScore: 68,
    restScore: 56,
    bloomScore: 84,
    stayMinutes: 10,
  },
];

const TSINGHUA_SPRING_POIS: CuratedPoi[] = RAW_TSINGHUA_SPRING_POIS.map(toGcjPoi);

export function getScenePois(sceneId?: string) {
  if ((sceneId || "tsinghua-spring") === "tsinghua-spring") return TSINGHUA_SPRING_POIS;
  return TSINGHUA_SPRING_POIS;
}

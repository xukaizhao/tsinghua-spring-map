const KEY = process.env.TMAP_WEBSERVICE_KEY;

const CENTER = {
  lat: 40.003798,
  lng: 116.324468,
};

const KEYWORDS = ["清华大学紫荆园食堂", "紫荆园食堂", "紫荆园"];
const MAX_DISTANCE = 2000;
const MATCH_WORD = "紫荆园";

async function search(keyword) {
  const url = new URL("https://apis.map.qq.com/ws/place/v1/search");
  url.searchParams.set("keyword", keyword);
  url.searchParams.set(
    "boundary",
    `nearby(${CENTER.lat},${CENTER.lng},1500,1)`
  );
  url.searchParams.set("page_size", "10");
  url.searchParams.set("orderby", "_distance");
  url.searchParams.set("key", KEY);

  const response = await fetch(url);
  const data = await response.json();

  if (data.status !== 0) {
    throw new Error(data.message || `腾讯地图接口错误: ${data.status}`);
  }

  return data.data || [];
}

async function main() {
  if (!KEY) {
    throw new Error("TMAP_WEBSERVICE_KEY is required");
  }

  const seen = new Set();
  const results = [];

  for (const keyword of KEYWORDS) {
    const pois = await search(keyword);

    for (const poi of pois) {
      const distance = Number(poi._distance ?? Infinity);
      const text = `${poi.title || ""} ${poi.address || ""}`;
      const isFoodRelated =
        (poi.category || "").startsWith("美食") || /(食堂|餐厅)/.test(text);

      if (distance > MAX_DISTANCE) continue;
      if (!text.includes(MATCH_WORD)) continue;
      if (!isFoodRelated) continue;
      if (seen.has(poi.id)) continue;

      seen.add(poi.id);
      results.push({
        keyword,
        title: poi.title,
        address: poi.address,
        lat: poi.location?.lat,
        lng: poi.location?.lng,
        distance,
        category: poi.category || "",
      });
    }
  }

  results.sort((a, b) => a.distance - b.distance);
  console.log(JSON.stringify(results, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

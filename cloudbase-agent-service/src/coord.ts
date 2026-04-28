export type LatLng = {
  lat: number;
  lng: number;
};

function outOfChina(lat: number, lng: number) {
  return lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271;
}

function transformLat(lng: number, lat: number) {
  let ret = -100 + 2 * lng + 3 * lat + 0.2 * lat * lat + 0.1 * lng * lat + 0.2 * Math.sqrt(Math.abs(lng));
  ret += ((20 * Math.sin(6 * lng * Math.PI)) + (20 * Math.sin(2 * lng * Math.PI))) * 2 / 3;
  ret += ((20 * Math.sin(lat * Math.PI)) + (40 * Math.sin(lat / 3 * Math.PI))) * 2 / 3;
  ret += ((160 * Math.sin(lat / 12 * Math.PI)) + (320 * Math.sin(lat * Math.PI / 30))) * 2 / 3;
  return ret;
}

function transformLng(lng: number, lat: number) {
  let ret = 300 + lng + 2 * lat + 0.1 * lng * lng + 0.1 * lng * lat + 0.1 * Math.sqrt(Math.abs(lng));
  ret += ((20 * Math.sin(6 * lng * Math.PI)) + (20 * Math.sin(2 * lng * Math.PI))) * 2 / 3;
  ret += ((20 * Math.sin(lng * Math.PI)) + (40 * Math.sin(lng / 3 * Math.PI))) * 2 / 3;
  ret += ((150 * Math.sin(lng / 12 * Math.PI)) + (300 * Math.sin(lng / 30 * Math.PI))) * 2 / 3;
  return ret;
}

export function wgs84ToGcj02(lat: number, lng: number): LatLng {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || outOfChina(lat, lng)) return { lat, lng };
  const a = 6378245;
  const ee = 0.00669342162296594323;
  const dLat = transformLat(lng - 105, lat - 35);
  const dLng = transformLng(lng - 105, lat - 35);
  const radLat = lat / 180 * Math.PI;
  let magic = Math.sin(radLat);
  magic = 1 - ee * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  return {
    lat: lat + (dLat * 180) / (((a * (1 - ee)) / (magic * sqrtMagic)) * Math.PI),
    lng: lng + (dLng * 180) / ((a / sqrtMagic) * Math.cos(radLat) * Math.PI),
  };
}

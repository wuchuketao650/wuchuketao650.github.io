// 高德 Web 服务 Key（用于 REST 地理编码）
// 使用你新申请的 gps_search Key
const WEB_SERVICE_KEY = '9d26768ceb90a8f27d4bff6274159f60';

const cache = new Map();

// 逆地理编码：坐标 -> 地址
export async function reverseGeocode(lat, lng) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }
  const cacheKey = `regeo:${lat.toFixed(5)},${lng.toFixed(5)}`;
  if (cache.has(cacheKey)) {
    return cache.get(cacheKey);
  }
  try {
    const url = `https://restapi.amap.com/v3/geocode/regeo?key=${WEB_SERVICE_KEY}&location=${lng},${lat}&extensions=base&batch=false&radius=200`;
    const resp = await fetch(url);
    const data = await resp.json();
    console.log('[LocationService] reverseGeocode REST 返回:', data);
    let result = null;
    if (data.status === '1' && data.regeocode) {
      result = data.regeocode.formatted_address || null;
    }
    cache.set(cacheKey, result);
    return result;
  } catch (error) {
    console.warn('reverseGeocode REST error:', error);
    return null;
  }
}

// 正地理编码：地址 -> 坐标
export async function geocodeAddress(address) {
  if (!address) return null;
  const normalized = address.trim();
  if (!normalized) return null;

  const cacheKey = `geo:${normalized}`;
  if (cache.has(cacheKey)) {
    return cache.get(cacheKey);
  }

  try {
    const url = `https://restapi.amap.com/v3/geocode/geo?key=${WEB_SERVICE_KEY}&address=${encodeURIComponent(normalized)}`;
    const resp = await fetch(url);
    const data = await resp.json();
    console.log('[LocationService] geocode REST 返回:', data);

    let result = null;
    if (data.status === '1' && data.geocodes && data.geocodes.length) {
      const first = data.geocodes[0];
      if (first.location) {
        const [lngStr, latStr] = String(first.location).split(',');
        const lng = Number(lngStr);
        const lat = Number(latStr);
        if (Number.isFinite(lat) && Number.isFinite(lng)) {
          result = {
            lat,
            lng,
            address: first.formatted_address || normalized
          };
        }
      }
    }

    cache.set(cacheKey, result);
    return result;
  } catch (error) {
    console.warn('geocodeAddress REST error:', error);
    return null;
  }
}

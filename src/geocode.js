/**
 * Forward geocode a structured address using OpenStreetMap Nominatim (no API key).
 * Respect usage policy: https://operations.osmfoundation.org/policies/nominatim/
 * For production, use a dedicated geocoder or server-side proxy.
 */

/**
 * @param {{
 *   line1?: string;
 *   city?: string;
 *   region?: string;
 *   postal_code?: string;
 *   country?: string;
 * }} parts
 * @returns {Promise<{ lat: number; lng: number; display_name?: string } | null>}
 */
export async function geocodeAddress(parts) {
  const q = [parts.line1, parts.city, parts.region, parts.postal_code, parts.country]
    .filter(Boolean)
    .join(', ')
    .trim();
  if (!q) {
    return null;
  }

  const url =
    'https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' +
    encodeURIComponent(q);

  const res = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'Accept-Language': 'en',
    },
  });

  if (!res.ok) {
    return null;
  }

  /** @type {{ lat: string; lon: string; display_name?: string }[]} */
  const data = await res.json();
  const first = data[0];
  if (!first) {
    return null;
  }

  const lat = Number(first.lat);
  const lng = Number(first.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }

  return { lat, lng, display_name: first.display_name };
}

// Punkt-in-Polygon (Ray-Casting) fuer GeoJSON Polygon/MultiPolygon inkl. Loechern.
// Ersetzt shapely aus der Python-Version.

type Ring = number[][];
type Geo = { type: string; coordinates?: unknown; geometry?: Geo; features?: { geometry: Geo }[] };

function inRing(lng: number, lat: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function inPolygon(lng: number, lat: number, rings: Ring[]): boolean {
  if (!rings.length || !inRing(lng, lat, rings[0])) return false;
  for (let k = 1; k < rings.length; k++) if (inRing(lng, lat, rings[k])) return false;
  return true;
}

export function containsPoint(geom: Geo | null | undefined, lng: number, lat: number): boolean {
  if (!geom) return false;
  switch (geom.type) {
    case 'Polygon':
      return inPolygon(lng, lat, geom.coordinates as Ring[]);
    case 'MultiPolygon':
      return (geom.coordinates as Ring[][]).some((p) => inPolygon(lng, lat, p));
    case 'Feature':
      return containsPoint(geom.geometry, lng, lat);
    case 'FeatureCollection':
      return (geom.features ?? []).some((f) => containsPoint(f.geometry, lng, lat));
    default:
      return false;
  }
}

export function isAreaGeometry(geom: unknown): boolean {
  const t = (geom as { type?: string } | null)?.type;
  return t === 'Polygon' || t === 'MultiPolygon' || t === 'Feature' || t === 'FeatureCollection';
}

export function parseGeometry(text: string | null): Geo | null {
  if (!text) return null;
  try {
    return JSON.parse(text) as Geo;
  } catch {
    return null;
  }
}

/** Sucht die Gemeindegrenze bei OpenStreetMap (Nominatim). */
export async function fetchBoundary(name: string, country: string): Promise<string | null> {
  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('q', name);
  url.searchParams.set('countrycodes', country);
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('polygon_geojson', '1');
  url.searchParams.set('polygon_threshold', '0.0001');
  url.searchParams.set('limit', '5');
  let results: { category?: string; type?: string; geojson?: unknown }[];
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'FibreForge/1.0 (Cloudflare Worker)' } });
    if (!res.ok) return null;
    results = await res.json();
  } catch (e) {
    console.error('Nominatim-Abfrage fehlgeschlagen', e);
    return null;
  }
  const withArea = results.filter((r) => isAreaGeometry(r.geojson));
  const best = withArea.find((r) => r.category === 'boundary' && r.type === 'administrative') ?? withArea[0];
  return best ? JSON.stringify(best.geojson) : null;
}

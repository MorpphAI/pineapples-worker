/**
 * Read-only source projection for the PineOS listing distance audit.
 * Never estimates a distance or changes Avantio. Unknown provider fields are
 * left in the original detail for later, explicitly versioned mapping.
 */
export type DistanceAuditSource = {
  coordinates: { latitude: number; longitude: number } | null;
  provider_distances: Record<string, unknown> | null;
  provider_path: "surroundingsAndDistances";
};

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function numericCoordinate(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function extractDistanceAuditSource(detail: unknown): DistanceAuditSource {
  const root = object(detail);
  const location = object(root?.location);
  const coordinates = object(location?.coordinates);
  const latitude = numericCoordinate(coordinates?.lat);
  const longitude = numericCoordinate(coordinates?.lon);
  const valid = latitude !== null && latitude >= -90 && latitude <= 90
    && longitude !== null && longitude >= -180 && longitude <= 180;
  return {
    coordinates: valid ? { latitude, longitude } : null,
    // Only the explicit surroundings container: never expose the owner,
    // banking, access or other sections to the audit contract.
    provider_distances: object(root?.surroundingsAndDistances),
    provider_path: "surroundingsAndDistances",
  };
}

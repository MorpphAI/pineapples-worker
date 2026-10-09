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

export function extractDistanceAuditSource(detail: unknown): DistanceAuditSource {
  const root = object(detail);
  const location = object(root?.location);
  const coordinates = object(location?.coordinates);
  const latitude = coordinates?.lat;
  const longitude = coordinates?.lon;
  const valid = typeof latitude === "number" && Number.isFinite(latitude)
    && latitude >= -90 && latitude <= 90 && typeof longitude === "number"
    && Number.isFinite(longitude) && longitude >= -180 && longitude <= 180;
  return {
    coordinates: valid ? { latitude, longitude } : null,
    // Only the explicit surroundings container: never expose the owner,
    // banking, access or other sections to the audit contract.
    provider_distances: object(root?.surroundingsAndDistances),
    provider_path: "surroundingsAndDistances",
  };
}

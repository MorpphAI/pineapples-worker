export const canonicalProperty = {
  identification: { code: "PINE-1", title: "Apartamento", property_type: "apartment", tier: 1 },
  address: { postal_code: "20000-000", street: "Rua A", number: "1", unit: null, floor: null, neighborhood: null, city: "Rio", state: "RJ", country: "BR", coordinates: null },
  capacity: { max_adults: 2, max_children: null, area_sqm: 50, bedroom_count: 1, suite_count: 0, bathroom_count: 1, toilet_count: 0, rooms: ["bedroom"], beds: [{ position: 1, bed_type: "queen", quantity: 1, is_suite: false, raw_label: null }], sofa_bed: { available: null, bed_type: null, raw_label: null } },
  kitchen: { available: true, cooktop_type: null, frost_free_fridge: false, appliances: [], utensils: [] },
  amenities: { bedroom: [], living_room: [], bathroom: [], general: [] },
  services: {
    air_conditioning: { available: null, areas: null }, wifi: { available: null, speed: null }, pets: { allowed: null, notes: null }, parking: { available: null, notes: null },
    reception: { available: false, notes: null, guest_registration: null }, self_check_in: null, elevator: null, keyholder: { available: false }, lock_type: null,
    water_heating: null, waste_disposal: null, existing_reservations: { present: false, notes: null },
  },
  operational_notes: null,
  source: { origin: "form", captured_at: null, schema_version: 1 },
  warnings: [], legacy_metadata: {},
} as const;

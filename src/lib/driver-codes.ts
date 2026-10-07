/**
 * Public driver codes for URLs and other presentation-facing identifiers.
 *
 * The API's driver_code is an upstream identifier and is not URL-safe as a
 * public contract (for example, HA6, RU1, VE2, and PI4). Resolve by the stable
 * API driver_id, then emit the canonical three-letter code from this table.
 */

interface DriverIdentity {
  driverId: number;
  canonicalCode: string;
  aliases: string[];
}

const DRIVER_IDENTITIES: DriverIdentity[] = [
  { driverId: 539, canonicalCode: "ANT", aliases: ["ANT"] },
  { driverId: 561, canonicalCode: "HAM", aliases: ["HA6"] },
  { driverId: 147, canonicalCode: "LEC", aliases: ["LEC"] },
  { driverId: 320, canonicalCode: "RUS", aliases: ["RU1"] },
  { driverId: 617, canonicalCode: "VER", aliases: ["VE2"] },
  { driverId: 549, canonicalCode: "NOR", aliases: ["NOR"] },
  { driverId: 680, canonicalCode: "PIA", aliases: ["PI4"] },
  { driverId: 401, canonicalCode: "HAD", aliases: ["HAD"] },
  { driverId: 562, canonicalCode: "LAW", aliases: ["LA4"] },
  { driverId: 742, canonicalCode: "GAS", aliases: ["GAS"] },
  { driverId: 304, canonicalCode: "BOR", aliases: ["BOR"] },
  { driverId: 33, canonicalCode: "ALB", aliases: ["ALB"] },
  { driverId: 659, canonicalCode: "HUL", aliases: ["HU1"] },
  { driverId: 548, canonicalCode: "STR", aliases: ["STR"] },
  { driverId: 825, canonicalCode: "PER", aliases: ["PE5"] },
  { driverId: 270, canonicalCode: "OCO", aliases: ["OCO"] },
  { driverId: 70, canonicalCode: "LIN", aliases: ["LI1"] },
  { driverId: 283, canonicalCode: "ALO", aliases: ["ALO"] },
  { driverId: 671, canonicalCode: "BEA", aliases: ["BE7"] },
  { driverId: 286, canonicalCode: "COL", aliases: ["CO2"] },
  { driverId: 885, canonicalCode: "BOT", aliases: ["BO9"] },
  { driverId: 141, canonicalCode: "SAI", aliases: ["SA1"] },
];

const byDriverId = new Map(
  DRIVER_IDENTITIES.map((identity) => [identity.driverId, identity.canonicalCode]),
);

const driverIdByCode = new Map(
  DRIVER_IDENTITIES.flatMap((identity) =>
    [identity.canonicalCode, ...identity.aliases].map((code) => [code, identity.driverId] as const),
  ),
);

export function getCanonicalDriverCode(driverId: number): string | null {
  return byDriverId.get(driverId) ?? null;
}

export function getDriverIdForPublicCode(code: string): number | null {
  return driverIdByCode.get(code.toUpperCase()) ?? null;
}

/**
 * Safe presentation fallback for a newly introduced API driver_id.
 * The name is the stable information we have until the ID table is updated;
 * never make an otherwise valid prediction disappear from the Grid.
 */
export function deriveCanonicalDriverCode(fullName: string): string {
  const nameParts = fullName.trim().split(/\s+/);
  const lastName = (nameParts.at(-1) ?? "DRIVER").replace(/[^A-Za-z]/g, "");
  return lastName.slice(0, 3).toUpperCase() || "DRIVER";
}

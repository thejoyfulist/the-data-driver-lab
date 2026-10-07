export declare function normaliseText(value: unknown): string;
export declare function matchDrivers<T extends Record<string, unknown>>(query: string, standings: T[] | unknown, limit?: number): T[];
export declare function matchRaces<T extends Record<string, unknown>>(query: string, calendar: T[] | unknown, limit?: number): T[];

/** Shared scheduling and settings bounds; reminder timing stays within 30–60 minutes. */
export const WAKE_POLICIES = {
  write: { interval: 2, minHours: 2, maxHours: 24, maxDelay: 24, dayLimit: 3, minLimit: 1, maxLimit: 24 },
  catch: { interval: 2, minHours: 2, maxHours: 24, maxDelay: 24, dayLimit: 3, minLimit: 1, maxLimit: 24 },
  remind: { interval: 0.5, minHours: 0.5, maxHours: 1, maxDelay: 1, dayLimit: 12, minLimit: 3, maxLimit: 20 },
} as const;

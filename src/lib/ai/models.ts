export const MODELS = {
  paid: "google/gemini-2.5-flash",
  free: "google/gemini-2.0-flash-lite:free",
} as const;

export type ModelTier = keyof typeof MODELS;

import { z } from "zod";

export const REVIEW_SCHEMA = z.object({
  correctness: z.number().describe("Poprawność i brak błędów logicznych (1–10)."),
  securitySafety: z.number().describe("Bezpieczeństwo: walidacja wejścia, brak podatności i wycieku sekretów (1–10)."),
  readability: z.number().describe("Czytelność, nazewnictwo i spójność ze stylem projektu (1–10)."),
  performance: z.number().describe("Wydajność i brak oczywistych nieefektywności (1–10)."),
  testCoverage: z.number().describe("Pokrycie testami i testowalność zmiany (1–10)."),
  verdict: z.enum(["pass", "fail"]).describe("Ogólny werdykt recenzji."),
  summary: z.string().describe("Podsumowanie recenzji w formacie Markdown."),
});

export type Review = z.infer<typeof REVIEW_SCHEMA>;

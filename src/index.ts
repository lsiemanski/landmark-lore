import { fileURLToPath } from "node:url";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateText, Output } from "ai";
import { z } from "zod";

export const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY,
});

export const DEFAULT_MODEL = process.env.DEFAULT_MODEL ?? "google/gemini-2.5-flash";

export function model(id = DEFAULT_MODEL) {
  return openrouter(id);
}

const landmarkSchema = z.object({
  name: z.string(),
  location: z.string(),
  description: z.string(),
  yearBuilt: z.number().optional(),
});

export type Landmark = z.infer<typeof landmarkSchema>;

async function main() {
  const { output } = await generateText({
    model: model(),
    output: Output.object({ schema: landmarkSchema }),
    prompt: "Describe the Eiffel Tower.",
  });

  console.log(JSON.stringify(output, null, 2));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(console.error);
}

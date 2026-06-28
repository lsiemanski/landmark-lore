export { reviewerAgent } from "./agent";
export { REVIEW_SCHEMA, type Review } from "./schemas";

import { reviewerAgent } from "./agent";
import type { Review } from "./schemas";

export async function reviewCode(diff: string): Promise<Review> {
  const { output } = await reviewerAgent.generate({ prompt: diff });
  return output;
}

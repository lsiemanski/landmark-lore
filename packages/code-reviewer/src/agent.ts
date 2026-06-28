import { ToolLoopAgent, Output } from "ai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { REVIEW_SCHEMA } from "./schemas";
import { SYSTEM_PROMPT } from "./prompts";

const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY,
});

export const DEFAULT_REVIEWER_MODEL = "anthropic/claude-sonnet-4.5";

export const reviewerAgent = new ToolLoopAgent({
  model: openrouter(DEFAULT_REVIEWER_MODEL),
  instructions: SYSTEM_PROMPT,
  output: Output.object({ schema: REVIEW_SCHEMA }),
});

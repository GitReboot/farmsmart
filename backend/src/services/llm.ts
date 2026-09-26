import OpenAI from 'openai';
import { z } from 'zod';
import { config } from '../config.js';
import { STAGE_IDS } from '../analysis/growPlan.js';

const client = config.openaiApiKey ? new OpenAI({ apiKey: config.openaiApiKey, timeout: 25000, maxRetries: 1 }) : null;

export const llmEnabled = () => client !== null;

const SYSTEM_PROMPT = `You are an agricultural extension officer advising smallholder farmers in Sub-Saharan Africa.
You receive a JSON context with a crop, its planting schedule, and climate numbers computed from 20 years of weather data.
Rules:
- Use ONLY the numbers in the context. Never invent rainfall, temperatures, dates, or prices.
- Give short, practical tips a farmer with limited resources can act on (low-cost options first).
- Do not recommend specific brand-name chemicals. Name pesticide classes only, and advise following label and local extension guidance.
- Write every string in the requested language, in simple words.`;

const planSchema = z.object({
  summary: z.string().max(600),
  varietyAdvice: z.string().max(400),
  stages: z.array(z.object({ stageId: z.enum(STAGE_IDS), tips: z.array(z.string().max(300)).max(5) })),
  risks: z.array(z.object({ title: z.string().max(100), mitigation: z.string().max(300) })).max(5),
});
export type LlmPlan = z.infer<typeof planSchema>;

// JSON Schema for OpenAI Structured Outputs (strict mode).
const jsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'varietyAdvice', 'stages', 'risks'],
  properties: {
    summary: { type: 'string', description: '2-3 sentence overview for the farmer' },
    varietyAdvice: { type: 'string', description: 'What kind of variety to look for (e.g. early-maturing, drought-tolerant)' },
    stages: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['stageId', 'tips'],
        properties: { stageId: { type: 'string', enum: [...STAGE_IDS] }, tips: { type: 'array', items: { type: 'string' } } },
      },
    },
    risks: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'mitigation'],
        properties: { title: { type: 'string' }, mitigation: { type: 'string' } },
      },
    },
  },
} as const;

/** Returns null on any failure so callers can fall back to template advice. */
export async function generatePlan(context: object, languageName: string): Promise<LlmPlan | null> {
  if (!client) return null;
  try {
    const completion = await client.chat.completions.create({
      model: config.openaiModel,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: `Language: ${languageName}\nContext:\n${JSON.stringify(context)}` },
      ],
      response_format: { type: 'json_schema', json_schema: { name: 'grow_plan', strict: true, schema: jsonSchema } },
    });
    const content = completion.choices[0]?.message?.content;
    if (!content) return null;
    const parsed = planSchema.safeParse(JSON.parse(content));
    if (!parsed.success) {
      console.warn('[llm] response failed validation');
      return null;
    }
    return parsed.data;
  } catch (err) {
    console.warn('[llm] request failed:', err instanceof Error ? err.message : err);
    return null;
  }
}

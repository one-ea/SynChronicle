import { z } from "zod";
export const GenerationConfigSchema = z.object({ provider: z.string().optional(), model: z.string().optional(), temperature: z.number().optional() }).strict(); export type GenerationConfig = z.infer<typeof GenerationConfigSchema>;
export const StoryBundleSchema = z.object({ premise: z.string(), outline: z.unknown().optional(), characters: z.unknown().optional(), world_rules: z.unknown().optional() }).strict(); export type StoryBundle = z.infer<typeof StoryBundleSchema>;
export const BundleSchema = z.object({ prompts: z.record(z.string(), z.string()).optional(), references: z.record(z.string(), z.string()).optional(), styles: z.record(z.string(), z.string()).optional() }).strict(); export type Bundle = z.infer<typeof BundleSchema>;
export const RenderedBundleSchema = BundleSchema.extend({ story: StoryBundleSchema.optional(), generation: GenerationConfigSchema.optional() }).strict(); export type RenderedBundle = z.infer<typeof RenderedBundleSchema>;

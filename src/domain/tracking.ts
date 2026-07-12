import { z } from "zod";

export interface StateChange {
  Chapter: number;
  Entity: string;
  Field: string;
  OldValue: string;
  NewValue: string;
  Reason: string;
}

export const StateChangeSchema = z.object({
  Chapter: z.number().int().positive(),
  Entity: z.string(),
  Field: z.string(),
  OldValue: z.string(),
  NewValue: z.string(),
  Reason: z.string(),
});
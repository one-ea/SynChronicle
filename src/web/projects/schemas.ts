import { z } from "zod";

export const ProjectIdParamsSchema = z.object({
  projectId: z.string().uuid(),
}).strict();

export const CreateProjectSchema = z.object({
  title: z.string().trim().min(1).max(256),
}).strict();

export const UpdateProjectSchema = z.object({
  title: z.string().trim().min(1).max(256),
  version: z.number().int().positive(),
}).strict();

export const ArchiveProjectSchema = z.object({
  version: z.number().int().positive(),
}).strict();

export type CreateProjectInput = z.infer<typeof CreateProjectSchema>;
export type UpdateProjectInput = z.infer<typeof UpdateProjectSchema>;

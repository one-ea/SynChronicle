import { z } from "zod";

export const jsonTagged = <T extends z.ZodTypeAny>(schema: T): z.ZodEffects<T> =>
  z.preprocess((value) => mapKeys(value), schema);

const mapKeys = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(mapKeys);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [toExportedName(key), mapKeys(entry)]));
};

const toExportedName = (key: string): string => key
  .split("_")
  .map((part) => part === "id" ? "ID" : part === "sha256" ? "SHA256" : part.charAt(0).toUpperCase() + part.slice(1))
  .join("");

ALTER TABLE "platform_models" ADD COLUMN "capabilities" jsonb DEFAULT '{}'::jsonb NOT NULL;

-- Backfill: project pricing from existing columns, fill safe defaults
UPDATE "platform_models"
SET "capabilities" = jsonb_build_object(
  'contextWindow', 0,
  'maxOutputTokens', 0,
  'pricing', jsonb_build_object(
    'inputPer1M', CAST("input_price" AS float8),
    'outputPer1M', CAST("output_price" AS float8)
  ),
  'modalities', '{"text": true, "vision": false, "audio": false}'::jsonb,
  'tools', '{"toolCalling": false, "structuredOutput": false, "jsonMode": false}'::jsonb,
  'generation', '{"streaming": true, "temperature": {"min": 0, "max": 2}, "reasoningEffort": [], "systemPrompt": true}'::jsonb,
  'policy', '{"allowPlatformCredential": true, "allowUserCredential": true, "tags": []}'::jsonb
);
import { z } from "zod";

export interface SimulationCorpusManifest {
  SourceDir: string;
  Sources: SimulationSource[];
}

export const SimulationCorpusManifestSchema: z.ZodType<SimulationCorpusManifest> = z.object({
  SourceDir: z.string(),
  Sources: z.lazy(() => z.array(SimulationSourceSchema)),
});

export interface SimulationSource {
  RelativePath: string;
  SHA256: string;
  Fingerprint: string;
  SizeBytes: number;
  ModTime: string;
  AnalyzedAt: string;
}

export const SimulationSourceSchema = z.object({
  RelativePath: z.string(),
  SHA256: z.string(),
  Fingerprint: z.string(),
  SizeBytes: z.number().int().nonnegative(),
  ModTime: z.string(),
  AnalyzedAt: z.string(),
});

export interface SimulationSourceReport {
  RelativePath: string;
  SHA256: string;
  Fingerprint: string;
  AnalyzedAt: string;
  Title: string;
  Summary: string;
  StyleObservations: string[];
  CommonWords: string[];
  PlotPatterns: string[];
  HookPatterns: string[];
  PacingNotes: string[];
  ReaderAppeal: string[];
  ReusableTechniques: string[];
  Warnings: string[];
}

export const SimulationSourceReportSchema = z.object({
  RelativePath: z.string(),
  SHA256: z.string(),
  Fingerprint: z.string(),
  AnalyzedAt: z.string(),
  Title: z.string(),
  Summary: z.string(),
  StyleObservations: z.array(z.string()),
  CommonWords: z.array(z.string()),
  PlotPatterns: z.array(z.string()),
  HookPatterns: z.array(z.string()),
  PacingNotes: z.array(z.string()),
  ReaderAppeal: z.array(z.string()),
  ReusableTechniques: z.array(z.string()),
  Warnings: z.array(z.string()),
});

export interface SimulationStyle {
  NarrativeVoice: string[];
  SentenceRhythm: string[];
  ProseTexture: string[];
  Perspective: string[];
  Mood: string[];
  DoNotCopy: string[];
}

export const SimulationStyleSchema = z.object({
  NarrativeVoice: z.array(z.string()),
  SentenceRhythm: z.array(z.string()),
  ProseTexture: z.array(z.string()),
  Perspective: z.array(z.string()),
  Mood: z.array(z.string()),
  DoNotCopy: z.array(z.string()),
});

export interface SimulationLexicon {
  CommonWords: string[];
  EmotionWords: string[];
  SceneWords: string[];
  TransitionWords: string[];
  SignaturePhrases: string[];
}

export const SimulationLexiconSchema = z.object({
  CommonWords: z.array(z.string()),
  EmotionWords: z.array(z.string()),
  SceneWords: z.array(z.string()),
  TransitionWords: z.array(z.string()),
  SignaturePhrases: z.array(z.string()),
});

export interface SimulationPlotDesign {
  OpeningPatterns: string[];
  EscalationPatterns: string[];
  TurningPointPatterns: string[];
  PayoffPatterns: string[];
}

export const SimulationPlotDesignSchema = z.object({
  OpeningPatterns: z.array(z.string()),
  EscalationPatterns: z.array(z.string()),
  TurningPointPatterns: z.array(z.string()),
  PayoffPatterns: z.array(z.string()),
});

export interface SimulationHookDesign {
  HookTypes: string[];
  Placement: string[];
  CliffhangerPatterns: string[];
  PayoffRules: string[];
}

export const SimulationHookDesignSchema = z.object({
  HookTypes: z.array(z.string()),
  Placement: z.array(z.string()),
  CliffhangerPatterns: z.array(z.string()),
  PayoffRules: z.array(z.string()),
});

export interface SimulationPacingDensity {
  SceneDensity: string[];
  InformationRelease: string[];
  DialogueActionRatio: string[];
  CompressionRules: string[];
}

export const SimulationPacingDensitySchema = z.object({
  SceneDensity: z.array(z.string()),
  InformationRelease: z.array(z.string()),
  DialogueActionRatio: z.array(z.string()),
  CompressionRules: z.array(z.string()),
});

export interface SimulationReaderEngagement {
  Methods: string[];
  EmotionalDrivers: string[];
  ProgressionRewards: string[];
  AntiPatterns: string[];
}

export const SimulationReaderEngagementSchema = z.object({
  Methods: z.array(z.string()),
  EmotionalDrivers: z.array(z.string()),
  ProgressionRewards: z.array(z.string()),
  AntiPatterns: z.array(z.string()),
});

export interface SimulationRoleGuidance {
  Coordinator: string[];
  Architect: string[];
  Writer: string[];
  Editor: string[];
}

export const SimulationRoleGuidanceSchema = z.object({
  Coordinator: z.array(z.string()),
  Architect: z.array(z.string()),
  Writer: z.array(z.string()),
  Editor: z.array(z.string()),
});

export interface SimulationSynthesis {
  Style: SimulationStyle;
  Lexicon: SimulationLexicon;
  PlotDesign: SimulationPlotDesign;
  HookDesign: SimulationHookDesign;
  PacingDensity: SimulationPacingDensity;
  ReaderEngagement: SimulationReaderEngagement;
  RoleGuidance: SimulationRoleGuidance;
}

export const SimulationSynthesisSchema: z.ZodType<SimulationSynthesis> = z.object({
  Style: SimulationStyleSchema,
  Lexicon: SimulationLexiconSchema,
  PlotDesign: SimulationPlotDesignSchema,
  HookDesign: SimulationHookDesignSchema,
  PacingDensity: SimulationPacingDensitySchema,
  ReaderEngagement: SimulationReaderEngagementSchema,
  RoleGuidance: SimulationRoleGuidanceSchema,
});

export interface SimulationProfile {
  Version: string;
  CreatedAt: string;
  UpdatedAt: string;
  Corpus: SimulationCorpusManifest;
  SourceReports: SimulationSourceReport[];
  Synthesis: SimulationSynthesis;
}

export const SimulationProfileSchema: z.ZodType<SimulationProfile> = z.object({
  Version: z.string(),
  CreatedAt: z.string(),
  UpdatedAt: z.string(),
  Corpus: SimulationCorpusManifestSchema,
  SourceReports: z.array(SimulationSourceReportSchema),
  Synthesis: SimulationSynthesisSchema,
});

export interface SimulationCompactProfile {
  Version: string;
  UpdatedAt: string;
  SourceCount: number;
  SourceFiles: string[];
  Style: SimulationStyle;
  Lexicon: SimulationLexicon;
  PlotDesign: SimulationPlotDesign;
  HookDesign: SimulationHookDesign;
  PacingDensity: SimulationPacingDensity;
  ReaderEngagement: SimulationReaderEngagement;
  RoleGuidance: SimulationRoleGuidance;
}

export const SimulationCompactProfileSchema: z.ZodType<SimulationCompactProfile> = z.object({
  Version: z.string(),
  UpdatedAt: z.string(),
  SourceCount: z.number().int().nonnegative(),
  SourceFiles: z.array(z.string()),
  Style: SimulationStyleSchema,
  Lexicon: SimulationLexiconSchema,
  PlotDesign: SimulationPlotDesignSchema,
  HookDesign: SimulationHookDesignSchema,
  PacingDensity: SimulationPacingDensitySchema,
  ReaderEngagement: SimulationReaderEngagementSchema,
  RoleGuidance: SimulationRoleGuidanceSchema,
});
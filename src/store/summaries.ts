import type { ChapterSummary, ArcSummary, VolumeSummary } from "../domain/index.js";
import { ChapterSummarySchema, ArcSummarySchema, VolumeSummarySchema } from "../domain/index.js";
import { FileIO } from "./io.js";
const pad = (n: number) => String(n).padStart(2, "0");
export class SummaryStore {
  constructor(private readonly io: FileIO) {}
  saveSummary(value: ChapterSummary) { ChapterSummarySchema.parse(value); return this.io.writeJSON(`summaries/${pad(value.chapter)}.json`, value); }
  loadSummary(chapter: number) { return this.io.readJSON(`summaries/${pad(chapter)}.json`, ChapterSummarySchema); }
  saveArcSummary(value: ArcSummary) { ArcSummarySchema.parse(value); return this.io.writeJSON(`summaries/arc-v${pad(value.volume)}a${pad(value.arc)}.json`, value); }
  loadArcSummary(volume: number, arc: number) { return this.io.readJSON(`summaries/arc-v${pad(volume)}a${pad(arc)}.json`, ArcSummarySchema); }
  saveVolumeSummary(value: VolumeSummary) { VolumeSummarySchema.parse(value); return this.io.writeJSON(`summaries/vol-v${pad(value.volume)}.json`, value); }
  loadVolumeSummary(volume: number) { return this.io.readJSON(`summaries/vol-v${pad(volume)}.json`, VolumeSummarySchema); }
}

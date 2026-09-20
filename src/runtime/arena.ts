import { detectAitone, type AitoneResult } from "../stylestat/aitone.js";

export interface ArenaCandidate {
  id: "A" | "B";
  modelName: string;
  text: string;
  aitone: AitoneResult | null;
  wordCount: number;
}

export interface DimensionVerdict {
  dimension: string;
  winner: "A" | "B" | "tie";
  reason: string;
}

export interface ArenaComparison {
  chapter: number;
  candidateA: ArenaCandidate;
  candidateB: ArenaCandidate;
  dimensions: DimensionVerdict[];
  overallWinner: "A" | "B" | "tie";
  recommendation: string;
}

export function evaluateArenaCandidates(
  chapter: number,
  candidateA: { model: string; text: string },
  candidateB: { model: string; text: string },
): ArenaComparison {
  const aitoneA = detectAitone(candidateA.text);
  const aitoneB = detectAitone(candidateB.text);
  const wordsA = [...candidateA.text].length;
  const wordsB = [...candidateB.text].length;

  const aItem: ArenaCandidate = {
    id: "A",
    modelName: candidateA.model,
    text: candidateA.text,
    aitone: aitoneA,
    wordCount: wordsA,
  };
  const bItem: ArenaCandidate = {
    id: "B",
    modelName: candidateB.model,
    text: candidateB.text,
    aitone: aitoneB,
    wordCount: wordsB,
  };

  const dimensions: DimensionVerdict[] = [];

  // 1. 去 AI 味自然度维度 (AI-Tone score 越高越自然；空文本无法评分按 0 处理，与 advisor 口径一致)
  const scoreA = aitoneA?.score ?? 0;
  const scoreB = aitoneB?.score ?? 0;
  const aitoneWinner = scoreA > scoreB ? "A" : scoreB > scoreA ? "B" : "tie";
  dimensions.push({
    dimension: "语言去AI味自然度",
    winner: aitoneWinner,
    reason: `候选 A 得分 ${scoreA}，候选 B 得分 ${scoreB}${aitoneWinner === "tie" ? "，两者不相上下" : `，候选 ${aitoneWinner} 语言更为地道干练`}`,
  });

  // 2. 篇幅饱满度与细节丰富度
  const diffRatio = Math.abs(wordsA - wordsB) / Math.max(wordsA, wordsB, 1);
  const lengthWinner = diffRatio < 0.1 ? "tie" : wordsA > wordsB ? "A" : "B";
  dimensions.push({
    dimension: "正文字数与细节饱满度",
    winner: lengthWinner,
    reason: `候选 A (${wordsA} 字) vs 候选 B (${wordsB} 字)${lengthWinner === "tie" ? "，篇幅规模相当" : `，候选 ${lengthWinner} 场景刻画细节更充实`}`,
  });

  // 综合判定
  let aScore = 0;
  let bScore = 0;
  if (aitoneWinner === "A") aScore += 1.5;
  if (aitoneWinner === "B") bScore += 1.5;
  if (lengthWinner === "A") aScore += 1;
  if (lengthWinner === "B") bScore += 1;

  const overallWinner = aScore > bScore ? "A" : bScore > aScore ? "B" : "tie";
  const recommendation = overallWinner === "tie"
    ? "两版生成各具亮点，建议根据个人对文风偏好择优采纳。"
    : `编辑评审推荐采纳【候选 ${overallWinner} (${overallWinner === "A" ? candidateA.model : candidateB.model})】，在综合行文自然度与行文节奏上更具叙事张力。`;

  return {
    chapter,
    candidateA: aItem,
    candidateB: bItem,
    dimensions,
    overallWinner,
    recommendation,
  };
}

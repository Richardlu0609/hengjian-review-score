export type CriterionForScoring = {
  id: string;
  name: string;
  minScore: number;
  maxScore: number;
  step: number;
  weight: number;
  required: boolean;
  coreRank: number;
};

export type ScoreValue = { criterionId: string; score: number };

export type JudgeTotal = {
  judgeId: string;
  judgeName: string;
  totalScore: number;
  criterionScores: Record<string, number>;
  comment: string;
};

export function isStepAligned(value: number, minScore: number, step: number): boolean {
  const quotient = (value - minScore) / step;
  return Math.abs(quotient - Math.round(quotient)) < 1e-8;
}

export function validateScoreValues(
  criteria: CriterionForScoring[],
  values: ScoreValue[],
  requireComplete: boolean,
): void {
  const criteriaById = new Map(criteria.map((criterion) => [criterion.id, criterion]));
  const seen = new Set<string>();

  for (const value of values) {
    if (seen.has(value.criterionId)) throw new Error("同一评分指标不能重复提交。" );
    seen.add(value.criterionId);
    const criterion = criteriaById.get(value.criterionId);
    if (!criterion) throw new Error("评分指标不属于当前活动。" );
    if (value.score < criterion.minScore || value.score > criterion.maxScore) {
      throw new Error(`${criterion.name}应在 ${criterion.minScore}—${criterion.maxScore} 分之间。`);
    }
    if (!isStepAligned(value.score, criterion.minScore, criterion.step)) {
      throw new Error(`${criterion.name}必须按 ${criterion.step} 分递增。`);
    }
  }

  if (requireComplete) {
    const missing = criteria.filter((criterion) => criterion.required && !seen.has(criterion.id));
    if (missing.length) throw new Error(`请完成必填指标：${missing.map((criterion) => criterion.name).join("、")}。`);
  }
}

export function calculateJudgeProjectScore(
  criteria: CriterionForScoring[],
  values: ScoreValue[],
  decimalPlaces = 2,
): number {
  const byId = new Map(criteria.map((criterion) => [criterion.id, criterion]));
  const total = values.reduce((sum, value) => {
    const criterion = byId.get(value.criterionId);
    return sum + (criterion ? value.score * criterion.weight : 0);
  }, 0);
  return roundTo(total, decimalPlaces);
}

export function roundTo(value: number, decimalPlaces: number): number {
  const factor = 10 ** decimalPlaces;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

export function removeExtremeScores(
  judgeScores: JudgeTotal[],
  removeHighest: number,
  removeLowest: number,
): { valid: JudgeTotal[]; removed: JudgeTotal[]; highest: JudgeTotal[]; lowest: JudgeTotal[] } {
  const sorted = [...judgeScores].sort((a, b) => a.totalScore - b.totalScore || a.judgeId.localeCompare(b.judgeId));
  const highCount = Math.min(Math.max(0, removeHighest), Math.max(0, sorted.length - 1));
  const lowCount = Math.min(Math.max(0, removeLowest), Math.max(0, sorted.length - highCount - 1));
  const lowest = sorted.slice(0, lowCount);
  const highest = highCount ? sorted.slice(sorted.length - highCount) : [];
  const removedIds = new Set([...lowest, ...highest].map((row) => row.judgeId));
  return {
    valid: judgeScores.filter((row) => !removedIds.has(row.judgeId)),
    removed: judgeScores.filter((row) => removedIds.has(row.judgeId)),
    highest,
    lowest,
  };
}

export function calculateProjectResult(
  judgeScores: JudgeTotal[],
  removeHighest: number,
  removeLowest: number,
  decimalPlaces: number,
) {
  const extremes = removeExtremeScores(judgeScores, removeHighest, removeLowest);
  const rawScores = judgeScores.map((row) => row.totalScore);
  const validScores = extremes.valid.map((row) => row.totalScore);
  const averageScore = rawScores.length ? roundTo(rawScores.reduce((sum, value) => sum + value, 0) / rawScores.length, decimalPlaces) : null;
  const finalScore = validScores.length ? roundTo(validScores.reduce((sum, value) => sum + value, 0) / validScores.length, decimalPlaces) : null;
  const standardDeviation = validScores.length && finalScore !== null
    ? roundTo(Math.sqrt(validScores.reduce((sum, value) => sum + (value - finalScore) ** 2, 0) / validScores.length), decimalPlaces)
    : null;

  return {
    rawScores,
    validScores,
    highestScores: extremes.highest.map((row) => row.totalScore),
    lowestScores: extremes.lowest.map((row) => row.totalScore),
    removedJudgeIds: extremes.removed.map((row) => row.judgeId),
    totalScore: validScores.length ? roundTo(validScores.reduce((sum, value) => sum + value, 0), decimalPlaces) : null,
    averageScore,
    finalScore,
    standardDeviation,
    judgeCount: judgeScores.length,
    validJudgeCount: validScores.length,
  };
}

export function calculateRanking<T extends {
  projectNumber: string;
  finalScore: number | null;
  coreScores: Record<string, number | null>;
}>(rows: T[], coreCriterionIds: string[]): Array<T & { rank: number | null }> {
  const scored = rows.filter((row) => row.finalScore !== null).sort((a, b) => {
    const finalDifference = (b.finalScore ?? -Infinity) - (a.finalScore ?? -Infinity);
    if (Math.abs(finalDifference) > 1e-9) return finalDifference;
    for (const criterionId of coreCriterionIds) {
      const difference = (b.coreScores[criterionId] ?? -Infinity) - (a.coreScores[criterionId] ?? -Infinity);
      if (Math.abs(difference) > 1e-9) return difference;
    }
    return a.projectNumber.localeCompare(b.projectNumber, "zh-CN", { numeric: true });
  });
  const ranks = new Map(scored.map((row, index) => [row.projectNumber, index + 1]));
  return rows.map((row) => ({ ...row, rank: ranks.get(row.projectNumber) ?? null }));
}


import { calculateProjectResult, calculateRanking, roundTo, type JudgeTotal } from "@/lib/scoring";
import type { AdminData, Criterion, Project, ReviewEvent } from "./types";

export type ProjectResult = Project & ReturnType<typeof calculateProjectResult> & {
  projectNumber: string;
  rank: number | null;
  expectedJudgeCount: number;
  judgeScores: JudgeTotal[];
  coreScores: Record<string, number | null>;
};

export type Overview = {
  event: ReviewEvent;
  results: ProjectResult[];
  completedTasks: number;
  totalTasks: number;
  completionRate: number;
  maxScore: number;
};

export function calculateOverview(data: AdminData): Overview | null {
  const event = data.events[0];
  if (!event) return null;
  const activeProjects = data.projects.filter((row) => row.status === "ACTIVE");
  const activeJudges = data.judges.filter((row) => row.status === "ACTIVE");
  const projectIds = new Set(activeProjects.map((row) => row.id));
  const judgeIds = new Set(activeJudges.map((row) => row.id));
  const assignments = data.assignments.filter((row) => projectIds.has(row.project_id) && judgeIds.has(row.judge_id));
  const submitted = data.submissions.filter((row) => ["SUBMITTED", "LOCKED"].includes(row.status) && projectIds.has(row.project_id) && judgeIds.has(row.judge_id));
  const scoreMap = new Map<string, Record<string, number>>();
  for (const score of data.scores) {
    const key = `${score.judge_id}:${score.project_id}`;
    scoreMap.set(key, { ...(scoreMap.get(key) ?? {}), [score.criterion_id]: Number(score.score) });
  }
  const judgeNames = new Map(data.judges.map((row) => [row.id, row.name]));
  const coreCriteria = [...data.criteria].filter((row) => row.core_rank > 0).sort((a, b) => a.core_rank - b.core_rank);
  const unranked = data.projects.map((project) => {
    const judgeScores: JudgeTotal[] = submitted.filter((row) => row.project_id === project.id).map((submission) => ({
      judgeId: submission.judge_id,
      judgeName: judgeNames.get(submission.judge_id) ?? "未知评委",
      totalScore: Number(submission.total_score),
      criterionScores: scoreMap.get(`${submission.judge_id}:${project.id}`) ?? {},
      comment: submission.comment,
    }));
    const calculated = calculateProjectResult(judgeScores, event.remove_highest, event.remove_lowest, event.decimal_places);
    const validIds = new Set(judgeScores.filter((row) => !calculated.removedJudgeIds.includes(row.judgeId)).map((row) => row.judgeId));
    const coreScores: Record<string, number | null> = {};
    for (const criterion of coreCriteria) {
      const values = judgeScores.filter((row) => validIds.has(row.judgeId)).map((row) => row.criterionScores[criterion.id]).filter((value): value is number => typeof value === "number");
      coreScores[criterion.id] = values.length ? roundTo(values.reduce((sum, value) => sum + value, 0) / values.length, event.decimal_places) : null;
    }
    return {
      ...project,
      projectNumber: project.project_number,
      ...calculated,
      expectedJudgeCount: assignments.filter((row) => row.project_id === project.id).length,
      judgeScores,
      coreScores,
    };
  });
  const results: ProjectResult[] = calculateRanking(unranked, coreCriteria.map((row: Criterion) => row.id));
  results.sort((a, b) => (a.rank ?? Number.MAX_SAFE_INTEGER) - (b.rank ?? Number.MAX_SAFE_INTEGER) || a.sort_order - b.sort_order);
  const submittedKeys = new Set(submitted.map((row) => `${row.judge_id}:${row.project_id}`));
  const completedTasks = assignments.filter((row) => submittedKeys.has(`${row.judge_id}:${row.project_id}`)).length;
  return {
    event,
    results,
    completedTasks,
    totalTasks: assignments.length,
    completionRate: assignments.length ? roundTo(completedTasks / assignments.length * 100, 1) : 0,
    maxScore: roundTo(data.criteria.reduce((sum, row) => sum + Number(row.max_score) * Number(row.weight), 0), event.decimal_places),
  };
}


export type EventStatus = "DRAFT" | "ACTIVE" | "FINISHED" | "LOCKED";

export type ReviewEvent = {
  id: string;
  owner_id: string;
  name: string;
  description: string;
  start_time: string;
  end_time: string;
  status: EventStatus;
  remove_highest: number;
  remove_lowest: number;
  decimal_places: number;
  created_at: string;
  updated_at: string;
};

export type Criterion = {
  id: string;
  event_id: string;
  name: string;
  description: string;
  min_score: number;
  max_score: number;
  step: number;
  weight: number;
  sort_order: number;
  required: boolean;
  core_rank: number;
};

export type Project = {
  id: string;
  event_id: string;
  project_number: string;
  project_name: string;
  team_name: string;
  leader_name: string;
  description: string;
  sort_order: number;
  status: "ACTIVE" | "DISABLED";
};

export type Judge = {
  id: string;
  event_id: string;
  name: string;
  phone: string;
  email: string;
  code: string;
  token: string;
  status: "ACTIVE" | "DISABLED";
};

export type Assignment = { event_id: string; judge_id: string; project_id: string };
export type Submission = {
  id: string;
  event_id: string;
  judge_id: string;
  project_id: string;
  status: "DRAFT" | "SUBMITTED" | "LOCKED";
  total_score: number;
  comment: string;
  submitted_at: string | null;
  updated_at: string;
};
export type Score = {
  event_id: string;
  judge_id: string;
  project_id: string;
  criterion_id: string;
  score: number;
};

export type AdminData = {
  events: ReviewEvent[];
  criteria: Criterion[];
  projects: Project[];
  judges: Judge[];
  assignments: Assignment[];
  submissions: Submission[];
  scores: Score[];
};

export type JudgeSnapshot = {
  event: {
    id: string;
    name: string;
    description: string;
    status: EventStatus;
    decimalPlaces: number;
    canScore: boolean;
    statusMessage: string;
  };
  judge: { id: string; name: string; code: string };
  criteria: Array<{
    id: string;
    name: string;
    description: string;
    minScore: number;
    maxScore: number;
    step: number;
    weight: number;
    required: boolean;
  }>;
  projects: Array<{
    id: string;
    projectNumber: string;
    projectName: string;
    teamName: string;
    leaderName: string;
    description: string;
    scores: Record<string, number>;
    submission: null | {
      status: "DRAFT" | "SUBMITTED" | "LOCKED";
      totalScore: number;
      comment: string;
      submittedAt: string | null;
    };
  }>;
  maxScore: number;
  progress: { completed: number; total: number; percent: number };
};

export type AuthSession = {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  user: { id: string; email?: string; user_metadata?: Record<string, unknown> };
};


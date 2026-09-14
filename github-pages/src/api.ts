import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "./config";
import type {
  AdminData, Assignment, AuthSession, Criterion, Judge, JudgeSnapshot,
  Project, ReviewEvent, Score, Submission,
} from "./types";

const SESSION_KEY = "hengjian_supabase_session";

function parseError(payload: unknown, fallback: string): string {
  if (payload && typeof payload === "object") {
    const row = payload as Record<string, unknown>;
    return String(row.msg ?? row.message ?? row.error_description ?? row.error ?? fallback);
  }
  return fallback;
}

async function readPayload(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try { return JSON.parse(text); } catch { return text; }
}

function normalizeSession(payload: unknown): AuthSession | null {
  if (!payload || typeof payload !== "object") return null;
  const value = payload as Record<string, unknown>;
  const source = value.session && typeof value.session === "object"
    ? value.session as Record<string, unknown>
    : value;
  if (typeof source.access_token !== "string" || typeof source.refresh_token !== "string") return null;
  const expiresAt = typeof source.expires_at === "number"
    ? source.expires_at
    : Math.floor(Date.now() / 1000) + Number(source.expires_in ?? 3600);
  const user = (source.user ?? value.user) as AuthSession["user"] | undefined;
  if (!user?.id) return null;
  return {
    access_token: source.access_token,
    refresh_token: source.refresh_token,
    expires_at: expiresAt,
    user,
  };
}

export function loadSession(): AuthSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) as AuthSession : null;
  } catch { return null; }
}

function storeSession(session: AuthSession | null): void {
  if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  else localStorage.removeItem(SESSION_KEY);
}

async function authRequest(path: string, body: Record<string, unknown>): Promise<unknown> {
  const response = await fetch(`${SUPABASE_URL}/auth/v1/${path}`, {
    method: "POST",
    headers: { apikey: SUPABASE_PUBLISHABLE_KEY, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await readPayload(response);
  if (!response.ok) throw new Error(parseError(payload, `登录服务请求失败（${response.status}）`));
  return payload;
}

export async function signIn(email: string, password: string): Promise<AuthSession> {
  const payload = await authRequest("token?grant_type=password", { email, password });
  const session = normalizeSession(payload);
  if (!session) throw new Error("登录成功但未获得有效会话，请稍后重试。");
  storeSession(session);
  return session;
}

export async function signUp(email: string, password: string): Promise<{ session: AuthSession | null; message: string }> {
  const payload = await authRequest("signup", { email, password, data: { display_name: email.split("@")[0] } });
  const session = normalizeSession(payload);
  if (session) storeSession(session);
  return {
    session,
    message: session ? "管理员账号已创建并登录。" : "账号已创建，请先打开验证邮件完成确认，再返回登录。",
  };
}

export function signOut(): void { storeSession(null); }

async function validSession(): Promise<AuthSession> {
  const current = loadSession();
  if (!current) throw new Error("管理员登录已失效，请重新登录。");
  if (current.expires_at > Math.floor(Date.now() / 1000) + 60) return current;
  const payload = await authRequest("token?grant_type=refresh_token", { refresh_token: current.refresh_token });
  const refreshed = normalizeSession(payload);
  if (!refreshed) {
    storeSession(null);
    throw new Error("管理员登录已过期，请重新登录。");
  }
  storeSession(refreshed);
  return refreshed;
}

type RestOptions = {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  prefer?: string;
};

async function rest<T>(path: string, options: RestOptions = {}): Promise<T> {
  const session = await validSession();
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: options.method ?? "GET",
    headers: {
      apikey: SUPABASE_PUBLISHABLE_KEY,
      authorization: `Bearer ${session.access_token}`,
      "content-type": "application/json",
      ...(options.prefer ? { prefer: options.prefer } : {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const payload = await readPayload(response);
  if (!response.ok) throw new Error(parseError(payload, `数据库请求失败（${response.status}）`));
  return payload as T;
}

export async function loadEvents(): Promise<ReviewEvent[]> {
  return rest<ReviewEvent[]>("events?select=*&order=created_at.desc");
}

export async function loadAdminData(eventId: string): Promise<AdminData> {
  const filter = `event_id=eq.${encodeURIComponent(eventId)}`;
  const [events, criteria, projects, judges, assignments, submissions, scores] = await Promise.all([
    rest<ReviewEvent[]>(`events?select=*&id=eq.${encodeURIComponent(eventId)}`),
    rest<Criterion[]>(`criteria?select=*&${filter}&order=sort_order.asc`),
    rest<Project[]>(`projects?select=*&${filter}&order=sort_order.asc,project_number.asc`),
    rest<Judge[]>(`judges?select=*&${filter}&order=code.asc`),
    rest<Assignment[]>(`assignments?select=*&${filter}`),
    rest<Submission[]>(`submissions?select=*&${filter}`),
    rest<Score[]>(`scores?select=*&${filter}`),
  ]);
  return { events, criteria, projects, judges, assignments, submissions, scores };
}

export async function insertOne<T>(table: string, input: Record<string, unknown>): Promise<T> {
  const rows = await rest<T[]>(table, { method: "POST", body: input, prefer: "return=representation" });
  if (!rows[0]) throw new Error("数据库未返回新建记录。");
  return rows[0];
}

export async function updateRows<T>(table: string, filter: string, input: Record<string, unknown>): Promise<T[]> {
  return rest<T[]>(`${table}?${filter}`, { method: "PATCH", body: input, prefer: "return=representation" });
}

export async function deleteRows(table: string, filter: string): Promise<void> {
  await rest(`${table}?${filter}`, { method: "DELETE", prefer: "return=minimal" });
}

export async function assignAll(eventId: string, judges: Judge[], projects: Project[]): Promise<number> {
  const rows = judges.filter((row) => row.status === "ACTIVE").flatMap((judge) =>
    projects.filter((row) => row.status === "ACTIVE").map((project) => ({
      event_id: eventId,
      judge_id: judge.id,
      project_id: project.id,
    })),
  );
  if (!rows.length) return 0;
  await rest("assignments?on_conflict=judge_id,project_id", {
    method: "POST",
    body: rows,
    prefer: "resolution=ignore-duplicates,return=minimal",
  });
  return rows.length;
}

export async function loadJudgeSnapshot(token: string): Promise<JudgeSnapshot> {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/judge_snapshot`, {
    method: "POST",
    headers: { apikey: SUPABASE_PUBLISHABLE_KEY, "content-type": "application/json" },
    body: JSON.stringify({ p_token: token }),
  });
  const payload = await readPayload(response);
  if (!response.ok) throw new Error(parseError(payload, `评分链接加载失败（${response.status}）`));
  return payload as JudgeSnapshot;
}

export async function saveJudgeScore(input: {
  token: string;
  projectId: string;
  scores: Array<{ criterionId: string; score: number }>;
  comment: string;
  submit: boolean;
}): Promise<{ status: "DRAFT" | "SUBMITTED"; totalScore: number; savedAt: string }> {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/save_judge_score`, {
    method: "POST",
    headers: { apikey: SUPABASE_PUBLISHABLE_KEY, "content-type": "application/json" },
    body: JSON.stringify({
      p_token: input.token,
      p_project_id: input.projectId,
      p_scores: input.scores,
      p_comment: input.comment,
      p_submit: input.submit,
    }),
  });
  const payload = await readPayload(response);
  if (!response.ok) throw new Error(parseError(payload, `评分保存失败（${response.status}）`));
  return payload as { status: "DRAFT" | "SUBMITTED"; totalScore: number; savedAt: string };
}

export function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}


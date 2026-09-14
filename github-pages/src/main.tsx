import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { createXlsx } from "@/lib/xlsx";
import {
  assignAll, deleteRows, insertOne, loadAdminData, loadEvents, loadJudgeSnapshot,
  loadSession, randomToken, saveJudgeScore, signIn, signOut, signUp, updateRows,
} from "./api";
import { APP_NAME, APP_SUBTITLE } from "./config";
import { calculateOverview } from "./results";
import type {
  AdminData, AuthSession, Criterion, EventStatus, Judge, JudgeSnapshot, Project, ReviewEvent,
} from "./types";
import "./styles.css";

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "操作失败，请稍后重试。";
}

function isoFromLocal(value: FormDataEntryValue | null): string {
  return new Date(String(value)).toISOString();
}

function defaultLocalDate(offsetHours: number): string {
  const value = new Date(Date.now() + offsetHours * 3600_000);
  const local = new Date(value.getTime() - value.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function AdminAuth({ onAuthenticated }: { onAuthenticated: (session: AuthSession) => void }) {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");
    setBusy(true); setNotice("");
    try {
      if (mode === "login") onAuthenticated(await signIn(email, password));
      else {
        const result = await signUp(email, password);
        setNotice(result.message);
        if (result.session) onAuthenticated(result.session);
      }
    } catch (error) { setNotice(messageOf(error)); }
    finally { setBusy(false); }
  }

  return <main className="auth-page">
    <section className="auth-card">
      <Brand />
      <div className="auth-copy"><span className="eyebrow">ADMIN CONSOLE</span><h1>管理员后台</h1><p>创建活动、分配项目并实时查看全部评委的汇总成绩。</p></div>
      <form onSubmit={submit} className="stack">
        <label>管理员邮箱<input name="email" type="email" required autoComplete="email" placeholder="name@example.com" /></label>
        <label>密码<input name="password" type="password" required minLength={6} autoComplete={mode === "login" ? "current-password" : "new-password"} placeholder="至少 6 位" /></label>
        {notice ? <div className="notice">{notice}</div> : null}
        <button className="primary" disabled={busy}>{busy ? "处理中…" : mode === "login" ? "登录后台" : "创建管理员账号"}</button>
      </form>
      <button className="text-button" onClick={() => { setMode(mode === "login" ? "signup" : "login"); setNotice(""); }}>
        {mode === "login" ? "首次使用？创建管理员账号" : "已有账号？返回登录"}
      </button>
    </section>
  </main>;
}

function Brand() {
  return <div className="brand"><span className="brand-mark">衡</span><span><strong>{APP_NAME}</strong><small>{APP_SUBTITLE}</small></span></div>;
}

type Tab = "overview" | "event" | "criteria" | "projects" | "judges" | "progress" | "results";
const tabs: Array<[Tab, string]> = [
  ["overview", "仪表盘"], ["event", "活动"], ["criteria", "评分指标"], ["projects", "项目"],
  ["judges", "评委"], ["progress", "分配与进度"], ["results", "成绩与导出"],
];

function AdminApp({ session, onLogout }: { session: AuthSession; onLogout: () => void }) {
  const [events, setEvents] = useState<ReviewEvent[]>([]);
  const [eventId, setEventId] = useState("");
  const [data, setData] = useState<AdminData | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [busy, setBusy] = useState(true);
  const [notice, setNotice] = useState("");

  const refreshEvents = useCallback(async (preferredId?: string) => {
    const rows = await loadEvents();
    setEvents(rows);
    setEventId((current) => preferredId ?? (rows.some((row) => row.id === current) ? current : rows[0]?.id ?? ""));
    return rows;
  }, []);

  const refreshData = useCallback(async (id: string) => {
    if (!id) { setData(null); return; }
    setData(await loadAdminData(id));
  }, []);

  useEffect(() => {
    void refreshEvents().catch((error) => setNotice(messageOf(error))).finally(() => setBusy(false));
  }, [refreshEvents]);
  useEffect(() => { void refreshData(eventId).catch((error) => setNotice(messageOf(error))); }, [eventId, refreshData]);
  useEffect(() => {
    if (!eventId || data?.events[0]?.status !== "ACTIVE") return;
    const timer = window.setInterval(() => void refreshData(eventId).catch(() => undefined), 10_000);
    return () => clearInterval(timer);
  }, [eventId, data?.events, refreshData]);

  const overview = useMemo(() => data ? calculateOverview(data) : null, [data]);

  async function run(action: () => Promise<void>, success: string) {
    setNotice("");
    try {
      await action();
      await refreshEvents(eventId || undefined);
      if (eventId) await refreshData(eventId);
      setNotice(success);
    } catch (error) { setNotice(messageOf(error)); }
  }

  async function createEvent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      const row = await insertOne<ReviewEvent>("events", {
        name: String(form.get("name") ?? "").trim(),
        description: String(form.get("description") ?? "").trim(),
        start_time: isoFromLocal(form.get("start_time")),
        end_time: isoFromLocal(form.get("end_time")),
        remove_highest: Number(form.get("remove_highest") ?? 0),
        remove_lowest: Number(form.get("remove_lowest") ?? 0),
        decimal_places: Number(form.get("decimal_places") ?? 2),
      });
      await refreshEvents(row.id); await refreshData(row.id); setEventId(row.id); setTab("criteria"); setNotice("活动创建成功，请继续添加评分指标。");
      event.currentTarget.reset();
    } catch (error) { setNotice(messageOf(error)); }
  }

  async function addCriterion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!eventId) return;
    const form = new FormData(event.currentTarget);
    await run(async () => {
      await insertOne<Criterion>("criteria", {
        event_id: eventId, name: String(form.get("name") ?? "").trim(), description: String(form.get("description") ?? "").trim(),
        min_score: Number(form.get("min_score") ?? 0), max_score: Number(form.get("max_score") ?? 20), step: Number(form.get("step") ?? 1),
        weight: Number(form.get("weight") ?? 1), sort_order: Number(form.get("sort_order") ?? 0), required: true, core_rank: Number(form.get("core_rank") ?? 0),
      });
      event.currentTarget.reset();
    }, "评分指标已添加。");
  }

  async function addProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!eventId) return;
    const form = new FormData(event.currentTarget);
    await run(async () => {
      await insertOne<Project>("projects", {
        event_id: eventId, project_number: String(form.get("project_number") ?? "").trim(), project_name: String(form.get("project_name") ?? "").trim(),
        team_name: String(form.get("team_name") ?? "").trim(), leader_name: String(form.get("leader_name") ?? "").trim(), description: String(form.get("description") ?? "").trim(),
        sort_order: Number(form.get("sort_order") ?? 0),
      });
      event.currentTarget.reset();
    }, "参评项目已添加。");
  }

  async function addJudge(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!eventId) return;
    const form = new FormData(event.currentTarget);
    await run(async () => {
      await insertOne<Judge>("judges", {
        event_id: eventId, name: String(form.get("name") ?? "").trim(), code: String(form.get("code") ?? "").trim(),
        phone: String(form.get("phone") ?? "").trim(), email: String(form.get("email") ?? "").trim(), token: randomToken(),
      });
      event.currentTarget.reset();
    }, "评委已添加，专属评分链接已生成。");
  }

  if (busy) return <main className="center-page"><div className="loader" />正在连接云数据库…</main>;
  const currentEvent = data?.events[0] ?? events.find((row) => row.id === eventId);

  return <div className="app-shell">
    <aside className="sidebar">
      <Brand />
      <nav>{tabs.map(([id, label]) => <button key={id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}>{label}</button>)}</nav>
      <div className="account"><span>{session.user.email}</span><button onClick={onLogout}>退出登录</button></div>
    </aside>
    <main className="workspace">
      <header className="topbar">
        <div><h1>{tabs.find(([id]) => id === tab)?.[1]}</h1><p>{currentEvent?.name ?? "请创建第一个评审活动"}</p></div>
        <div className="top-actions">{events.length ? <select value={eventId} onChange={(e) => setEventId(e.target.value)}>{events.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select> : null}<button onClick={() => eventId && void refreshData(eventId)}>刷新</button></div>
      </header>
      <div className="content">
        {notice ? <div className="notice dismissible"><span>{notice}</span><button onClick={() => setNotice("")}>×</button></div> : null}
        {!currentEvent && tab !== "event" ? <EmptyState onCreate={() => setTab("event")} /> : null}
        {tab === "event" ? <EventSection events={events} current={currentEvent} onCreate={createEvent} onSelect={setEventId} onStatus={(status) => currentEvent && run(async () => { await updateRows("events", `id=eq.${currentEvent.id}`, { status }); }, "活动状态已更新。") } onDelete={(id) => run(async () => { await deleteRows("events", `id=eq.${id}`); setEventId(""); setData(null); }, "活动已删除。") } /> : null}
        {currentEvent && data && overview && tab === "overview" ? <OverviewSection data={data} overview={overview} onNavigate={setTab} /> : null}
        {currentEvent && data && tab === "criteria" ? <CriteriaSection data={data} onAdd={addCriterion} onDelete={(id) => run(() => deleteRows("criteria", `id=eq.${id}`), "指标已删除。")} /> : null}
        {currentEvent && data && tab === "projects" ? <ProjectsSection data={data} onAdd={addProject} onDelete={(id) => run(() => deleteRows("projects", `id=eq.${id}`), "项目已删除。")} /> : null}
        {currentEvent && data && tab === "judges" ? <JudgesSection data={data} onAdd={addJudge} onDelete={(id) => run(() => deleteRows("judges", `id=eq.${id}`), "评委已删除。")} onToggle={(judge) => run(async () => { await updateRows("judges", `id=eq.${judge.id}`, { status: judge.status === "ACTIVE" ? "DISABLED" : "ACTIVE" }); }, "评委状态已更新。")} /> : null}
        {currentEvent && data && overview && tab === "progress" ? <ProgressSection data={data} overview={overview} onAssign={() => run(async () => { await assignAll(currentEvent.id, data.judges, data.projects); }, "已为全部启用评委分配全部启用项目。") } onClear={() => run(() => deleteRows("assignments", `event_id=eq.${currentEvent.id}`), "任务和关联评分已清空。")} /> : null}
        {currentEvent && data && overview && tab === "results" ? <ResultsSection data={data} overview={overview} /> : null}
      </div>
    </main>
  </div>;
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return <section className="empty"><span>01</span><h2>先创建第一个评审活动</h2><p>之后依次添加评分指标、项目和评委，再生成任务。</p><button className="primary" onClick={onCreate}>创建活动</button></section>;
}

function EventSection({ events, current, onCreate, onSelect, onStatus, onDelete }: {
  events: ReviewEvent[]; current?: ReviewEvent; onCreate: (event: FormEvent<HTMLFormElement>) => void; onSelect: (id: string) => void;
  onStatus: (status: EventStatus) => void; onDelete: (id: string) => void;
}) {
  return <div className="two-column">
    <section className="panel"><PanelTitle index="01" title="新建活动" detail="设置评审时间与成绩规则" /><form className="form-grid" onSubmit={onCreate}>
      <label className="wide">活动名称<input name="name" required maxLength={120} /></label>
      <label className="wide">活动说明<textarea name="description" rows={3} /></label>
      <label>开始时间<input name="start_time" type="datetime-local" required defaultValue={defaultLocalDate(0)} /></label>
      <label>结束时间<input name="end_time" type="datetime-local" required defaultValue={defaultLocalDate(24 * 7)} /></label>
      <label>去掉最高分数<input name="remove_highest" type="number" min="0" defaultValue="0" /></label>
      <label>去掉最低分数<input name="remove_lowest" type="number" min="0" defaultValue="0" /></label>
      <label>小数位数<select name="decimal_places" defaultValue="2"><option value="0">0</option><option value="1">1</option><option value="2">2</option></select></label>
      <button className="primary wide">新建活动</button>
    </form></section>
    <section className="panel"><PanelTitle index="02" title="已有活动" detail={`共 ${events.length} 个`} /><div className="list">{events.map((row) => <article key={row.id} className={current?.id === row.id ? "list-row selected" : "list-row"} onClick={() => onSelect(row.id)}><div><strong>{row.name}</strong><small>{row.status} · {new Date(row.start_time).toLocaleString("zh-CN")}</small></div><div className="row-actions">{row.id === current?.id ? <><select value={row.status} onClick={(e) => e.stopPropagation()} onChange={(e) => onStatus(e.target.value as EventStatus)}><option value="DRAFT">准备中</option><option value="ACTIVE">评分中</option><option value="FINISHED">已结束</option><option value="LOCKED">已锁定</option></select>{row.status === "DRAFT" ? <button className="danger" onClick={(e) => { e.stopPropagation(); if (confirm("确定删除该活动及其全部数据？")) onDelete(row.id); }}>删除</button> : null}</> : null}</div></article>)}</div></section>
  </div>;
}

function PanelTitle({ index, title, detail }: { index: string; title: string; detail: string }) {
  return <header className="panel-title"><span>{index}</span><div><h2>{title}</h2><p>{detail}</p></div></header>;
}

function OverviewSection({ data, overview, onNavigate }: { data: AdminData; overview: NonNullable<ReturnType<typeof calculateOverview>>; onNavigate: (tab: Tab) => void }) {
  return <div className="stack gap-lg"><section className="hero"><div><span className="status">{overview.event.status}</span><h2>{overview.event.name}</h2><p>{overview.event.description || "暂无活动说明"}</p><button className="primary" onClick={() => onNavigate("progress")}>查看评分进度</button></div><div className="hero-score"><small>总体完成率</small><strong>{overview.completionRate}%</strong><div className="progress"><i style={{ width: `${overview.completionRate}%` }} /></div><span>{overview.completedTasks} / {overview.totalTasks} 项任务</span></div></section><section className="stats"><Stat label="项目" value={data.projects.length} /><Stat label="评委" value={data.judges.length} /><Stat label="评分指标" value={data.criteria.length} /><Stat label="已提交" value={overview.completedTasks} /></section></div>;
}

function Stat({ label, value }: { label: string; value: number }) { return <div className="stat"><small>{label}</small><strong>{value}</strong></div>; }

function CriteriaSection({ data, onAdd, onDelete }: { data: AdminData; onAdd: (event: FormEvent<HTMLFormElement>) => void; onDelete: (id: string) => void }) {
  return <div className="two-column"><section className="panel"><PanelTitle index="01" title="添加评分指标" detail="总分等于各项分数乘以权重之和" /><form className="form-grid" onSubmit={onAdd}><label className="wide">指标名称<input name="name" required /></label><label className="wide">说明<textarea name="description" rows={2} /></label><label>最低分<input name="min_score" type="number" step="any" defaultValue="0" required /></label><label>最高分<input name="max_score" type="number" step="any" defaultValue="20" required /></label><label>评分步长<input name="step" type="number" min="0.01" step="any" defaultValue="1" required /></label><label>权重<input name="weight" type="number" min="0.01" step="any" defaultValue="1" required /></label><label>显示顺序<input name="sort_order" type="number" defaultValue={data.criteria.length + 1} /></label><label>同分优先级<input name="core_rank" type="number" min="0" defaultValue="0" /></label><button className="primary wide">添加指标</button></form></section><section className="panel"><PanelTitle index="02" title="评分指标" detail={`加权指标 ${data.criteria.length} 项`} /><DataList empty="暂无评分指标">{data.criteria.map((row) => <article className="list-row" key={row.id}><div><strong>{row.sort_order}. {row.name}</strong><small>{row.min_score}—{row.max_score} 分 · 步长 {row.step} · 权重 {row.weight}</small></div><button className="danger" onClick={() => confirm("确定删除指标？") && onDelete(row.id)}>删除</button></article>)}</DataList></section></div>;
}

function ProjectsSection({ data, onAdd, onDelete }: { data: AdminData; onAdd: (event: FormEvent<HTMLFormElement>) => void; onDelete: (id: string) => void }) {
  return <div className="two-column"><section className="panel"><PanelTitle index="01" title="添加参评项目" detail="录入编号、团队和展示信息" /><form className="form-grid" onSubmit={onAdd}><label>项目编号<input name="project_number" required placeholder="A01" /></label><label>显示顺序<input name="sort_order" type="number" defaultValue={data.projects.length + 1} /></label><label className="wide">项目名称<input name="project_name" required /></label><label>团队名称<input name="team_name" /></label><label>负责人<input name="leader_name" /></label><label className="wide">项目简介<textarea name="description" rows={3} /></label><button className="primary wide">添加项目</button></form></section><section className="panel"><PanelTitle index="02" title="项目清单" detail={`共 ${data.projects.length} 个项目`} /><DataList empty="暂无项目">{data.projects.map((row) => <article className="list-row" key={row.id}><div><strong>{row.project_number} · {row.project_name}</strong><small>{row.team_name || "未填写团队"}{row.leader_name ? ` · ${row.leader_name}` : ""}</small></div><button className="danger" onClick={() => confirm("确定删除项目及其评分？") && onDelete(row.id)}>删除</button></article>)}</DataList></section></div>;
}

function judgeUrl(token: string): string { return `${location.origin}${location.pathname}?judge=${encodeURIComponent(token)}`; }

function JudgesSection({ data, onAdd, onDelete, onToggle }: { data: AdminData; onAdd: (event: FormEvent<HTMLFormElement>) => void; onDelete: (id: string) => void; onToggle: (judge: Judge) => void }) {
  const [copied, setCopied] = useState("");
  async function copy(judge: Judge) { await navigator.clipboard.writeText(judgeUrl(judge.token)); setCopied(judge.id); setTimeout(() => setCopied(""), 1500); }
  return <div className="two-column"><section className="panel"><PanelTitle index="01" title="添加评委" detail="每位评委自动生成独立安全链接" /><form className="form-grid" onSubmit={onAdd}><label>评委姓名<input name="name" required /></label><label>评委编号<input name="code" required placeholder={`J${String(data.judges.length + 1).padStart(2, "0")}`} /></label><label>手机号<input name="phone" /></label><label>邮箱<input name="email" type="email" /></label><button className="primary wide">添加评委</button></form></section><section className="panel"><PanelTitle index="02" title="评委与链接" detail={`共 ${data.judges.length} 位`} /><DataList empty="暂无评委">{data.judges.map((row) => <article className="list-row judge-row" key={row.id}><div><strong>{row.name} <em>{row.status}</em></strong><small>{row.code} · {row.email || row.phone || "未填写联系方式"}</small></div><div className="row-actions"><button onClick={() => void copy(row)}>{copied === row.id ? "已复制" : "复制链接"}</button><button onClick={() => onToggle(row)}>{row.status === "ACTIVE" ? "停用" : "启用"}</button><button className="danger" onClick={() => confirm("确定删除评委及其评分？") && onDelete(row.id)}>删除</button></div></article>)}</DataList></section></div>;
}

function DataList({ children, empty }: { children: React.ReactNode; empty: string }) { return <div className="list">{Array.isArray(children) && children.length === 0 ? <div className="empty-small">{empty}</div> : children}</div>; }

function ProgressSection({ data, overview, onAssign, onClear }: { data: AdminData; overview: NonNullable<ReturnType<typeof calculateOverview>>; onAssign: () => void; onClear: () => void }) {
  const submitted = new Set(data.submissions.filter((row) => ["SUBMITTED", "LOCKED"].includes(row.status)).map((row) => `${row.judge_id}:${row.project_id}`));
  return <div className="stack gap-lg"><section className="panel"><PanelTitle index="01" title="任务分配" detail="将全部启用项目分配给全部启用评委" /><div className="toolbar"><button className="primary" onClick={onAssign}>全部评委评全部项目</button><button className="danger" onClick={() => confirm("将清除任务、草稿和已提交评分，确定继续？") && onClear()}>清空任务与评分</button></div></section><section className="panel"><PanelTitle index="02" title="实时进度" detail={`完成 ${overview.completedTasks}/${overview.totalTasks}`} /><div className="progress big"><i style={{ width: `${overview.completionRate}%` }} /></div><div className="progress-grid">{data.judges.map((judge) => { const rows = data.assignments.filter((row) => row.judge_id === judge.id); const done = rows.filter((row) => submitted.has(`${row.judge_id}:${row.project_id}`)).length; const percent = rows.length ? Math.round(done / rows.length * 100) : 0; return <article key={judge.id}><div><strong>{judge.name}</strong><span>{done}/{rows.length}</span></div><div className="progress"><i style={{ width: `${percent}%` }} /></div></article>; })}</div></section></div>;
}

function ResultsSection({ data, overview }: { data: AdminData; overview: NonNullable<ReturnType<typeof calculateOverview>> }) {
  function download() {
    const finalRows: Array<Array<string | number | null>> = [["排名", "项目编号", "项目名称", "团队", "总分", "平均分", "最终成绩", "有效评委数"]];
    overview.results.forEach((row) => finalRows.push([row.rank, row.project_number, row.project_name, row.team_name, row.totalScore, row.averageScore, row.finalScore, row.validJudgeCount]));
    const detailRows: Array<Array<string | number | null>> = [["项目编号", "项目名称", "评委", ...data.criteria.map((row) => row.name), "总分", "评审意见"]];
    overview.results.forEach((project) => project.judgeScores.forEach((judge) => detailRows.push([project.project_number, project.project_name, judge.judgeName, ...data.criteria.map((criterion) => judge.criterionScores[criterion.id] ?? null), judge.totalScore, judge.comment])));
    const judgeRows: Array<Array<string | number>> = [["评委编号", "评委姓名", "状态", "评分链接"]];
    data.judges.forEach((row) => judgeRows.push([row.code, row.name, row.status, judgeUrl(row.token)]));
    const bytes = createXlsx([{ name: "最终成绩", rows: finalRows }, { name: "评委详细评分", rows: detailRows }, { name: "评委链接", rows: judgeRows }]);
    const blob = new Blob([bytes.buffer as ArrayBuffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = `${overview.event.name}-评审结果.xlsx`; link.click(); URL.revokeObjectURL(url);
  }
  return <section className="panel"><PanelTitle index="01" title="项目成绩汇总" detail="系统自动计算总分、平均分、去极值成绩和排名" /><div className="table-wrap"><table><thead><tr><th>排名</th><th>项目</th>{data.judges.map((row) => <th key={row.id}>{row.name}</th>)}<th>平均分</th><th>最终成绩</th><th>有效评委</th></tr></thead><tbody>{overview.results.map((row) => <tr key={row.id}><td className="rank">{row.rank ?? "—"}</td><td><strong>{row.project_number} {row.project_name}</strong><small>{row.team_name}</small></td>{data.judges.map((judge) => { const value = row.judgeScores.find((score) => score.judgeId === judge.id); return <td key={judge.id} className={row.removedJudgeIds.includes(judge.id) ? "removed" : ""}>{value?.totalScore ?? "—"}</td>; })}<td>{row.averageScore ?? "—"}</td><td className="final-score">{row.finalScore ?? "—"}</td><td>{row.validJudgeCount}/{row.expectedJudgeCount}</td></tr>)}</tbody></table></div><div className="toolbar end"><button className="primary" disabled={!overview.results.some((row) => row.finalScore !== null)} onClick={download}>下载 Excel 结果</button></div></section>;
}

function JudgeApp({ token }: { token: string }) {
  const [snapshot, setSnapshot] = useState<JudgeSnapshot | null>(null);
  const [activeId, setActiveId] = useState("");
  const [drafts, setDrafts] = useState<Record<string, { scores: Record<string, number | "">; comment: string }>>({});
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    const value = await loadJudgeSnapshot(token);
    setSnapshot(value); setActiveId((id) => value.projects.some((row) => row.id === id) ? id : value.projects[0]?.id ?? "");
    setDrafts(Object.fromEntries(value.projects.map((row) => [row.id, { scores: { ...row.scores }, comment: row.submission?.comment ?? "" }])));
  }, [token]);
  useEffect(() => { void load().catch((error) => setNotice(messageOf(error))); }, [load]);
  const project = snapshot?.projects.find((row) => row.id === activeId);
  const draft = project ? drafts[project.id] ?? { scores: {}, comment: "" } : null;
  const total = useMemo(() => snapshot && draft ? snapshot.criteria.reduce((sum, row) => sum + (typeof draft.scores[row.id] === "number" ? Number(draft.scores[row.id]) * row.weight : 0), 0) : 0, [snapshot, draft]);
  const validation = useMemo(() => {
    if (!snapshot || !draft) return "";
    for (const row of snapshot.criteria) {
      const value = draft.scores[row.id];
      if (row.required && typeof value !== "number") return `请填写“${row.name}”`;
      if (typeof value === "number" && (value < row.minScore || value > row.maxScore)) return `${row.name}超出评分范围`;
    }
    return "";
  }, [snapshot, draft]);

  async function save(submit: boolean) {
    if (!project || !draft || !snapshot || (submit && validation)) return;
    setBusy(true); setNotice("");
    try {
      const result = await saveJudgeScore({ token, projectId: project.id, scores: Object.entries(draft.scores).filter((row): row is [string, number] => typeof row[1] === "number").map(([criterionId, score]) => ({ criterionId, score })), comment: draft.comment, submit });
      setNotice(submit ? `评分已提交，总分 ${result.totalScore}` : `草稿已保存，总分 ${result.totalScore}`);
      await load();
    } catch (error) { setNotice(messageOf(error)); }
    finally { setBusy(false); }
  }

  if (!snapshot) return <main className="center-page"><div className="loader" />{notice || "正在加载评分任务…"}</main>;
  return <div className="judge-page"><header className="judge-header"><Brand /><div><strong>{snapshot.judge.name}</strong><small>{snapshot.judge.code} · 已完成 {snapshot.progress.completed}/{snapshot.progress.total}</small></div></header><main className="judge-layout"><aside className="project-nav"><h2>{snapshot.event.name}</h2><p>请选择项目并独立评分</p>{snapshot.projects.map((row) => <button key={row.id} className={row.id === activeId ? "active" : ""} onClick={() => setActiveId(row.id)}><span>{row.projectNumber}</span><strong>{row.projectName}</strong><small>{row.submission?.status ?? "未评分"}</small></button>)}</aside><section className="score-card">{project && draft ? <><header><div><span className="eyebrow">{project.projectNumber}</span><h1>{project.projectName}</h1><p>{project.teamName || "未填写团队"}{project.leaderName ? ` · 负责人：${project.leaderName}` : ""}</p></div><span className="status">{project.submission?.status ?? "未评分"}</span></header>{!snapshot.event.canScore ? <div className="notice">{snapshot.event.statusMessage}</div> : null}<div className="criteria-list">{snapshot.criteria.map((row, index) => <label key={row.id} className="score-row"><div><span>{String(index + 1).padStart(2, "0")}</span><strong>{row.name}</strong><small>{row.description || `${row.minScore}—${row.maxScore} 分`}</small></div><div className="score-input"><input type="number" min={row.minScore} max={row.maxScore} step={row.step} disabled={!snapshot.event.canScore || project.submission?.status === "LOCKED"} value={draft.scores[row.id] ?? ""} onChange={(e) => setDrafts((current) => ({ ...current, [project.id]: { ...draft, scores: { ...draft.scores, [row.id]: e.target.value === "" ? "" : Number(e.target.value) } } }))} /><span>/ {row.maxScore}</span></div></label>)}</div><label className="comment">评审意见<textarea rows={4} value={draft.comment} disabled={!snapshot.event.canScore || project.submission?.status === "LOCKED"} onChange={(e) => setDrafts((current) => ({ ...current, [project.id]: { ...draft, comment: e.target.value } }))} /></label><footer><div><small>当前总分</small><strong>{total.toFixed(snapshot.event.decimalPlaces)} <em>/ {snapshot.maxScore}</em></strong></div><div>{notice ? <span className="inline-notice">{notice}</span> : null}<button disabled={busy || !snapshot.event.canScore} onClick={() => void save(false)}>保存草稿</button><button className="primary" disabled={busy || !snapshot.event.canScore || Boolean(validation)} onClick={() => confirm(`确认提交 ${total.toFixed(snapshot.event.decimalPlaces)} 分？`) && void save(true)}>确认提交</button></div></footer>{validation ? <div className="validation">{validation}</div> : null}</> : <div className="empty-small">暂无评分任务，请联系管理员。</div>}</section></main></div>;
}

function Root() {
  const token = new URLSearchParams(location.search).get("judge");
  const [session, setSession] = useState<AuthSession | null>(() => loadSession());
  if (token) return <JudgeApp token={token} />;
  if (!session) return <AdminAuth onAuthenticated={setSession} />;
  return <AdminApp session={session} onLogout={() => { signOut(); setSession(null); }} />;
}

createRoot(document.getElementById("root")!).render(<Root />);


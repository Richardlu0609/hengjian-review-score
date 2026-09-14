-- 衡鉴线上项目评审系统（GitHub Pages + Supabase）
-- 在 Supabase Dashboard > SQL Editor 中完整运行本文件一次。

create extension if not exists pgcrypto;

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 120),
  description text not null default '',
  start_time timestamptz not null,
  end_time timestamptz not null,
  status text not null default 'DRAFT' check (status in ('DRAFT', 'ACTIVE', 'FINISHED', 'LOCKED')),
  remove_highest integer not null default 0 check (remove_highest >= 0),
  remove_lowest integer not null default 0 check (remove_lowest >= 0),
  decimal_places integer not null default 2 check (decimal_places between 0 and 4),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_time > start_time)
);

create table if not exists public.criteria (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 120),
  description text not null default '',
  min_score numeric not null default 0,
  max_score numeric not null,
  step numeric not null default 1 check (step > 0),
  weight numeric not null default 1 check (weight > 0),
  sort_order integer not null default 0,
  required boolean not null default true,
  core_rank integer not null default 0 check (core_rank >= 0),
  created_at timestamptz not null default now(),
  check (max_score >= min_score)
);

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  project_number text not null,
  project_name text not null,
  team_name text not null default '',
  leader_name text not null default '',
  description text not null default '',
  sort_order integer not null default 0,
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'DISABLED')),
  created_at timestamptz not null default now(),
  unique (event_id, project_number),
  unique (id, event_id)
);

create table if not exists public.judges (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  name text not null,
  phone text not null default '',
  email text not null default '',
  code text not null,
  token text not null unique check (length(token) >= 32),
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'DISABLED')),
  created_at timestamptz not null default now(),
  unique (event_id, code),
  unique (id, event_id)
);

create table if not exists public.assignments (
  event_id uuid not null references public.events(id) on delete cascade,
  judge_id uuid not null,
  project_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (judge_id, project_id),
  foreign key (judge_id, event_id) references public.judges(id, event_id) on delete cascade,
  foreign key (project_id, event_id) references public.projects(id, event_id) on delete cascade
);

create table if not exists public.submissions (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  judge_id uuid not null,
  project_id uuid not null,
  status text not null default 'DRAFT' check (status in ('DRAFT', 'SUBMITTED', 'LOCKED')),
  total_score numeric not null default 0,
  comment text not null default '' check (length(comment) <= 2000),
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (judge_id, project_id),
  foreign key (judge_id, project_id) references public.assignments(judge_id, project_id) on delete cascade,
  foreign key (judge_id, event_id) references public.judges(id, event_id) on delete cascade,
  foreign key (project_id, event_id) references public.projects(id, event_id) on delete cascade
);

create table if not exists public.scores (
  event_id uuid not null references public.events(id) on delete cascade,
  judge_id uuid not null,
  project_id uuid not null,
  criterion_id uuid not null references public.criteria(id) on delete cascade,
  score numeric not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (judge_id, project_id, criterion_id),
  foreign key (judge_id, project_id) references public.submissions(judge_id, project_id) on delete cascade
);

create index if not exists criteria_event_idx on public.criteria(event_id, sort_order);
create index if not exists projects_event_idx on public.projects(event_id, sort_order);
create index if not exists judges_event_idx on public.judges(event_id, code);
create index if not exists assignments_event_idx on public.assignments(event_id);
create index if not exists submissions_event_idx on public.submissions(event_id, status);
create index if not exists scores_event_idx on public.scores(event_id, project_id);

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists events_touch_updated_at on public.events;
create trigger events_touch_updated_at before update on public.events for each row execute function public.touch_updated_at();
drop trigger if exists submissions_touch_updated_at on public.submissions;
create trigger submissions_touch_updated_at before update on public.submissions for each row execute function public.touch_updated_at();
drop trigger if exists scores_touch_updated_at on public.scores;
create trigger scores_touch_updated_at before update on public.scores for each row execute function public.touch_updated_at();

alter table public.events enable row level security;
alter table public.criteria enable row level security;
alter table public.projects enable row level security;
alter table public.judges enable row level security;
alter table public.assignments enable row level security;
alter table public.submissions enable row level security;
alter table public.scores enable row level security;

drop policy if exists events_owner_all on public.events;
create policy events_owner_all on public.events for all to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists criteria_owner_all on public.criteria;
create policy criteria_owner_all on public.criteria for all to authenticated
  using (exists (select 1 from public.events e where e.id = event_id and e.owner_id = auth.uid()))
  with check (exists (select 1 from public.events e where e.id = event_id and e.owner_id = auth.uid()));

drop policy if exists projects_owner_all on public.projects;
create policy projects_owner_all on public.projects for all to authenticated
  using (exists (select 1 from public.events e where e.id = event_id and e.owner_id = auth.uid()))
  with check (exists (select 1 from public.events e where e.id = event_id and e.owner_id = auth.uid()));

drop policy if exists judges_owner_all on public.judges;
create policy judges_owner_all on public.judges for all to authenticated
  using (exists (select 1 from public.events e where e.id = event_id and e.owner_id = auth.uid()))
  with check (exists (select 1 from public.events e where e.id = event_id and e.owner_id = auth.uid()));

drop policy if exists assignments_owner_all on public.assignments;
create policy assignments_owner_all on public.assignments for all to authenticated
  using (exists (select 1 from public.events e where e.id = event_id and e.owner_id = auth.uid()))
  with check (exists (select 1 from public.events e where e.id = event_id and e.owner_id = auth.uid()));

drop policy if exists submissions_owner_all on public.submissions;
create policy submissions_owner_all on public.submissions for all to authenticated
  using (exists (select 1 from public.events e where e.id = event_id and e.owner_id = auth.uid()))
  with check (exists (select 1 from public.events e where e.id = event_id and e.owner_id = auth.uid()));

drop policy if exists scores_owner_all on public.scores;
create policy scores_owner_all on public.scores for all to authenticated
  using (exists (select 1 from public.events e where e.id = event_id and e.owner_id = auth.uid()))
  with check (exists (select 1 from public.events e where e.id = event_id and e.owner_id = auth.uid()));

revoke all on public.events, public.criteria, public.projects, public.judges, public.assignments, public.submissions, public.scores from anon;
grant select, insert, update, delete on public.events, public.criteria, public.projects, public.judges, public.assignments, public.submissions, public.scores to authenticated;

create or replace function public.judge_snapshot(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_judge public.judges%rowtype;
  v_event public.events%rowtype;
  v_can_score boolean;
  v_message text;
  v_total integer;
  v_completed integer;
begin
  select j.* into v_judge from public.judges j where j.token = p_token and j.status = 'ACTIVE';
  if not found then raise exception '评分链接无效或评委已停用。'; end if;
  select e.* into v_event from public.events e where e.id = v_judge.event_id;

  v_can_score := v_event.status = 'ACTIVE' and now() between v_event.start_time and v_event.end_time;
  v_message := case
    when v_event.status = 'DRAFT' then '活动尚未开始。'
    when v_event.status = 'FINISHED' then '活动已结束。'
    when v_event.status = 'LOCKED' then '成绩已经锁定。'
    when now() < v_event.start_time then '尚未到评分开始时间。'
    when now() > v_event.end_time then '评分时间已经结束。'
    else ''
  end;

  select count(*) into v_total from public.assignments a where a.judge_id = v_judge.id;
  select count(*) into v_completed from public.submissions s where s.judge_id = v_judge.id and s.status in ('SUBMITTED', 'LOCKED');

  return jsonb_build_object(
    'event', jsonb_build_object(
      'id', v_event.id, 'name', v_event.name, 'description', v_event.description,
      'status', v_event.status, 'decimalPlaces', v_event.decimal_places,
      'canScore', v_can_score, 'statusMessage', v_message
    ),
    'judge', jsonb_build_object('id', v_judge.id, 'name', v_judge.name, 'code', v_judge.code),
    'criteria', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'name', c.name, 'description', c.description,
        'minScore', c.min_score, 'maxScore', c.max_score, 'step', c.step,
        'weight', c.weight, 'required', c.required
      ) order by c.sort_order, c.created_at)
      from public.criteria c where c.event_id = v_event.id
    ), '[]'::jsonb),
    'projects', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'projectNumber', p.project_number, 'projectName', p.project_name,
        'teamName', p.team_name, 'leaderName', p.leader_name, 'description', p.description,
        'scores', coalesce((select jsonb_object_agg(sc.criterion_id::text, sc.score) from public.scores sc where sc.judge_id = v_judge.id and sc.project_id = p.id), '{}'::jsonb),
        'submission', (select jsonb_build_object('status', s.status, 'totalScore', s.total_score, 'comment', s.comment, 'submittedAt', s.submitted_at) from public.submissions s where s.judge_id = v_judge.id and s.project_id = p.id)
      ) order by p.sort_order, p.project_number)
      from public.assignments a join public.projects p on p.id = a.project_id
      where a.judge_id = v_judge.id and p.status = 'ACTIVE'
    ), '[]'::jsonb),
    'maxScore', coalesce((select sum(c.max_score * c.weight) from public.criteria c where c.event_id = v_event.id), 0),
    'progress', jsonb_build_object('completed', v_completed, 'total', v_total, 'percent', case when v_total = 0 then 0 else round(v_completed::numeric / v_total * 100, 1) end)
  );
end;
$$;

create or replace function public.save_judge_score(
  p_token text,
  p_project_id uuid,
  p_scores jsonb,
  p_comment text default '',
  p_submit boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_judge public.judges%rowtype;
  v_event public.events%rowtype;
  v_current_status text;
  v_total numeric;
  v_saved_at timestamptz := now();
  v_invalid integer;
begin
  select j.* into v_judge from public.judges j where j.token = p_token and j.status = 'ACTIVE';
  if not found then raise exception '评分链接无效或评委已停用。'; end if;
  select e.* into v_event from public.events e where e.id = v_judge.event_id;
  if v_event.status <> 'ACTIVE' then raise exception '活动当前不允许评分。'; end if;
  if now() < v_event.start_time or now() > v_event.end_time then raise exception '当前不在允许评分的时间范围内。'; end if;
  if not exists (select 1 from public.assignments a where a.judge_id = v_judge.id and a.project_id = p_project_id) then raise exception '该项目未分配给当前评委。'; end if;
  if jsonb_typeof(coalesce(p_scores, '[]'::jsonb)) <> 'array' then raise exception '评分数据格式错误。'; end if;
  if length(coalesce(p_comment, '')) > 2000 then raise exception '评审意见不能超过 2000 字。'; end if;

  select count(*) into v_invalid
  from jsonb_array_elements(coalesce(p_scores, '[]'::jsonb)) x
  left join public.criteria c on c.id::text = x->>'criterionId' and c.event_id = v_event.id
  where c.id is null or jsonb_typeof(x->'score') <> 'number';
  if v_invalid > 0 then raise exception '存在无效的评分指标或分值。'; end if;

  if (select count(*) from jsonb_array_elements(coalesce(p_scores, '[]'::jsonb))) <>
     (select count(distinct x->>'criterionId') from jsonb_array_elements(coalesce(p_scores, '[]'::jsonb)) x)
  then raise exception '同一评分指标不能重复提交。'; end if;

  select count(*) into v_invalid
  from jsonb_array_elements(coalesce(p_scores, '[]'::jsonb)) x
  join public.criteria c on c.id::text = x->>'criterionId' and c.event_id = v_event.id
  where (x->>'score')::numeric < c.min_score
     or (x->>'score')::numeric > c.max_score
     or abs((((x->>'score')::numeric - c.min_score) / c.step) - round(((x->>'score')::numeric - c.min_score) / c.step)) > 0.00000001;
  if v_invalid > 0 then raise exception '分值超出范围或不符合评分步长。'; end if;

  if p_submit and exists (
    select 1 from public.criteria c where c.event_id = v_event.id and c.required
    and not exists (select 1 from jsonb_array_elements(coalesce(p_scores, '[]'::jsonb)) x where x->>'criterionId' = c.id::text)
  ) then raise exception '请完成全部必填评分指标。'; end if;

  select s.status into v_current_status from public.submissions s where s.judge_id = v_judge.id and s.project_id = p_project_id;
  if v_current_status = 'LOCKED' then raise exception '该评分已经锁定，不能修改。'; end if;

  select coalesce(sum((x->>'score')::numeric * c.weight), 0) into v_total
  from jsonb_array_elements(coalesce(p_scores, '[]'::jsonb)) x
  join public.criteria c on c.id::text = x->>'criterionId' and c.event_id = v_event.id;
  v_total := round(v_total, v_event.decimal_places);

  insert into public.submissions(event_id, judge_id, project_id, status, total_score, comment, submitted_at, updated_at)
  values (v_event.id, v_judge.id, p_project_id, case when p_submit then 'SUBMITTED' else 'DRAFT' end, v_total, coalesce(p_comment, ''), case when p_submit then v_saved_at else null end, v_saved_at)
  on conflict (judge_id, project_id) do update set
    status = excluded.status, total_score = excluded.total_score, comment = excluded.comment,
    submitted_at = case when p_submit then v_saved_at else public.submissions.submitted_at end,
    updated_at = v_saved_at;

  delete from public.scores s where s.judge_id = v_judge.id and s.project_id = p_project_id;
  insert into public.scores(event_id, judge_id, project_id, criterion_id, score)
  select v_event.id, v_judge.id, p_project_id, c.id, (x->>'score')::numeric
  from jsonb_array_elements(coalesce(p_scores, '[]'::jsonb)) x
  join public.criteria c on c.id::text = x->>'criterionId' and c.event_id = v_event.id;

  return jsonb_build_object('status', case when p_submit then 'SUBMITTED' else 'DRAFT' end, 'totalScore', v_total, 'savedAt', v_saved_at);
end;
$$;

revoke all on function public.judge_snapshot(text) from public;
revoke all on function public.save_judge_score(text, uuid, jsonb, text, boolean) from public;
grant execute on function public.judge_snapshot(text) to anon, authenticated;
grant execute on function public.save_judge_score(text, uuid, jsonb, text, boolean) to anon, authenticated;


-- Angewendet auf Supabase-Projekt picjzrcacaxlkojwaxol (Migration "neoquiz_schema").
-- Quiz Schwerpunkt Neonatologie: Lernfortschritt und Wiedervorlage (FSRS).
--
-- Das Projekt ist mit anderen Anwendungen geteilt (u. a. dem Meisterquiz mit
-- mq_*). Alle Objekte dieses Quiz tragen deshalb das Präfix nq_.
-- Zugriff ausschließlich über SECURITY-DEFINER-Funktionen mit Lerner-Code
-- (Zufallstoken) als Zugangsschlüssel; die Tabellen haben RLS ohne Policies.

begin;

create table if not exists public.nq_learners (
  code text primary key check (length(code) between 16 and 64),
  display_name text,
  created_at timestamptz not null default now(),
  last_seen timestamptz not null default now()
);

create table if not exists public.nq_attempts (
  id bigserial primary key,
  learner_code text not null references public.nq_learners(code) on delete cascade,
  question_id text not null,
  area_id text not null,
  question_type text not null check (question_type in ('open','mc','calc','case')),
  user_answer text,
  self_score smallint check (self_score between 0 and 3),   -- 0 nicht gewusst, 1 teilweise, 2 gewusst, 3 sicher (FSRS Again/Hard/Good/Easy)
  ai_score smallint check (ai_score between 0 and 100),
  ai_feedback jsonb,
  hints_used smallint not null default 0,
  duration_ms integer,
  created_at timestamptz not null default now()
);
create index if not exists nq_attempts_learner_q on public.nq_attempts (learner_code, question_id, created_at desc);
create index if not exists nq_attempts_learner_area on public.nq_attempts (learner_code, area_id);

create table if not exists public.nq_cards (
  learner_code    text not null references public.nq_learners(code) on delete cascade,
  question_id     text not null,
  area_id         text,
  due             timestamptz not null,
  stability       double precision not null default 0,
  difficulty      double precision not null default 0,
  elapsed_days    double precision not null default 0,
  scheduled_days  double precision not null default 0,
  reps            integer not null default 0,
  lapses          integer not null default 0,
  learning_steps  smallint not null default 0,
  state           smallint not null default 0 check (state between 0 and 3),
  last_review     timestamptz,
  updated_at      timestamptz not null default now(),
  primary key (learner_code, question_id)
);
create index if not exists nq_cards_due on public.nq_cards (learner_code, due);

alter table public.nq_learners enable row level security;
alter table public.nq_attempts enable row level security;
alter table public.nq_cards enable row level security;
revoke all on public.nq_learners from anon, authenticated;
revoke all on public.nq_attempts from anon, authenticated;
revoke all on public.nq_cards from anon, authenticated;
revoke all on sequence public.nq_attempts_id_seq from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Lerner
-- ---------------------------------------------------------------------------
create or replace function public.nq_touch_learner(p_code text, p_name text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_code is null or length(p_code) < 16 or length(p_code) > 64 or p_code !~ '^[A-Za-z0-9_-]+$' then
    raise exception 'ungültiger Lerner-Code';
  end if;
  insert into public.nq_learners(code, display_name) values (p_code, nullif(left(p_name, 80), ''))
  on conflict (code) do update set last_seen = now(), display_name = coalesce(nullif(left(excluded.display_name, 80), ''), public.nq_learners.display_name);
end $$;

-- ---------------------------------------------------------------------------
-- Karten (FSRS)
-- ---------------------------------------------------------------------------
create or replace function public.nq_get_cards(p_code text)
returns table (question_id text, area_id text, due timestamptz, stability double precision,
               difficulty double precision, elapsed_days double precision, scheduled_days double precision,
               reps integer, lapses integer, learning_steps smallint, state smallint,
               last_review timestamptz, updated_at timestamptz)
language sql security definer set search_path = public stable as $$
  select c.question_id, c.area_id, c.due, c.stability, c.difficulty, c.elapsed_days, c.scheduled_days,
         c.reps, c.lapses, c.learning_steps, c.state, c.last_review, c.updated_at
  from public.nq_cards c where c.learner_code = p_code
$$;

/**
 * Kartenzustand speichern. p_card ist das serialisierte FSRS-Objekt aus
 * public/lib/cards.js (due, stability, difficulty, elapsed_days, scheduled_days,
 * reps, lapses, learning_steps, state, last_review).
 */
create or replace function public.nq_save_card(p_code text, p_question_id text, p_area_id text, p_card jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.nq_touch_learner(p_code);
  if p_question_id !~ '^[a-z]+-[0-9]{3}$' or (p_area_id is not null and p_area_id !~ '^[a-z-]{2,40}$') then
    raise exception 'ungültige Frage/Area';
  end if;
  if p_card is null or p_card->>'due' is null then
    raise exception 'p_card ohne due';
  end if;
  insert into public.nq_cards as c (learner_code, question_id, area_id, due, stability, difficulty,
                                    elapsed_days, scheduled_days, reps, lapses, learning_steps, state, last_review, updated_at)
  values (p_code, p_question_id, p_area_id,
          (p_card->>'due')::timestamptz,
          coalesce((p_card->>'stability')::double precision, 0),
          coalesce((p_card->>'difficulty')::double precision, 0),
          coalesce((p_card->>'elapsed_days')::double precision, 0),
          coalesce((p_card->>'scheduled_days')::double precision, 0),
          coalesce((p_card->>'reps')::integer, 0),
          coalesce((p_card->>'lapses')::integer, 0),
          coalesce((p_card->>'learning_steps')::smallint, 0),
          coalesce((p_card->>'state')::smallint, 0),
          nullif(p_card->>'last_review', '')::timestamptz,
          now())
  on conflict (learner_code, question_id) do update set
    area_id = coalesce(excluded.area_id, c.area_id),
    due = excluded.due, stability = excluded.stability, difficulty = excluded.difficulty,
    elapsed_days = excluded.elapsed_days, scheduled_days = excluded.scheduled_days,
    reps = excluded.reps, lapses = excluded.lapses, learning_steps = excluded.learning_steps,
    state = excluded.state, last_review = excluded.last_review, updated_at = now();
end $$;

-- ---------------------------------------------------------------------------
-- Versuche
-- ---------------------------------------------------------------------------
create or replace function public.nq_save_attempt(
  p_code text, p_question_id text, p_area_id text, p_question_type text,
  p_user_answer text, p_self_score smallint, p_ai_score smallint, p_ai_feedback jsonb,
  p_hints_used smallint, p_duration_ms integer, p_card jsonb)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_id bigint;
begin
  perform public.nq_touch_learner(p_code);
  if p_question_id !~ '^[a-z]+-[0-9]{3}$' or p_area_id !~ '^[a-z-]{2,40}$' then
    raise exception 'ungültige Frage/Area';
  end if;
  insert into public.nq_attempts(learner_code, question_id, area_id, question_type, user_answer, self_score, ai_score, ai_feedback, hints_used, duration_ms)
  values (p_code, p_question_id, p_area_id, p_question_type, left(p_user_answer, 8000), p_self_score, p_ai_score, p_ai_feedback, coalesce(p_hints_used, 0), p_duration_ms)
  returning id into v_id;
  if p_card is not null then
    perform public.nq_save_card(p_code, p_question_id, p_area_id, p_card);
  end if;
  return v_id;
end $$;

create or replace function public.nq_get_progress(p_code text)
returns table (question_id text, area_id text, attempts bigint, last_self_score smallint, last_ai_score smallint,
               best_self_score smallint, best_ai_score smallint, last_at timestamptz)
language sql security definer set search_path = public stable as $$
  select a.question_id, a.area_id, count(*) as attempts,
         (array_agg(a.self_score order by a.created_at desc))[1] as last_self_score,
         (array_agg(a.ai_score  order by a.created_at desc))[1] as last_ai_score,
         max(a.self_score) as best_self_score, max(a.ai_score) as best_ai_score,
         max(a.created_at) as last_at
  from public.nq_attempts a
  where a.learner_code = p_code
  group by a.question_id, a.area_id
$$;

create or replace function public.nq_get_history(p_code text, p_question_id text)
returns table (id bigint, user_answer text, self_score smallint, ai_score smallint, ai_feedback jsonb, hints_used smallint, created_at timestamptz)
language sql security definer set search_path = public stable as $$
  select a.id, a.user_answer, a.self_score, a.ai_score, a.ai_feedback, a.hints_used, a.created_at
  from public.nq_attempts a where a.learner_code = p_code and a.question_id = p_question_id
  order by a.created_at desc limit 20
$$;

-- ---------------------------------------------------------------------------
-- Rechte: nur die Funktionen sind für anon/authenticated aufrufbar.
-- ---------------------------------------------------------------------------
revoke all on function public.nq_touch_learner(text, text) from public;
revoke all on function public.nq_get_cards(text) from public;
revoke all on function public.nq_save_card(text, text, text, jsonb) from public;
revoke all on function public.nq_save_attempt(text, text, text, text, text, smallint, smallint, jsonb, smallint, integer, jsonb) from public;
revoke all on function public.nq_get_progress(text) from public;
revoke all on function public.nq_get_history(text, text) from public;
grant execute on function public.nq_touch_learner(text, text) to anon, authenticated;
grant execute on function public.nq_get_cards(text) to anon, authenticated;
grant execute on function public.nq_save_card(text, text, text, jsonb) to anon, authenticated;
grant execute on function public.nq_save_attempt(text, text, text, text, text, smallint, smallint, jsonb, smallint, integer, jsonb) to anon, authenticated;
grant execute on function public.nq_get_progress(text) to anon, authenticated;
grant execute on function public.nq_get_history(text, text) to anon, authenticated;

commit;

create table public.image_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  period  text not null,
  count   integer not null default 0,
  primary key (user_id, period)
);

alter table public.image_usage enable row level security;

create policy "users can view own usage"
  on public.image_usage for select
  using (auth.uid() = user_id);

-- Deliberately NO insert/update/delete policy: the anon-key client cannot write
-- this table directly, so a user cannot reset their own count to bypass the cap.
-- All writes go through the two security-definer functions below — the only
-- write paths — each scoped to the calling user's own row.

-- Atomic check-and-consume. SELECT ... FOR UPDATE locks the user's row, so
-- concurrent requests serialise on it and the daily limit can never be
-- overshot. OUT params return a single record (allowed, used) — not a set.
create function public.try_consume_image_usage(
  p_period    text,
  p_limit     integer,
  out allowed boolean,
  out used    integer
)
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  insert into public.image_usage (user_id, period, count)
  values (auth.uid(), p_period, 0)
  on conflict (user_id, period) do nothing;

  select image_usage.count into used
  from public.image_usage
  where image_usage.user_id = auth.uid() and image_usage.period = p_period
  for update;

  if used >= p_limit then
    allowed := false;
    return;
  end if;

  update public.image_usage
  set count = image_usage.count + 1
  where image_usage.user_id = auth.uid() and image_usage.period = p_period
  returning image_usage.count into used;

  allowed := true;
end;
$$;

-- Refund one slot (floored at 0) when a reserved identification fails
-- downstream, so only successful identifications ultimately count against
-- the cap (consume-on-attempt, refund-on-failure).
create function public.refund_image_usage(p_period text)
  returns integer
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_count integer;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  update public.image_usage
  set count = greatest(image_usage.count - 1, 0)
  where image_usage.user_id = auth.uid() and image_usage.period = p_period
  returning image_usage.count into v_count;

  return coalesce(v_count, 0);
end;
$$;

revoke all on function public.try_consume_image_usage(text, integer) from public;
grant execute on function public.try_consume_image_usage(text, integer) to authenticated;
revoke all on function public.refund_image_usage(text) from public;
grant execute on function public.refund_image_usage(text) to authenticated;

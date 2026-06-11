-- Atomic check-and-consume: locks the user's row so concurrent requests
-- serialise and the daily limit cannot be overshot.
create or replace function public.try_consume_image_usage(
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

-- Refund one slot (floored at 0) when the downstream AI call fails, so only
-- successful identifications count against the cap.
create or replace function public.refund_image_usage(p_period text)
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

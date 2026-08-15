-- Anonymous throttling is durable state. Retain enough history to cover the
-- longest configured window plus a safety margin, while pruning in bounded
-- batches so a large backlog never creates one unbounded delete/lock set.
create index if not exists anonymous_rate_limits_window_started_idx
  on app_private.anonymous_rate_limits(window_started_at);

create function api.prune_anonymous_rate_limits(batch_size integer default 1000)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, app_private
as $$
declare removed integer;
begin
  perform app_private.assert_service_role();
  if batch_size not between 1 and 5000 then
    raise exception 'bounded prune batch required' using errcode = '22023';
  end if;
  with stale as (
    select r.ctid
    from app_private.anonymous_rate_limits r
    where r.window_started_at < now() - interval '2 days'
    order by r.window_started_at
    limit batch_size
    for update skip locked
  ), deleted as (
    delete from app_private.anonymous_rate_limits r
    using stale
    where r.ctid = stale.ctid
    returning r.ctid
  )
  select count(*)::integer into removed from deleted;
  return removed;
end;
$$;

revoke execute on function api.prune_anonymous_rate_limits(integer)
  from public, anon, authenticated;
grant execute on function api.prune_anonymous_rate_limits(integer)
  to service_role;

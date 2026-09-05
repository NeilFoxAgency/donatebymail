-- Publish scheduled editorial work in bounded batches so a backlog cannot
-- create an unbounded lock set or response payload in one cron invocation.
create or replace function api.publish_due_articles()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, app_private
as $$
declare published jsonb;
begin
  perform app_private.assert_service_role();
  with due as (
    select a.id, a.scheduled_revision_id
    from app_private.articles a
    where a.status = 'scheduled' and a.scheduled_publish_at <= now()
    order by a.scheduled_publish_at, a.id
    limit 500
    for update skip locked
  ), changed as (
    update app_private.articles a
    set status = 'published', published_revision_id = a.scheduled_revision_id,
      scheduled_revision_id = null, scheduled_publish_at = null, updated_at = now()
    from due
    where a.id = due.id
    returning a.id, a.published_revision_id
  )
  select coalesce(jsonb_agg(jsonb_build_object('articleId', id, 'revisionId', published_revision_id)), '[]'::jsonb)
    into published
  from changed;
  return published;
end;
$$;

revoke execute on function api.publish_due_articles() from public, anon, authenticated;
grant execute on function api.publish_due_articles() to service_role;

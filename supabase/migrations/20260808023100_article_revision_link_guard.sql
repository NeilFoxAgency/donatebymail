-- Keep article revision pointers tenant-correct and publication-safe even when
-- a future service-only path writes the tables without using the agent RPC.

create or replace function app_private.assert_article_revision_link(
  article_id_value uuid,
  revision_id_value uuid,
  link_name text
)
returns void
language plpgsql
stable
set search_path = pg_catalog, app_private
as $$
declare
  revision_article_id uuid;
  revision_blocks jsonb;
begin
  if revision_id_value is null then
    return;
  end if;

  select r.article_id, r.content_blocks
    into revision_article_id, revision_blocks
  from app_private.article_revisions r
  where r.id = revision_id_value;

  if not found or revision_article_id is distinct from article_id_value then
    raise exception '% must reference a revision owned by the same article', link_name
      using errcode = '23514';
  end if;
  if not app_private.validate_article_blocks(revision_blocks) then
    raise exception '% must reference a non-empty validated revision', link_name
      using errcode = '23514';
  end if;
end;
$$;

create or replace function app_private.validate_article_revision_links()
returns trigger
language plpgsql
set search_path = pg_catalog, app_private
as $$
begin
  perform app_private.assert_article_revision_link(new.id, new.current_revision_id, 'current revision');
  perform app_private.assert_article_revision_link(new.id, new.scheduled_revision_id, 'scheduled revision');
  perform app_private.assert_article_revision_link(new.id, new.published_revision_id, 'published revision');
  return new;
end;
$$;

drop trigger if exists articles_revision_link_guard on app_private.articles;
create trigger articles_revision_link_guard
before insert or update on app_private.articles
for each row execute function app_private.validate_article_revision_links();

revoke all on function app_private.assert_article_revision_link(uuid, uuid, text), app_private.validate_article_revision_links() from public, anon, authenticated;
grant execute on function app_private.assert_article_revision_link(uuid, uuid, text), app_private.validate_article_revision_links() to service_role;

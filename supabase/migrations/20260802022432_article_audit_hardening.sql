-- Harden the editorial state machine and keep automated publication auditable.

create or replace function app_private.prevent_archived_article_publish()
returns trigger
language plpgsql
set search_path = pg_catalog, app_private
as $$
begin
  if old.status = 'archived' and new.status = 'published' then
    raise exception 'archived article cannot be published' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists articles_archived_publish_guard on app_private.articles;
create trigger articles_archived_publish_guard
before update on app_private.articles
for each row execute function app_private.prevent_archived_article_publish();

create or replace function app_private.audit_scheduled_article_publish()
returns trigger
language plpgsql
set search_path = pg_catalog, app_private
as $$
begin
  if old.status = 'scheduled' and new.status = 'published' then
    insert into app_private.audit_events(
      actor,
      actor_ref,
      action_name,
      entity_type,
      entity_id,
      reason_code,
      redacted_changes,
      metadata
    ) values (
      'system',
      'scheduled-article-publisher',
      'article.publish_scheduled',
      'article',
      new.id,
      'scheduled_revision_due',
      jsonb_build_object('revision_id', new.published_revision_id),
      jsonb_build_object(
        'scheduled_at', old.scheduled_publish_at,
        'pii_redacted', true
      )
    );
  end if;
  return new;
end;
$$;

drop trigger if exists articles_scheduled_publish_audit on app_private.articles;
create trigger articles_scheduled_publish_audit
after update on app_private.articles
for each row execute function app_private.audit_scheduled_article_publish();

revoke all on function app_private.prevent_archived_article_publish() from public, anon, authenticated;
revoke all on function app_private.audit_scheduled_article_publish() from public, anon, authenticated;
grant execute on function app_private.prevent_archived_article_publish() to service_role;
grant execute on function app_private.audit_scheduled_article_publish() to service_role;

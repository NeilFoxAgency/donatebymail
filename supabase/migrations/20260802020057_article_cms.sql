-- Article CMS foundation for a public editorial surface and bounded agent
-- publishing workflow. Content is stored as typed blocks, never executable HTML.

create or replace function app_private.validate_article_blocks(blocks jsonb)
returns boolean language plpgsql immutable
set search_path = pg_catalog, app_private as $$
declare block jsonb; block_type text; item text;
begin
  if jsonb_typeof(blocks) <> 'array' or jsonb_array_length(blocks) > 50 then return false; end if;
  for block in select value from jsonb_array_elements(blocks) loop
    if jsonb_typeof(block) <> 'object' then return false; end if;
    block_type := block->>'type';
    if block_type in ('paragraph', 'quote') then
      if jsonb_typeof(block->'text') <> 'string' or char_length(block->>'text') not between 1 and 4000 then return false; end if;
    elsif block_type = 'heading' then
      if jsonb_typeof(block->'text') <> 'string' or char_length(block->>'text') not between 1 and 180 then return false; end if;
      if coalesce((block->>'level')::integer, 0) not between 2 and 4 then return false; end if;
    elsif block_type = 'list' then
      if jsonb_typeof(block->'items') <> 'array' or jsonb_array_length(block->'items') not between 1 and 24 then return false; end if;
      for item in select value #>> '{}' from jsonb_array_elements(block->'items') loop
        if char_length(item) not between 1 and 400 then return false; end if;
      end loop;
    elsif block_type = 'link' then
      if jsonb_typeof(block->'label') <> 'string' or char_length(block->>'label') not between 1 and 180 then return false; end if;
      if jsonb_typeof(block->'href') <> 'string' or char_length(block->>'href') not between 1 and 1000 then return false; end if;
      if (block->>'href') !~ '^(/|https://)[^[:space:]<>"'']+$' then return false; end if;
    else
      return false;
    end if;
  end loop;
  return true;
exception when others then
  return false;
end $$;

create type app_private.article_status as enum ('draft', 'scheduled', 'published', 'archived');

create table app_private.articles (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' and char_length(slug) between 3 and 120),
  status app_private.article_status not null default 'draft',
  current_revision_id uuid,
  scheduled_revision_id uuid,
  published_revision_id uuid,
  scheduled_publish_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_by_agent text,
  updated_by_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'scheduled') = (scheduled_revision_id is not null and scheduled_publish_at is not null)),
  check (status <> 'published' or published_revision_id is not null)
);

create table app_private.article_revisions (
  id uuid primary key default gen_random_uuid(),
  article_id uuid not null references app_private.articles(id) on delete cascade,
  version integer not null check (version > 0),
  title text not null check (char_length(title) between 1 and 180),
  excerpt text not null check (char_length(excerpt) between 1 and 500),
  content_blocks jsonb not null check (app_private.validate_article_blocks(content_blocks)),
  seo_title text check (seo_title is null or char_length(seo_title) between 1 and 180),
  seo_description text check (seo_description is null or char_length(seo_description) between 1 and 320),
  author_name text not null default 'Donate by Mail' check (char_length(author_name) between 1 and 120),
  content_hash text not null check (content_hash ~ '^[a-f0-9]{64}$'),
  created_by uuid references auth.users(id) on delete set null,
  created_by_agent text,
  created_at timestamptz not null default now(),
  unique (article_id, version)
);

alter table app_private.articles
  add constraint articles_current_revision_fk foreign key (current_revision_id)
    references app_private.article_revisions(id) on delete restrict,
  add constraint articles_scheduled_revision_fk foreign key (scheduled_revision_id)
    references app_private.article_revisions(id) on delete restrict,
  add constraint articles_published_revision_fk foreign key (published_revision_id)
    references app_private.article_revisions(id) on delete restrict;

create index articles_status_schedule_idx on app_private.articles (status, scheduled_publish_at) where status = 'scheduled';
create index article_revisions_article_version_idx on app_private.article_revisions (article_id, version desc);

alter table app_private.articles enable row level security;
alter table app_private.article_revisions enable row level security;
revoke all on app_private.articles, app_private.article_revisions from public, anon, authenticated;
grant select, insert, update on app_private.articles, app_private.article_revisions to service_role;

create or replace function app_private.article_content_hash(
  title_value text, excerpt_value text, blocks_value jsonb,
  seo_title_value text, seo_description_value text, author_name_value text
) returns text language sql immutable
set search_path = pg_catalog, app_private as $$
  select encode(extensions.digest(convert_to(jsonb_build_object(
    'title', title_value, 'excerpt', excerpt_value, 'blocks', blocks_value,
    'seoTitle', seo_title_value, 'seoDescription', seo_description_value,
    'authorName', author_name_value
  )::text, 'utf8'), 'sha256'), 'hex')
$$;

create or replace function api.get_published_articles()
returns jsonb language plpgsql security definer
set search_path = pg_catalog, app_private as $$
declare result jsonb;
begin
  perform app_private.assert_service_role();
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', a.id, 'slug', a.slug, 'title', r.title, 'excerpt', r.excerpt,
    'authorName', r.author_name, 'publishedAt', r.created_at,
    'seoTitle', r.seo_title, 'seoDescription', r.seo_description
  ) order by r.created_at desc), '[]'::jsonb)
  into result from app_private.articles a
  join app_private.article_revisions r on r.id = a.published_revision_id
  where a.status = 'published';
  return result;
end $$;

create or replace function api.get_published_article(candidate_slug text)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, app_private as $$
declare result jsonb;
begin
  perform app_private.assert_service_role();
  select jsonb_build_object(
    'id', a.id, 'slug', a.slug, 'title', r.title, 'excerpt', r.excerpt,
    'contentBlocks', r.content_blocks, 'authorName', r.author_name,
    'publishedAt', r.created_at, 'seoTitle', r.seo_title,
    'seoDescription', r.seo_description, 'contentHash', r.content_hash,
    'revisionId', r.id, 'version', r.version
  ) into result from app_private.articles a
  join app_private.article_revisions r on r.id = a.published_revision_id
  where a.slug = lower(trim(candidate_slug)) and a.status = 'published';
  return result;
end $$;

create or replace function api.agent_execute_article_command(
  decision_id_value uuid, agent_identity text, command_value text,
  target_id_value uuid, payload_value jsonb
) returns jsonb language plpgsql security definer
set search_path = pg_catalog, app_private as $$
declare decision_row app_private.action_decisions%rowtype;
  result jsonb; article_id_value uuid; revision_id_value uuid; next_version integer;
  slug_value text; title_value text; excerpt_value text; blocks_value jsonb;
  seo_title_value text; seo_description_value text; author_name_value text;
  scheduled_at timestamptz; canonical_hash text;
begin
  perform app_private.assert_service_role();
  select * into decision_row from app_private.action_decisions where id = decision_id_value
    and actor = 'agent' and actor_ref = agent_identity for update;
  if decision_row.id is null then raise exception 'agent decision required' using errcode = '42501'; end if;
  if decision_row.command_name <> command_value or decision_row.target_id is distinct from target_id_value then raise exception 'agent decision target mismatch' using errcode = '42501'; end if;
  if decision_row.outcome <> 'ALLOW_AUTOMATICALLY' then raise exception 'agent command is not automatically allowed' using errcode = '42501'; end if;
  if exists(select 1 from app_private.action_execution_results where action_decision_id = decision_row.id and status = 'executed') then
    select result_metadata into result from app_private.action_execution_results where action_decision_id = decision_row.id order by created_at desc limit 1;
    return jsonb_build_object('executed', true, 'replayed', true, 'result', coalesce(result, '{}'::jsonb));
  end if;
  if jsonb_typeof(coalesce(payload_value, '{}'::jsonb)) <> 'object' then raise exception 'agent payload must be an object' using errcode = '22023'; end if;

  if command_value = 'create_article_draft' then
    slug_value := lower(trim(payload_value->>'slug')); title_value := nullif(trim(payload_value->>'title'), ''); excerpt_value := nullif(trim(payload_value->>'excerpt'), '');
    blocks_value := coalesce(payload_value->'contentBlocks', '[]'::jsonb); seo_title_value := nullif(trim(payload_value->>'seoTitle'), ''); seo_description_value := nullif(trim(payload_value->>'seoDescription'), ''); author_name_value := coalesce(nullif(trim(payload_value->>'authorName'), ''), 'Donate by Mail');
    if slug_value !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' or char_length(slug_value) not between 3 and 120 or title_value is null or char_length(title_value) > 180 or excerpt_value is null or char_length(excerpt_value) > 500 or not app_private.validate_article_blocks(blocks_value) then raise exception 'bounded article draft required' using errcode = '22023'; end if;
    insert into app_private.articles(slug, status, created_by_agent, updated_by_agent) values(slug_value, 'draft', agent_identity, agent_identity) returning id into article_id_value;
    canonical_hash := app_private.article_content_hash(title_value, excerpt_value, blocks_value, seo_title_value, seo_description_value, author_name_value);
    insert into app_private.article_revisions(article_id, version, title, excerpt, content_blocks, seo_title, seo_description, author_name, content_hash, created_by_agent) values(article_id_value, 1, title_value, excerpt_value, blocks_value, seo_title_value, seo_description_value, author_name_value, canonical_hash, agent_identity) returning id into revision_id_value;
    update app_private.articles set current_revision_id = revision_id_value, updated_at = now() where id = article_id_value;
    result := jsonb_build_object('articleId', article_id_value, 'revisionId', revision_id_value, 'slug', slug_value, 'version', 1, 'status', 'draft', 'contentHash', canonical_hash);
  elsif command_value = 'update_article_content' then
    article_id_value := target_id_value; title_value := nullif(trim(payload_value->>'title'), ''); excerpt_value := nullif(trim(payload_value->>'excerpt'), ''); blocks_value := coalesce(payload_value->'contentBlocks', '[]'::jsonb); seo_title_value := nullif(trim(payload_value->>'seoTitle'), ''); seo_description_value := nullif(trim(payload_value->>'seoDescription'), ''); author_name_value := coalesce(nullif(trim(payload_value->>'authorName'), ''), 'Donate by Mail');
    if article_id_value is null or title_value is null or char_length(title_value) > 180 or excerpt_value is null or char_length(excerpt_value) > 500 or not app_private.validate_article_blocks(blocks_value) or not exists(select 1 from app_private.articles where id = article_id_value and status <> 'archived') then raise exception 'editable article and bounded content required' using errcode = '22023'; end if;
    select coalesce(max(version), 0) + 1 into next_version from app_private.article_revisions where article_id = article_id_value;
    canonical_hash := app_private.article_content_hash(title_value, excerpt_value, blocks_value, seo_title_value, seo_description_value, author_name_value);
    insert into app_private.article_revisions(article_id, version, title, excerpt, content_blocks, seo_title, seo_description, author_name, content_hash, created_by_agent) values(article_id_value, next_version, title_value, excerpt_value, blocks_value, seo_title_value, seo_description_value, author_name_value, canonical_hash, agent_identity) returning id into revision_id_value;
    update app_private.articles set current_revision_id = revision_id_value, status = case when status = 'published' then 'draft' else status end, updated_by_agent = agent_identity, updated_at = now() where id = article_id_value;
    result := jsonb_build_object('articleId', article_id_value, 'revisionId', revision_id_value, 'version', next_version, 'status', 'draft', 'contentHash', canonical_hash);
  elsif command_value = 'schedule_article_publication' then
    article_id_value := target_id_value; revision_id_value := nullif(payload_value->>'revisionId', '')::uuid; scheduled_at := nullif(payload_value->>'scheduledAt', '')::timestamptz;
    if article_id_value is null or revision_id_value is null or scheduled_at is null or scheduled_at <= now() or scheduled_at > now() + interval '2 years' or not exists(select 1 from app_private.article_revisions where id = revision_id_value and article_id = article_id_value) or not exists(select 1 from app_private.articles where id = article_id_value and status <> 'archived') then raise exception 'future schedule requires an exact article revision' using errcode = '22023'; end if;
    update app_private.articles set status = 'scheduled', scheduled_revision_id = revision_id_value, scheduled_publish_at = scheduled_at, updated_by_agent = agent_identity, updated_at = now() where id = article_id_value;
    result := jsonb_build_object('articleId', article_id_value, 'revisionId', revision_id_value, 'scheduledAt', scheduled_at, 'status', 'scheduled');
  elsif command_value = 'publish_article' then
    article_id_value := target_id_value; revision_id_value := nullif(payload_value->>'revisionId', '')::uuid;
    if article_id_value is null or revision_id_value is null or not exists(select 1 from app_private.article_revisions where id = revision_id_value and article_id = article_id_value) then raise exception 'exact article revision required' using errcode = '22023'; end if;
    update app_private.articles set status = 'published', published_revision_id = revision_id_value, scheduled_revision_id = null, scheduled_publish_at = null, updated_by_agent = agent_identity, updated_at = now() where id = article_id_value;
    result := jsonb_build_object('articleId', article_id_value, 'revisionId', revision_id_value, 'status', 'published');
  else
    raise exception 'unsupported article command' using errcode = '22023';
  end if;
  insert into app_private.audit_events(actor, actor_ref, action_name, entity_type, entity_id, reason_code, redacted_changes, metadata) values('agent', agent_identity, 'agent.' || command_value, 'article', article_id_value, 'policy_allowed_article_change', jsonb_build_object('revision_id', revision_id_value), jsonb_build_object('pii_redacted', true));
  update app_private.agent_actions set status = 'completed', updated_at = now() where action_decision_id = decision_row.id;
  insert into app_private.action_execution_results(action_decision_id, status, executor, executor_ref, result_metadata, verification_metadata) values(decision_row.id, 'executed', 'agent', agent_identity, coalesce(result, '{}'::jsonb), jsonb_build_object('server_validated', true));
  return jsonb_build_object('executed', true, 'replayed', false, 'result', coalesce(result, '{}'::jsonb));
exception when others then
  if decision_row.id is not null then
    update app_private.agent_actions set status = 'failed', updated_at = now() where action_decision_id = decision_row.id;
    insert into app_private.action_execution_results(action_decision_id, status, executor, executor_ref, result_metadata, verification_metadata) values(decision_row.id, 'failed', 'agent', agent_identity, jsonb_build_object('error_code', SQLSTATE), jsonb_build_object('server_validated', false));
  end if;
  raise;
end $$;

create or replace function api.publish_due_articles()
returns jsonb language plpgsql security definer
set search_path = pg_catalog, app_private as $$
declare published jsonb;
begin
  perform app_private.assert_service_role();
  with due as (
    select a.id, a.scheduled_revision_id from app_private.articles a where a.status = 'scheduled' and a.scheduled_publish_at <= now() for update skip locked
  ), changed as (
    update app_private.articles a set status = 'published', published_revision_id = a.scheduled_revision_id, scheduled_revision_id = null, scheduled_publish_at = null, updated_at = now() from due where a.id = due.id returning a.id, a.published_revision_id
  ) select coalesce(jsonb_agg(jsonb_build_object('articleId', id, 'revisionId', published_revision_id)), '[]'::jsonb) into published from changed;
  return published;
end $$;

revoke all on function app_private.validate_article_blocks(jsonb), app_private.article_content_hash(text,text,jsonb,text,text,text) from public, anon, authenticated;
revoke all on function api.get_published_articles(), api.get_published_article(text), api.agent_execute_article_command(uuid,text,text,uuid,jsonb), api.publish_due_articles() from public, anon, authenticated;
grant execute on function api.get_published_articles(), api.get_published_article(text), api.agent_execute_article_command(uuid,text,text,uuid,jsonb), api.publish_due_articles() to service_role;

insert into app_private.semantic_command_registry(command_name, human_only, description) values
  ('create_article_draft', false, 'Create a bounded typed article draft'),
  ('update_article_content', false, 'Create a bounded article revision'),
  ('schedule_article_publication', false, 'Schedule an exact article revision'),
  ('publish_article', false, 'Publish an exact article revision')
on conflict (command_name) do update set human_only = excluded.human_only, description = excluded.description;

insert into app_private.action_policy_rules(policy_version_id, command_name, actor, risk_levels, outcome, rationale_code, priority)
select v.id, seed.command_name, 'agent'::app_private.actor_kind, seed.risk_levels, seed.outcome::app_private.action_policy_outcome, seed.rationale_code, seed.priority
from app_private.action_policy_versions v
cross join (values
  ('create_article_draft', array['low']::app_private.risk_level[], 'ALLOW_AUTOMATICALLY', 'article_draft_auto_allowed', 220),
  ('update_article_content', array['low','moderate']::app_private.risk_level[], 'ALLOW_AUTOMATICALLY', 'article_revision_auto_allowed', 220),
  ('schedule_article_publication', array['low','moderate']::app_private.risk_level[], 'ALLOW_AUTOMATICALLY', 'article_schedule_auto_allowed', 220),
  ('publish_article', array['low','moderate']::app_private.risk_level[], 'REQUIRE_APPROVAL', 'article_publication_review_required', 220)
) as seed(command_name, risk_levels, outcome, rationale_code, priority)
where v.policy_key = 'beta_agent_actions' and v.lifecycle = 'active'
  and not exists (select 1 from app_private.action_policy_rules r where r.policy_version_id = v.id and r.command_name = seed.command_name);

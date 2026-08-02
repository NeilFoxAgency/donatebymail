begin;
create extension if not exists pgtap with schema extensions;
select plan(25);

select has_table('app_private', 'articles', 'articles remain in the private schema');
select has_table('app_private', 'article_revisions', 'article revisions remain private');
select has_function('api', 'get_published_articles', array[]::text[], 'published article list uses a narrow RPC');
select has_function('api', 'get_published_article', array['text'], 'published article detail uses a narrow RPC');
select has_function('api', 'agent_execute_article_command', array['uuid','text','text','uuid','jsonb'], 'article writes use a semantic executor');
select has_function('api', 'publish_due_articles', array[]::text[], 'scheduled publishing uses a narrow scheduler RPC');
select is(has_table_privilege('anon', 'app_private.articles', 'select'), false, 'anonymous callers cannot read article drafts');
select is(has_function_privilege('anon', 'api.get_published_articles()', 'execute'), false, 'anonymous callers cannot invoke the private article RPC directly');
select is(app_private.validate_article_blocks('[{"type":"paragraph","text":"Safe content"}]'::jsonb), true, 'typed paragraph blocks validate');
select is(app_private.validate_article_blocks('[{"type":"html","html":"<script>bad</script>"}]'::jsonb), false, 'unknown executable block types are rejected');

select set_config('request.jwt.claim.role', 'service_role', true);
insert into auth.users(id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values ('92000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','article-agent@example.test','',now(),now(),now());

create temporary table article_create_decision as
select api.evaluate_agent_command('article-agent','create_article_draft','article',null,'low','{}',repeat('1',64),gen_random_uuid(),'article-cms-create-1') result;
select is((select result->>'outcome' from article_create_decision), 'ALLOW_AUTOMATICALLY', 'article draft creation is policy-allowed');
create temporary table article_create_execution as
select api.agent_execute_article_command((select (result->>'decisionId')::uuid from article_create_decision),'article-agent','create_article_draft',null,
  '{"slug":"phone-data-basics","title":"Phone data basics","excerpt":"A short guide for preparing an old phone.","contentBlocks":[{"type":"paragraph","text":"Back up your data before mailing."}],"seoTitle":"Phone data basics | Donate by Mail","seoDescription":"Prepare an old phone for donation."}'::jsonb) result;
select is((select result->'result'->>'status' from article_create_execution), 'draft', 'created article remains a draft');
select is((select count(*)::integer from app_private.articles where slug='phone-data-basics'), 1, 'one article identity is created');
select is((select count(*)::integer from app_private.article_revisions where article_id=(select (result->'result'->>'articleId')::uuid from article_create_execution)), 1, 'article starts with one immutable revision');

create temporary table article_update_decision as
select api.evaluate_agent_command('article-agent','update_article_content','article',(select (result->'result'->>'articleId')::uuid from article_create_execution),'low','{}',repeat('2',64),gen_random_uuid(),'article-cms-update-1') result;
select lives_ok(format($$select api.agent_execute_article_command(%L::uuid,'article-agent','update_article_content',%L::uuid,%L::jsonb)$$,
  (select (result->>'decisionId')::uuid from article_update_decision), (select (result->'result'->>'articleId')::uuid from article_create_execution),
  '{"title":"Phone data basics, updated","excerpt":"Updated preparation guidance.","contentBlocks":[{"type":"heading","level":2,"text":"Before you mail"},{"type":"paragraph","text":"Back up and sign out first."}]}'
), 'article updates create a new validated revision');
select is((select count(*)::integer from app_private.article_revisions where article_id=(select (result->'result'->>'articleId')::uuid from article_create_execution)), 2, 'article revision history is append-only');

create temporary table article_schedule_decision as
select api.evaluate_agent_command('article-agent','schedule_article_publication','article',(select (result->'result'->>'articleId')::uuid from article_create_execution),'moderate','{}',repeat('3',64),gen_random_uuid(),'article-cms-schedule-1') result;
select is((select result->>'outcome' from article_schedule_decision), 'ALLOW_AUTOMATICALLY', 'article scheduling is policy-allowed');
select lives_ok(format($$select api.agent_execute_article_command(%L::uuid,'article-agent','schedule_article_publication',%L::uuid,%L::jsonb)$$,
  (select (result->>'decisionId')::uuid from article_schedule_decision), (select (result->'result'->>'articleId')::uuid from article_create_execution),
  format('{"revisionId":"%s","scheduledAt":"%s"}', (select id from app_private.article_revisions where article_id=(select (result->'result'->>'articleId')::uuid from article_create_execution) order by version desc limit 1), (now()+interval '1 hour')::text)
), 'scheduling records an exact future revision');
select is((select status::text from app_private.articles where slug='phone-data-basics'), 'scheduled', 'article status becomes scheduled');
select is((select scheduled_revision_id from app_private.articles where slug='phone-data-basics'), (select id from app_private.article_revisions where article_id=(select (result->'result'->>'articleId')::uuid from article_create_execution) order by version desc limit 1), 'scheduled revision is explicit');

update app_private.articles set scheduled_publish_at=now()-interval '1 second' where slug='phone-data-basics';
select lives_ok('select api.publish_due_articles()', 'due article publishing succeeds');
select is((select status::text from app_private.articles where slug='phone-data-basics'), 'published', 'due article becomes published');
select is((api.get_published_article('phone-data-basics')->>'title'), 'Phone data basics, updated', 'public detail returns only the published revision');
select is(jsonb_array_length(api.get_published_articles()), 1, 'public list includes the published article');
select is((select result->>'outcome' from (select api.evaluate_agent_command('article-agent','publish_article','article',(select (result->'result'->>'articleId')::uuid from article_create_execution),'moderate','{}',repeat('4',64),gen_random_uuid(),'article-cms-publish-1') result) decision), 'REQUIRE_APPROVAL', 'immediate article publication remains approval-gated');

select * from finish();
rollback;

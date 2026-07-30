begin;
create extension if not exists pgtap with schema extensions;
select plan(15);
select set_config('request.jwt.claim.role','service_role',true);

insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at) values
('a4000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','asset-partner@example.com','',now(),now(),now()),
('a4000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','asset-staff@example.com','',now(),now(),now());
insert into app_private.profiles(user_id)
select id from auth.users where id::text like 'a4000000-%';
insert into app_private.staff_memberships(user_id,role,status,activated_at)
values('a4000000-0000-4000-8000-000000000002','admin','active',now());
insert into app_private.organizations(id,name,slug,status,created_by)
values('a4000000-0000-4000-8000-000000000010','Asset Partner','asset-partner','active','a4000000-0000-4000-8000-000000000002');
insert into app_private.organization_memberships(organization_id,user_id,role,status,activated_at)
values('a4000000-0000-4000-8000-000000000010','a4000000-0000-4000-8000-000000000001','partner_admin','active',now());
insert into app_private.charities(id,pledge_id,canonical_name,status,verified_by,verified_at)
values('a4000000-0000-4000-8000-000000000011','a4000000-0000-4000-8000-000000000012','Asset Charity','verified','a4000000-0000-4000-8000-000000000002',now());
insert into app_private.organization_charities(organization_id,charity_id,status,verified_by,verified_at)
values('a4000000-0000-4000-8000-000000000010','a4000000-0000-4000-8000-000000000011','verified','a4000000-0000-4000-8000-000000000002',now());

select has_table('app_private','campaign_assets','campaign asset metadata is stored privately');
select is((select count(*) from pg_constraint where conname='campaign_assets_deferred'
  and conrelid='app_private.campaign_revisions'::regclass),0::bigint,
  'campaign revisions no longer have the obsolete deferred-asset constraint');

select lives_ok($$select api.partner_create_campaign(
  'a4000000-0000-4000-8000-000000000001','a4000000-0000-4000-8000-000000000010',
  'asset-campaign','Asset Campaign','a4000000-0000-4000-8000-000000000011',
  'Support Asset Charity','Send an old phone.','A controlled campaign story.','Donate a Phone',repeat('a',64))$$,
  'partner creates a campaign eligible for controlled assets');

create temporary table asset_fixture as
select (api.partner_create_campaign_asset(
  'a4000000-0000-4000-8000-000000000001',
  (select id from app_private.campaigns where slug='asset-campaign'),
  'hero_image',
  'campaigns/'||(select id::text from app_private.campaigns where slug='asset-campaign')||'/'||gen_random_uuid()||'.webp',
  'image/webp',12345,'Asset campaign hero image',false,repeat('a',64))) result;
select isnt((select result->>'id' from asset_fixture),null,'valid controlled asset metadata is persisted');
select is((select length((select result->>'contentSha256' from asset_fixture))),64,'asset stores a SHA-256 digest');
select is((select (result->>'contentSha256') <> repeat('0',64) from asset_fixture),true,'asset digest is not the legacy all-zero marker');
select is(to_regprocedure('api.partner_create_campaign_asset(uuid,uuid,text,text,text,integer,text)'),null,'legacy digest-less asset RPC is removed');
select throws_ok($$select api.partner_create_campaign_asset(
  'a4000000-0000-4000-8000-000000000001',(select id from app_private.campaigns where slug='asset-campaign'),
  'logo','campaigns/'||(select id::text from app_private.campaigns where slug='asset-campaign')||'/'||gen_random_uuid()||'.png',
  'image/png',100,'Logo',false,repeat('b',64))$$,'22023','unsupported campaign asset kind','asset kinds are allowlisted');
select throws_ok($$select api.partner_create_campaign_asset(
  'a4000000-0000-4000-8000-000000000001',(select id from app_private.campaigns where slug='asset-campaign'),
  'hero_image','campaigns/not-the-campaign/not-a-file.png','image/png',100,'Wrong path',false,repeat('d',64))$$,
  '22023','invalid campaign asset path','storage paths are bound to the campaign and generated-file shape');
select throws_ok($$select api.partner_create_campaign_asset(
  'a4000000-0000-4000-8000-000000000001',(select id from app_private.campaigns where slug='asset-campaign'),
  'hero_image','campaigns/'||(select id::text from app_private.campaigns where slug='asset-campaign')||'/'||gen_random_uuid()||'.png',
  'image/png',5242881,'Too large',false,repeat('c',64))$$,'22023','invalid campaign asset metadata','MIME, size, and alt text are validated');
select throws_ok($$select api.partner_create_campaign_asset(
  'a4000000-0000-4000-8000-000000000001',(select id from app_private.campaigns where slug='asset-campaign'),
  'hero_image','campaigns/'||(select id::text from app_private.campaigns where slug='asset-campaign')||'/'||gen_random_uuid()||'.png',
  'image/png',100,'Fake digest',false,repeat('0',64))$$,'23514','new row for relation "campaign_assets" violates check constraint "campaign_assets_sha256_check"','all-zero digest is rejected');

create temporary table revision_fixture as select api.partner_create_campaign_revision(
  'a4000000-0000-4000-8000-000000000001',(select id from app_private.campaigns where slug='asset-campaign'),
  'Support Asset Charity','Send your phone to support this cause.','A reviewed story with a controlled image.',
  'Donate a Phone',(select (result->>'id')::uuid from asset_fixture),repeat('b',64)) result;
select is(api.get_public_campaign_asset((select (result->>'id')::uuid from asset_fixture)),null,
  'unpublished campaign assets are not publicly readable');
select lives_ok(format($$select api.staff_publish_campaign_revision(
  'a4000000-0000-4000-8000-000000000002',%L::uuid,%L::uuid)$$,
  (select id from app_private.campaigns where slug='asset-campaign'),
  (select (result->>'revisionId')::uuid from revision_fixture)),
  'staff can publish a reviewed revision referencing the controlled asset');
select is(api.get_public_campaign_asset((select (result->>'id')::uuid from asset_fixture))->>'mimeType','image/webp',
  'published asset metadata is exposed only through the publication-gated API');
select throws_ok($$select api.partner_delete_campaign_asset(
  'a4000000-0000-4000-8000-000000000001',(select (result->>'id')::uuid from asset_fixture))$$,
  '23503','campaign asset is already referenced by a revision','published/referenced assets cannot be deleted');
select * from finish();
rollback;

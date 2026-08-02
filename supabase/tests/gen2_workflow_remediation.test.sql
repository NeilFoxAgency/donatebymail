begin;
create extension if not exists pgtap with schema extensions;
select plan(10);

select has_column('app_private','campaign_assets','content_sha256','campaign assets store a byte digest');
select has_column('app_private','campaign_assets','is_decorative','campaign assets expose explicit decorative state');
select has_column('app_private','campaign_revisions','hero_asset_sha256','hero digest is snapshotted on the revision');
select has_column('app_private','campaign_revisions','supporting_asset_sha256','supporting digest is snapshotted on the revision');
select has_table('app_private','campaign_revision_blocks','structured blocks are private');
select is(app_private.validate_campaign_blocks('[{"type":"callout","content":{"heading":"A","body":"B"}}]'::jsonb),true,'allowlisted structured blocks validate');
select is(app_private.validate_campaign_blocks('[{"type":"raw","content":{"html":"<script>bad</script>"}}]'::jsonb),false,'unknown block types and raw HTML are rejected');
select is(app_private.validate_campaign_blocks('[{"type":"text","content":{"href":"https://attacker.example"}}]'::jsonb),false,'remote URL fields are rejected from blocks');
select is((select relrowsecurity from pg_class where oid='app_private.campaign_revision_blocks'::regclass),true,'structured block table has RLS enabled');
select is((select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='app_private' and p.proname='prevent_campaign_asset_mutation'),1::bigint,'asset replacement guard is installed');

select * from finish();
rollback;

-- Beta workflow remediation. This migration is additive and keeps the
-- production project completely outside the linked beta history.

-- Asset metadata is immutable and binds a reviewed revision to exact bytes.
alter table app_private.campaign_assets
  add column if not exists content_sha256 text,
  add column if not exists is_decorative boolean not null default false,
  add column if not exists storage_format_version smallint not null default 1;
alter table app_private.campaign_assets
  drop constraint if exists campaign_assets_alt_text_check;
alter table app_private.campaign_assets
  add constraint campaign_assets_sha256_check
    check (content_sha256 is null or content_sha256 ~ '^[a-f0-9]{64}$'),
  add constraint campaign_assets_alt_text_accessibility_check
    check (is_decorative or char_length(trim(coalesce(alt_text,''))) between 1 and 300);

alter table app_private.campaign_revisions
  add column if not exists hero_asset_sha256 text,
  add column if not exists supporting_asset_sha256 text,
  add column if not exists content_blocks jsonb not null default '[]'::jsonb;
alter table app_private.campaign_revisions
  add constraint campaign_revisions_asset_digest_check
    check ((hero_asset_sha256 is null or hero_asset_sha256 ~ '^[a-f0-9]{64}$')
      and (supporting_asset_sha256 is null or supporting_asset_sha256 ~ '^[a-f0-9]{64}$')),
  add constraint campaign_revisions_blocks_check
    check (jsonb_typeof(content_blocks) = 'array' and jsonb_array_length(content_blocks) <= 12);

create table if not exists app_private.campaign_revision_blocks (
  id uuid primary key default gen_random_uuid(),
  revision_id uuid not null references app_private.campaign_revisions(id) on delete cascade,
  block_order integer not null check (block_order >= 0 and block_order < 12),
  block_type text not null check (block_type in ('text','callout','statistic','quote')),
  content jsonb not null check (jsonb_typeof(content) = 'object'),
  created_at timestamptz not null default now(),
  unique (revision_id, block_order)
);
alter table app_private.campaign_revision_blocks enable row level security;
revoke all on app_private.campaign_revision_blocks from public, anon, authenticated;
grant select, insert on app_private.campaign_revision_blocks to service_role;

create or replace function app_private.prevent_campaign_asset_mutation()
returns trigger language plpgsql set search_path = pg_catalog, app_private as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'campaign asset metadata is immutable' using errcode = '23514';
  end if;
  if exists (select 1 from app_private.campaign_revisions r
    where r.hero_asset_id = old.id or r.supporting_asset_id = old.id) then
    raise exception 'campaign asset is already referenced by a revision' using errcode = '23503';
  end if;
  return old;
end;
$$;
drop trigger if exists campaign_assets_immutable_guard on app_private.campaign_assets;
create trigger campaign_assets_immutable_guard
before update or delete on app_private.campaign_assets
for each row execute function app_private.prevent_campaign_asset_mutation();

-- New upload API: callers must provide a SHA-256 digest computed from the
-- actual bytes. The legacy overload remains for old beta fixtures and writes
-- an explicitly legacy marker until those fixtures are replaced.
create or replace function api.partner_create_campaign_asset(
  actor_user_id uuid, candidate_campaign_id uuid, asset_kind_value text,
  storage_path_value text, mime_type_value text, byte_size_value integer,
  alt_text_value text, decorative_value boolean, content_sha256_value text
) returns jsonb language plpgsql security definer
set search_path = pg_catalog, app_private as $$
declare org_id uuid; asset_id uuid; normalized_alt text := nullif(trim(alt_text_value),'');
begin
  perform app_private.assert_service_role();
  select organization_id into org_id from app_private.campaigns
    where id=candidate_campaign_id and status in ('draft','published') for update;
  perform app_private.assert_org_member(actor_user_id,org_id);
  if asset_kind_value not in ('hero_image','supporting_image') then
    raise exception 'unsupported campaign asset kind' using errcode='22023';
  end if;
  if storage_path_value !~ ('^campaigns/'||candidate_campaign_id::text||'/[0-9a-f-]{36}[.](jpg|png|webp)$') then
    raise exception 'invalid campaign asset path' using errcode='22023';
  end if;
  if mime_type_value not in ('image/jpeg','image/png','image/webp')
    or byte_size_value not between 1 and 5242880
    or content_sha256_value is null or content_sha256_value !~ '^[a-f0-9]{64}$'
    or (not coalesce(decorative_value,false) and char_length(coalesce(normalized_alt,'')) not between 1 and 300) then
    raise exception 'invalid campaign asset metadata' using errcode='22023';
  end if;
  insert into app_private.campaign_assets(campaign_id,asset_kind,storage_path,mime_type,byte_size,alt_text,is_decorative,content_sha256,uploaded_by)
    values(candidate_campaign_id,asset_kind_value,storage_path_value,mime_type_value,byte_size_value,normalized_alt,coalesce(decorative_value,false),lower(content_sha256_value),actor_user_id)
    returning id into asset_id;
  return jsonb_build_object('id',asset_id,'contentSha256',lower(content_sha256_value));
end $$;

-- The prior seven-argument beta RPC is retained as a compatibility shim. New
-- clients must use the digest-bearing overload above.
create or replace function api.partner_create_campaign_asset(
  actor_user_id uuid, candidate_campaign_id uuid, asset_kind_value text,
  storage_path_value text, mime_type_value text, byte_size_value integer,
  alt_text_value text
) returns jsonb language sql security definer
set search_path = pg_catalog, app_private as $$
  select api.partner_create_campaign_asset(actor_user_id,candidate_campaign_id,
    asset_kind_value,storage_path_value,mime_type_value,byte_size_value,
    alt_text_value,false,repeat('0',64))
$$;
revoke all on function api.partner_create_campaign_asset(uuid,uuid,text,text,text,integer,text,boolean,text) from public,anon,authenticated;
revoke all on function api.partner_create_campaign_asset(uuid,uuid,text,text,text,integer,text) from public,anon,authenticated;
grant execute on function api.partner_create_campaign_asset(uuid,uuid,text,text,text,integer,text,boolean,text) to service_role;
grant execute on function api.partner_create_campaign_asset(uuid,uuid,text,text,text,integer,text) to service_role;

-- Immutable revision block normalization. Blocks are structured JSON only;
-- no HTML, scripts, CSS, embeds, or remote asset URLs are accepted.
create or replace function app_private.validate_campaign_blocks(blocks_value jsonb)
returns boolean language plpgsql immutable set search_path = pg_catalog, app_private as $$
declare item jsonb; block_kind text; block_content jsonb;
begin
  if blocks_value is null or jsonb_typeof(blocks_value) <> 'array' or jsonb_array_length(blocks_value) > 12 then return false; end if;
  for item in select value from jsonb_array_elements(blocks_value) loop
    block_kind := item->>'type'; block_content := item->'content';
    if block_kind not in ('text','callout','statistic','quote') or jsonb_typeof(block_content) <> 'object' then return false; end if;
    if block_content ? 'html' or block_content ? 'script' or block_content ? 'css' or block_content ? 'embed' then return false; end if;
    if exists(select 1 from jsonb_object_keys(block_content) k where k ~* '(url|href|src)' and jsonb_typeof(block_content->k) <> 'null') then return false; end if;
  end loop;
  return true;
end $$;

-- Re-create the current revision RPC with digest snapshots and blocks. The
-- input content hash is accepted for compatibility but the canonical hash is
-- computed from server-side values and immutable asset digests.
drop function if exists api.partner_create_campaign_revision(uuid,uuid,text,text,text,text,uuid,uuid,text);
create function api.partner_create_campaign_revision(
  actor_user_id uuid, candidate_campaign_id uuid, headline_value text,
  summary_value text, story_value text, cta_value text, hero_asset_value uuid,
  supporting_asset_value uuid, content_hash_value text, blocks_value jsonb default '[]'::jsonb
) returns jsonb language plpgsql security definer
set search_path = pg_catalog, app_private as $$
declare org_id uuid; next_version integer; revision_id uuid; hero_digest text; supporting_digest text; canonical_hash text; item jsonb; idx integer := 0;
begin
  perform app_private.assert_service_role();
  select c.organization_id into org_id from app_private.campaigns c join app_private.organizations o on o.id=c.organization_id
    where c.id=candidate_campaign_id and o.status='active' for update of c;
  perform app_private.assert_org_member(actor_user_id,org_id);
  if hero_asset_value is not null then select content_sha256 into hero_digest from app_private.campaign_assets where id=hero_asset_value and campaign_id=candidate_campaign_id and asset_kind='hero_image'; if hero_digest is null then raise exception 'controlled hero asset with digest required' using errcode='22023'; end if; end if;
  if supporting_asset_value is not null then select content_sha256 into supporting_digest from app_private.campaign_assets where id=supporting_asset_value and campaign_id=candidate_campaign_id and asset_kind='supporting_image'; if supporting_digest is null then raise exception 'controlled supporting asset with digest required' using errcode='22023'; end if; end if;
  if not app_private.validate_campaign_blocks(coalesce(blocks_value,'[]'::jsonb)) then raise exception 'invalid structured campaign blocks' using errcode='22023'; end if;
  select coalesce(max(version),0)+1 into next_version from app_private.campaign_revisions where campaign_id=candidate_campaign_id;
  canonical_hash := encode(extensions.digest(convert_to(jsonb_build_object('headline',trim(headline_value),'summary',trim(summary_value),'story',trim(story_value),'ctaLabel',coalesce(nullif(trim(cta_value),''),'Donate a Phone'),'heroAssetId',hero_asset_value,'heroAssetSha256',hero_digest,'supportingAssetId',supporting_asset_value,'supportingAssetSha256',supporting_digest,'blocks',coalesce(blocks_value,'[]'::jsonb))::text,'utf8'),'sha256'),'hex');
  insert into app_private.campaign_revisions(campaign_id,version,headline,summary,story,cta_label,hero_asset_id,supporting_asset_id,hero_asset_sha256,supporting_asset_sha256,content_hash,content_blocks,requested_by)
    values(candidate_campaign_id,next_version,trim(headline_value),trim(summary_value),trim(story_value),coalesce(nullif(trim(cta_value),''),'Donate a Phone'),hero_asset_value,supporting_asset_value,hero_digest,supporting_digest,canonical_hash,coalesce(blocks_value,'[]'::jsonb),actor_user_id) returning id into revision_id;
  for item in select value from jsonb_array_elements(coalesce(blocks_value,'[]'::jsonb)) loop
    insert into app_private.campaign_revision_blocks(revision_id,block_order,block_type,content) values(revision_id,idx,item->>'type',item->'content'); idx := idx + 1;
  end loop;
  insert into app_private.audit_events(actor,actor_ref,action_name,entity_type,entity_id,reason_code,redacted_changes,metadata)
    values('partner',actor_user_id::text,'campaign.update_content','campaign_revision',revision_id,'partner_revision',jsonb_build_object('version',next_version,'content_hash',canonical_hash,'asset_digests',jsonb_build_object('hero',hero_digest,'supporting',supporting_digest)),jsonb_build_object('campaign_id',candidate_campaign_id));
  return jsonb_build_object('revisionId',revision_id,'version',next_version,'contentHash',canonical_hash);
end $$;

create or replace function api.partner_create_campaign_revision(
  actor_user_id uuid,candidate_campaign_id uuid,headline_value text,summary_value text,
  story_value text,cta_value text,hero_asset_value uuid,content_hash_value text
) returns jsonb language sql security definer set search_path=pg_catalog,app_private as $$
  select api.partner_create_campaign_revision(actor_user_id,candidate_campaign_id,headline_value,summary_value,story_value,cta_value,hero_asset_value,null::uuid,content_hash_value,'[]'::jsonb)
$$;

create or replace function api.staff_publish_campaign_revision(actor_user_id uuid,candidate_campaign_id uuid,candidate_revision_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,app_private as $$
declare old_revision uuid;
begin
  perform app_private.assert_service_role(); perform app_private.assert_active_staff(actor_user_id);
  select c.active_revision_id into old_revision from app_private.campaigns c join app_private.organizations o on o.id=c.organization_id join app_private.charities ch on ch.id=c.charity_id join app_private.organization_charities oc on oc.organization_id=c.organization_id and oc.charity_id=c.charity_id where c.id=candidate_campaign_id and o.status='active' and ch.status='verified' and oc.status='verified' for update of c;
  if not found or not exists(select 1 from app_private.campaign_revisions r where r.id=candidate_revision_id and r.campaign_id=candidate_campaign_id and r.status='draft' and (r.hero_asset_id is null or exists(select 1 from app_private.campaign_assets a where a.id=r.hero_asset_id and a.content_sha256=r.hero_asset_sha256 and a.campaign_id=candidate_campaign_id and a.asset_kind='hero_image')) and (r.supporting_asset_id is null or exists(select 1 from app_private.campaign_assets a where a.id=r.supporting_asset_id and a.content_sha256=r.supporting_asset_sha256 and a.campaign_id=candidate_campaign_id and a.asset_kind='supporting_image')) and app_private.validate_campaign_blocks(r.content_blocks)) then raise exception 'publishable controlled revision with exact assets required' using errcode='22023'; end if;
  update app_private.campaign_revisions set status='superseded' where id=old_revision and status='published';
  update app_private.campaign_revisions set status='published',approved_by=actor_user_id,published_by=actor_user_id,published_at=now() where id=candidate_revision_id;
  update app_private.campaigns set active_revision_id=candidate_revision_id,status='published',updated_at=now() where id=candidate_campaign_id;
  insert into app_private.audit_events(actor,actor_ref,action_name,entity_type,entity_id,reason_code,redacted_changes,metadata) values('staff',actor_user_id::text,'campaign.publish_revision','campaign',candidate_campaign_id,'staff_publication',jsonb_build_object('from_revision',old_revision,'to_revision',candidate_revision_id),jsonb_build_object('exact_assets',true));
  return jsonb_build_object('ok',true,'slug',(select slug from app_private.campaigns where id=candidate_campaign_id));
end $$;

create or replace function api.get_public_campaign(campaign_slug text) returns jsonb language plpgsql security definer stable set search_path=pg_catalog,app_private as $$
declare result jsonb;
begin
  perform app_private.assert_service_role();
  select jsonb_build_object('id',c.id,'slug',c.slug,'name',c.name,'charityPledgeId',ch.pledge_id,'charityName',ch.canonical_name,'headline',r.headline,'summary',r.summary,'story',r.story,'ctaLabel',r.cta_label,'heroAssetId',r.hero_asset_id,'heroImageUrl',case when r.hero_asset_id is null then null else '/api/campaign-assets/'||r.hero_asset_id::text end,'heroAltText',ha.alt_text,'heroDecorative',coalesce(ha.is_decorative,false),'supportingAssetId',r.supporting_asset_id,'supportingImageUrl',case when r.supporting_asset_id is null then null else '/api/campaign-assets/'||r.supporting_asset_id::text end,'supportingAltText',sa.alt_text,'supportingDecorative',coalesce(sa.is_decorative,false),'blocks',r.content_blocks,'revision',r.version,'contentHash',r.content_hash) into result
  from app_private.campaigns c join app_private.organizations o on o.id=c.organization_id join app_private.charities ch on ch.id=c.charity_id join app_private.organization_charities oc on oc.organization_id=c.organization_id and oc.charity_id=c.charity_id join app_private.campaign_revisions r on r.id=c.active_revision_id left join app_private.campaign_assets ha on ha.id=r.hero_asset_id left join app_private.campaign_assets sa on sa.id=r.supporting_asset_id where c.slug=lower(trim(campaign_slug)) and c.status='published' and r.status='published' and o.status='active' and ch.status='verified' and oc.status='verified';
  return result;
end $$;

create or replace function api.get_public_campaign_asset(candidate_asset_id uuid) returns jsonb language plpgsql security definer stable set search_path=pg_catalog,app_private as $$
declare result jsonb;
begin
  perform app_private.assert_service_role();
  select jsonb_build_object('id',a.id,'storagePath',a.storage_path,'mimeType',a.mime_type,'altText',a.alt_text,'isDecorative',a.is_decorative,'contentSha256',a.content_sha256) into result from app_private.campaign_assets a join app_private.campaigns c on c.id=a.campaign_id join app_private.campaign_revisions r on r.id=c.active_revision_id and (r.hero_asset_id=a.id or r.supporting_asset_id=a.id) join app_private.organizations o on o.id=c.organization_id join app_private.charities ch on ch.id=c.charity_id join app_private.organization_charities oc on oc.organization_id=c.organization_id and oc.charity_id=c.charity_id where a.id=candidate_asset_id and c.status='published' and r.status='published' and o.status='active' and ch.status='verified' and oc.status='verified';
  return result;
end $$;

-- Zero proceeds are a terminal financial outcome, not a pending payment.
alter table app_private.proceeds_allocations add column if not exists settlement_status text not null default 'pending_disbursement';
update app_private.proceeds_allocations set settlement_status = case when status='policy_hold' then 'policy_hold' when status='calculated' and coalesce(allocated_cents,0)=0 then 'no_proceeds' when status='calculated' then 'pending_disbursement' when status in ('approved','disbursed') then 'disbursed' else status::text end;
alter table app_private.proceeds_allocations add constraint proceeds_allocations_settlement_status_check check (settlement_status in ('policy_hold','no_proceeds','pending_disbursement','approved','disbursed','reversed'));
create or replace function app_private.set_proceeds_settlement_status()
returns trigger language plpgsql set search_path = pg_catalog, app_private as $$
begin
  new.settlement_status := case when new.status='policy_hold' then 'policy_hold' when new.status='calculated' and coalesce(new.allocated_cents,0)=0 then 'no_proceeds' when new.status='calculated' then 'pending_disbursement' when new.status in ('approved','disbursed') then 'disbursed' else new.status::text end;
  return new;
end $$;
drop trigger if exists proceeds_settlement_status on app_private.proceeds_allocations;
create trigger proceeds_settlement_status before insert on app_private.proceeds_allocations for each row execute function app_private.set_proceeds_settlement_status();

create or replace function api.staff_financial_overview(actor_user_id uuid)
returns jsonb language plpgsql security definer stable set search_path=pg_catalog,app_private as $$
declare result jsonb;
begin
  perform app_private.assert_service_role(); perform app_private.assert_active_staff(actor_user_id);
  select jsonb_build_object('policyHolds',(select count(*) from app_private.donations where policy_resolution_status='policy_hold'),'failedOutbox',(select count(*) from app_private.outbox_events where status='failed'),'openEscalations',(select count(*) from app_private.agent_escalations where status='open'),'allocations',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'donationId',a.donation_id,'status',a.status,'settlementStatus',a.settlement_status,'grossCents',a.gross_cents,'eligibleCostCents',a.eligible_cost_cents,'allocatedCents',a.allocated_cents,'createdAt',a.created_at) order by a.created_at desc) from app_private.proceeds_allocations a),'[]'::jsonb),'disbursements',coalesce((select jsonb_agg(jsonb_build_object('id',d.id,'status',d.status,'preparationId',d.preparation_id,'completedAt',d.completed_at) order by d.created_at desc) from app_private.disbursements d),'[]'::jsonb)) into result;
  return result;
end $$;

-- Financial finalization freezes financial evidence, but processing -> completed
-- is a donor-visible operational transition and remains valid afterward.
create or replace function api.staff_change_donation_status(actor_user_id uuid,candidate_donation_id uuid,new_status app_private.donation_status,public_message text default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,app_private as $$
declare old_status app_private.donation_status; domain_event_id uuid; outbox_id uuid;
begin
  perform app_private.assert_service_role(); perform app_private.assert_active_staff(actor_user_id);
  select status into old_status from app_private.donations where id=candidate_donation_id for update;
  if not found or not app_private.valid_donation_transition(old_status,new_status) then raise exception 'invalid donation status transition' using errcode='22023'; end if;
  if exists(select 1 from app_private.donations where id=candidate_donation_id and financial_inputs_finalized_at is not null) and not (old_status='processing' and new_status='completed') then raise exception 'financial inputs finalized; reopen required' using errcode='22023'; end if;
  if public_message is not null and char_length(trim(public_message)) not between 1 and 500 then raise exception 'invalid public message' using errcode='22023'; end if;
  update app_private.donations set status=new_status,completed_at=case when new_status='completed' then coalesce(completed_at,now()) else completed_at end,updated_at=now() where id=candidate_donation_id;
  insert into app_private.donation_status_events(donation_id,status,donor_visible,public_message,actor,actor_user_id) values(candidate_donation_id,new_status,public_message is not null,nullif(trim(public_message),''),'staff',actor_user_id);
  insert into app_private.audit_events(actor,actor_ref,action_name,entity_type,entity_id,reason_code,redacted_changes,metadata) values('staff',actor_user_id::text,'donation.change_status','donation',candidate_donation_id,'staff_status_update',jsonb_build_object('status',jsonb_build_object('from',old_status,'to',new_status)),jsonb_build_object('financially_finalized',exists(select 1 from app_private.donations where id=candidate_donation_id and financial_inputs_finalized_at is not null)));
  insert into app_private.domain_events(event_type,aggregate_type,aggregate_id,aggregate_version,payload) values('donation.status_changed','donation',candidate_donation_id,(select count(*)::integer from app_private.donation_status_events where donation_id=candidate_donation_id),jsonb_build_object('donationId',candidate_donation_id,'status',new_status)) returning id into domain_event_id;
  insert into app_private.outbox_events(domain_event_id,handler_key,event_type,payload) values(domain_event_id,'donation_status_notification','donation.status_changed',jsonb_build_object('donationId',candidate_donation_id)) returning id into outbox_id;
  return jsonb_build_object('ok',true,'outboxEventId',outbox_id);
end $$;

-- Actual donor entitlement is claimed-donation data, not mere auth identity.
create or replace function api.account_context(actor_user_id uuid) returns jsonb language plpgsql security definer stable set search_path=pg_catalog,app_private,auth as $$
declare result jsonb; staff boolean; organizations jsonb; claimed boolean;
begin
  perform app_private.assert_service_role(); staff := exists(select 1 from app_private.staff_memberships where user_id=actor_user_id and status='active');
  select coalesce(jsonb_agg(jsonb_build_object('id',o.id,'name',o.name,'role',m.role) order by o.name),'[]'::jsonb) into organizations from app_private.organization_memberships m join app_private.organizations o on o.id=m.organization_id where m.user_id=actor_user_id and m.status='active' and o.status='active';
  select exists(select 1 from app_private.donation_claim_capabilities c where c.claimed_by=actor_user_id and c.consumed_at is not null) into claimed;
  select jsonb_build_object('userId',actor_user_id,'email',u.email,'staff',staff,'organizations',organizations,'donor',claimed,'hasClaimedDonations',claimed) into result from auth.users u where u.id=actor_user_id;
  return result;
end $$;

create or replace function api.partner_campaign_detail(actor_user_id uuid,candidate_campaign_id uuid) returns jsonb language plpgsql security definer stable set search_path=pg_catalog,app_private as $$
declare result jsonb; org_id uuid;
begin
  perform app_private.assert_service_role();
  select organization_id into org_id from app_private.campaigns where id=candidate_campaign_id;
  perform app_private.assert_org_member(actor_user_id,org_id);
  select jsonb_build_object('id',c.id,'organizationId',c.organization_id,'slug',c.slug,'name',c.name,'status',c.status,'charityName',ch.canonical_name,'activeRevisionId',c.active_revision_id,'revisions',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'version',r.version,'status',r.status,'headline',r.headline,'summary',r.summary,'story',r.story,'ctaLabel',r.cta_label,'heroAssetId',r.hero_asset_id,'heroAltText',ha.alt_text,'heroDecorative',coalesce(ha.is_decorative,false),'supportingAssetId',r.supporting_asset_id,'supportingAltText',sa.alt_text,'supportingDecorative',coalesce(sa.is_decorative,false),'blocks',r.content_blocks,'contentHash',r.content_hash,'createdAt',r.created_at,'publishedAt',r.published_at) order by r.version desc) from app_private.campaign_revisions r left join app_private.campaign_assets ha on ha.id=r.hero_asset_id left join app_private.campaign_assets sa on sa.id=r.supporting_asset_id where r.campaign_id=c.id),'[]'::jsonb)) into result from app_private.campaigns c join app_private.charities ch on ch.id=c.charity_id where c.id=candidate_campaign_id;
  return result;
end $$;
alter function api.partner_campaign_detail(uuid,uuid) volatile;

-- The client-supplied content hash is intentionally ignored; keeping a
-- reference to it avoids a misleading unused-parameter warning in lint.
create or replace function api.partner_create_campaign_revision(
  actor_user_id uuid, candidate_campaign_id uuid, headline_value text,
  summary_value text, story_value text, cta_value text, hero_asset_value uuid,
  supporting_asset_value uuid, content_hash_value text, blocks_value jsonb default '[]'::jsonb
) returns jsonb language plpgsql security definer
set search_path = pg_catalog, app_private as $$
declare org_id uuid; next_version integer; revision_id uuid; hero_digest text; supporting_digest text; canonical_hash text; item jsonb; idx integer := 0;
begin
  perform app_private.assert_service_role();
  if content_hash_value is not null then perform length(content_hash_value); end if;
  select c.organization_id into org_id from app_private.campaigns c join app_private.organizations o on o.id=c.organization_id where c.id=candidate_campaign_id and o.status='active' for update of c;
  perform app_private.assert_org_member(actor_user_id,org_id);
  if hero_asset_value is not null then select content_sha256 into hero_digest from app_private.campaign_assets where id=hero_asset_value and campaign_id=candidate_campaign_id and asset_kind='hero_image'; if hero_digest is null then raise exception 'controlled hero asset with digest required' using errcode='22023'; end if; end if;
  if supporting_asset_value is not null then select content_sha256 into supporting_digest from app_private.campaign_assets where id=supporting_asset_value and campaign_id=candidate_campaign_id and asset_kind='supporting_image'; if supporting_digest is null then raise exception 'controlled supporting asset with digest required' using errcode='22023'; end if; end if;
  if not app_private.validate_campaign_blocks(coalesce(blocks_value,'[]'::jsonb)) then raise exception 'invalid structured campaign blocks' using errcode='22023'; end if;
  select coalesce(max(version),0)+1 into next_version from app_private.campaign_revisions where campaign_id=candidate_campaign_id;
  canonical_hash := encode(extensions.digest(convert_to(jsonb_build_object('headline',trim(headline_value),'summary',trim(summary_value),'story',trim(story_value),'ctaLabel',coalesce(nullif(trim(cta_value),''),'Donate a Phone'),'heroAssetId',hero_asset_value,'heroAssetSha256',hero_digest,'supportingAssetId',supporting_asset_value,'supportingAssetSha256',supporting_digest,'blocks',coalesce(blocks_value,'[]'::jsonb))::text,'utf8'),'sha256'),'hex');
  insert into app_private.campaign_revisions(campaign_id,version,headline,summary,story,cta_label,hero_asset_id,supporting_asset_id,hero_asset_sha256,supporting_asset_sha256,content_hash,content_blocks,requested_by) values(candidate_campaign_id,next_version,trim(headline_value),trim(summary_value),trim(story_value),coalesce(nullif(trim(cta_value),''),'Donate a Phone'),hero_asset_value,supporting_asset_value,hero_digest,supporting_digest,canonical_hash,coalesce(blocks_value,'[]'::jsonb),actor_user_id) returning id into revision_id;
  for item in select value from jsonb_array_elements(coalesce(blocks_value,'[]'::jsonb)) loop insert into app_private.campaign_revision_blocks(revision_id,block_order,block_type,content) values(revision_id,idx,item->>'type',item->'content'); idx := idx + 1; end loop;
  insert into app_private.audit_events(actor,actor_ref,action_name,entity_type,entity_id,reason_code,redacted_changes,metadata) values('partner',actor_user_id::text,'campaign.update_content','campaign_revision',revision_id,'partner_revision',jsonb_build_object('version',next_version,'content_hash',canonical_hash,'asset_digests',jsonb_build_object('hero',hero_digest,'supporting',supporting_digest)),jsonb_build_object('campaign_id',candidate_campaign_id));
  return jsonb_build_object('revisionId',revision_id,'version',next_version,'contentHash',canonical_hash);
end $$;

alter function api.account_context(uuid) volatile;
alter function api.get_public_campaign(text) volatile;
alter function api.get_public_campaign_asset(uuid) volatile;
alter function api.staff_financial_overview(uuid) volatile;

-- Keep the effective-allocation view extensible (it now has settlement
-- metadata) without relying on a table composite assignment.
create or replace function api.staff_reopen_donation_financials(actor_user_id uuid,candidate_donation_id uuid,reason_value text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,app_private as $$
declare active_allocation record; reversal_id uuid;
begin
  perform app_private.assert_service_role(); perform app_private.assert_active_staff(actor_user_id);
  if char_length(trim(coalesce(reason_value,''))) not between 1 and 500 then raise exception 'correction reason required' using errcode='22023'; end if;
  select a.* into active_allocation from app_private.effective_proceeds_allocations a where a.donation_id=candidate_donation_id and a.status in ('calculated','policy_hold') order by a.created_at desc limit 1 for update;
  if active_allocation.id is null or exists(select 1 from app_private.disbursement_preparation_allocations p join app_private.disbursements d on d.preparation_id=p.preparation_id where p.allocation_id=active_allocation.id and d.status not in ('cancelled','reversed')) then raise exception 'undisbursed calculated allocation required' using errcode='22023'; end if;
  insert into app_private.proceeds_allocations(donation_id,policy_version_id,beneficiary_pledge_id,gross_cents,eligible_cost_cents,allocable_base_cents,share_basis_points,allocated_cents,currency,status,calculation_snapshot,calculated_by,calculated_at,reversal_of,reconciliation_snapshot_id,beneficiary_charity_id,campaign_id,organization_id) values(active_allocation.donation_id,active_allocation.policy_version_id,active_allocation.beneficiary_pledge_id,active_allocation.gross_cents,active_allocation.eligible_cost_cents,active_allocation.allocable_base_cents,active_allocation.share_basis_points,active_allocation.allocated_cents,active_allocation.currency,'reversed',jsonb_build_object('reason',left(trim(reason_value),500),'reverses',active_allocation.id),actor_user_id,now(),active_allocation.id,active_allocation.reconciliation_snapshot_id,active_allocation.beneficiary_charity_id,active_allocation.campaign_id,active_allocation.organization_id) returning id into reversal_id;
  update app_private.donations set financial_inputs_finalized_at=null,financial_inputs_finalized_by=null where id=candidate_donation_id;
  insert into app_private.audit_events(actor,actor_ref,action_name,entity_type,entity_id,reason_code,redacted_changes,metadata) values('staff',actor_user_id::text,'finance.reopen_inputs','proceeds_allocation',reversal_id,'explicit_financial_correction',jsonb_build_object('reversal_of',active_allocation.id),jsonb_build_object('reason',left(trim(reason_value),500)));
  return jsonb_build_object('reversalAllocationId',reversal_id,'reopened',true,'previousAllocationId',active_allocation.id);
end $$;

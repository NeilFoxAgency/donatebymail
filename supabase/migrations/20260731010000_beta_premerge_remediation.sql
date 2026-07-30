-- Final pre-merge remediation for the isolated beta project.  Nothing in this
-- migration is intended for the production database.

-- Revoke the default PUBLIC execute privilege from every API SECURITY DEFINER
-- function.  The Worker is the only caller of privileged API RPCs.
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as signature
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='api' and p.prosecdef
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f.signature);
    execute format('grant execute on function %s to service_role', f.signature);
  end loop;
end $$;

-- The digest-bearing asset RPC is the only supported creation path.  The
-- former seven-argument compatibility overload created unverifiable assets.
drop function if exists api.partner_create_campaign_asset(uuid,uuid,text,text,text,integer,text);
alter table app_private.campaign_assets drop constraint if exists campaign_assets_sha256_check;
alter table app_private.campaign_assets add constraint campaign_assets_sha256_check
  check (content_sha256 is null or (content_sha256 ~ '^[a-f0-9]{64}$' and content_sha256 <> repeat('0',64)));

-- Structured blocks are deliberately small, typed plaintext records.  This
-- rejects unknown keys, nested objects/arrays, URLs, markup, empty values and
-- oversized content at the database boundary.
create or replace function app_private.validate_campaign_blocks(blocks_value jsonb)
returns boolean language plpgsql immutable set search_path=pg_catalog,app_private as $$
declare item jsonb; kind text; content jsonb; key_name text; value_text text; allowed text[];
begin
  if blocks_value is null or jsonb_typeof(blocks_value)<>'array' or jsonb_array_length(blocks_value)>12 then return false; end if;
  for item in select value from jsonb_array_elements(blocks_value) loop
    if jsonb_typeof(item)<>'object' or item ?| array['html','script','style','embed','url','href','src'] then return false; end if;
    kind:=item->>'type'; content:=item->'content';
    if kind not in ('text','callout','statistic','quote') or jsonb_typeof(content)<>'object' then return false; end if;
    allowed:=case kind when 'text' then array['heading','body']
      when 'callout' then array['heading','body']
      when 'statistic' then array['value','heading','body']
      else array['body','attribution'] end;
    if exists(select 1 from jsonb_object_keys(content) k where not (k=any(allowed))) then return false; end if;
    if kind in ('text','callout') and not (content ? 'body') then return false; end if;
    if kind='statistic' and not (content ? 'value') then return false; end if;
    if kind='quote' and not (content ? 'body') then return false; end if;
    for key_name in select jsonb_object_keys(content) loop
      if jsonb_typeof(content->key_name)<>'string' then return false; end if;
      value_text:=content->>key_name;
      if value_text is null or char_length(btrim(value_text))=0 or char_length(value_text)>1000
        or value_text ~* '<[^>]+>|javascript:|data:|https?://|www\.' then return false; end if;
    end loop;
  end loop;
  return true;
end $$;

-- Keep settlement_status synchronized with the authoritative allocation status.
alter table app_private.financial_reconciliation_snapshots
  drop constraint if exists financial_reconciliation_snapshots_eligible_device_count_check;
alter table app_private.financial_reconciliation_snapshots
  add constraint financial_reconciliation_snapshots_eligible_device_count_check check (eligible_device_count>=0);
alter table app_private.proceeds_allocations
  drop constraint if exists proceeds_allocations_settlement_status_check;
alter table app_private.proceeds_allocations
  add constraint proceeds_allocations_settlement_status_check check
    (settlement_status in ('policy_hold','no_proceeds','pending_disbursement','approved','disbursed','reversed'));
create or replace function app_private.set_proceeds_settlement_status()
returns trigger language plpgsql set search_path=pg_catalog,app_private as $$
begin
  new.settlement_status:=case
    when new.status='policy_hold' then 'policy_hold'
    when coalesce(new.allocated_cents,0)=0 then 'no_proceeds'
    when new.status='calculated' then 'pending_disbursement'
    when new.status='approved' then 'approved'
    when new.status='disbursed' then 'disbursed'
    when new.status='reversed' then 'reversed'
    else new.status::text end;
  return new;
end $$;
drop trigger if exists proceeds_settlement_status on app_private.proceeds_allocations;
create trigger proceeds_settlement_status before insert or update of status,allocated_cents on app_private.proceeds_allocations
for each row execute function app_private.set_proceeds_settlement_status();
update app_private.proceeds_allocations set settlement_status=case
  when status='policy_hold' then 'policy_hold' when coalesce(allocated_cents,0)=0 then 'no_proceeds'
  when status='calculated' then 'pending_disbursement' when status='approved' then 'approved'
  when status='disbursed' then 'disbursed' when status='reversed' then 'reversed' else status::text end;

-- Status notifications use the handler implemented by the Worker.  Existing
-- beta rows written with the old spelling are repaired in place.
update app_private.outbox_events set handler_key='donation_notifications'
where handler_key='donation_status_notification' and status in ('pending','processing','failed');
create or replace function api.staff_change_donation_status(actor_user_id uuid,candidate_donation_id uuid,new_status app_private.donation_status,public_message text default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,app_private as $$
declare old_status app_private.donation_status; event_id uuid; outbox_id uuid;
begin
  perform app_private.assert_service_role(); perform app_private.assert_active_staff(actor_user_id);
  select status into old_status from app_private.donations where id=candidate_donation_id for update;
  if not found or not app_private.valid_donation_transition(old_status,new_status) then raise exception 'invalid donation status transition' using errcode='22023'; end if;
  if exists(select 1 from app_private.donations where id=candidate_donation_id and financial_inputs_finalized_at is not null)
    and not (old_status='processing' and new_status='completed') then raise exception 'financial inputs finalized; reopen required' using errcode='22023'; end if;
  if public_message is not null and char_length(trim(public_message)) not between 1 and 500 then raise exception 'invalid public message' using errcode='22023'; end if;
  update app_private.donations set status=new_status,completed_at=case when new_status='completed' then coalesce(completed_at,now()) else completed_at end,updated_at=now() where id=candidate_donation_id;
  insert into app_private.donation_status_events(donation_id,status,donor_visible,public_message,actor,actor_user_id)
    values(candidate_donation_id,new_status,public_message is not null,nullif(trim(public_message),''),'staff',actor_user_id);
  insert into app_private.audit_events(actor,actor_ref,action_name,entity_type,entity_id,reason_code,redacted_changes,metadata)
    values('staff',actor_user_id::text,'donation.change_status','donation',candidate_donation_id,'staff_status_update',jsonb_build_object('status',jsonb_build_object('from',old_status,'to',new_status)), '{}'::jsonb);
  insert into app_private.domain_events(event_type,aggregate_type,aggregate_id,aggregate_version,payload)
    values('donation.status_changed','donation',candidate_donation_id,(select count(*)::integer from app_private.donation_status_events where donation_id=candidate_donation_id),jsonb_build_object('donationId',candidate_donation_id,'status',new_status)) returning id into event_id;
  insert into app_private.outbox_events(domain_event_id,handler_key,event_type,payload)
    values(event_id,'donation_notifications','donation.status_changed',jsonb_build_object('donationId',candidate_donation_id)) returning id into outbox_id;
  return jsonb_build_object('ok',true,'outboxEventId',outbox_id);
end $$;

-- Staff-only, exact-revision read model used by review before publication.
create or replace function api.staff_campaign_revision_preview(actor_user_id uuid,candidate_campaign_id uuid,candidate_revision_id uuid)
returns jsonb language plpgsql security definer volatile set search_path=pg_catalog,app_private as $$
declare result jsonb;
begin
  perform app_private.assert_service_role(); perform app_private.assert_active_staff(actor_user_id);
  select jsonb_build_object(
    'campaign',jsonb_build_object('id',c.id,'name',c.name,'slug',c.slug,'status',c.status),
    'organization',jsonb_build_object('id',o.id,'name',o.name),
    'charity',jsonb_build_object('id',ch.id,'pledgeId',ch.pledge_id,'name',ch.canonical_name,'ein',ch.ein,'status',ch.status),
    'revision',jsonb_build_object('id',r.id,'version',r.version,'status',r.status,'headline',r.headline,'summary',r.summary,'story',r.story,'ctaLabel',r.cta_label,
      'heroAsset',case when ha.id is null then null else jsonb_build_object('id',ha.id,'storagePath',ha.storage_path,'mimeType',ha.mime_type,'altText',ha.alt_text,'isDecorative',ha.is_decorative,'contentSha256',ha.content_sha256,'imageUrl','/api/staff/campaign-assets/'||ha.id::text) end,
      'supportingAsset',case when sa.id is null then null else jsonb_build_object('id',sa.id,'storagePath',sa.storage_path,'mimeType',sa.mime_type,'altText',sa.alt_text,'isDecorative',sa.is_decorative,'contentSha256',sa.content_sha256,'imageUrl','/api/staff/campaign-assets/'||sa.id::text) end,
      'blocks',r.content_blocks,'contentHash',r.content_hash),
    'publishedRevisionId',c.active_revision_id,'differsFromPublished',c.active_revision_id is distinct from r.id
  ) into result
  from app_private.campaigns c join app_private.organizations o on o.id=c.organization_id
    join app_private.charities ch on ch.id=c.charity_id join app_private.campaign_revisions r on r.campaign_id=c.id
    left join app_private.campaign_assets ha on ha.id=r.hero_asset_id left join app_private.campaign_assets sa on sa.id=r.supporting_asset_id
  where c.id=candidate_campaign_id and r.id=candidate_revision_id and r.status in ('draft','published','superseded');
  if result is null then raise exception 'campaign revision not found' using errcode='42501'; end if;
  return result;
end $$;

create or replace function api.staff_campaign_revision_asset(actor_user_id uuid,candidate_asset_id uuid)
returns jsonb language plpgsql security definer volatile set search_path=pg_catalog,app_private as $$
declare result jsonb;
begin
  perform app_private.assert_service_role(); perform app_private.assert_active_staff(actor_user_id);
  select jsonb_build_object('id',a.id,'storagePath',a.storage_path,'mimeType',a.mime_type,'contentSha256',a.content_sha256)
    into result from app_private.campaign_assets a join app_private.campaign_revisions r on a.id in (r.hero_asset_id,r.supporting_asset_id)
    where a.id=candidate_asset_id;
  if result is null then raise exception 'campaign asset not found' using errcode='42501'; end if;
  return result;
end $$;

-- Re-apply the privilege rule to functions replaced above and all overloads.
do $$ declare f record; begin for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='api' and p.prosecdef loop execute format('revoke execute on function %s from public, anon, authenticated',f.signature); execute format('grant execute on function %s to service_role',f.signature); end loop; end $$;

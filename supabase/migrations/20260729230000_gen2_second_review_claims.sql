-- Secure donor-claim handoff. Raw claim capabilities are exchanged from a URL
-- fragment for short-lived server state before authentication begins.
create table app_private.pending_donation_claims (
  id uuid primary key default gen_random_uuid(),
  donation_id uuid not null references app_private.donations(id) on delete cascade,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);
alter table app_private.pending_donation_claims enable row level security;
revoke all on app_private.pending_donation_claims from public,anon,authenticated;
grant select,insert,update,delete on app_private.pending_donation_claims to service_role;

alter table app_private.auth_login_attempts
  add column pending_claim_id uuid references app_private.pending_donation_claims(id) on delete set null;

create function api.create_pending_donation_claim(candidate_donation_id uuid) returns uuid
language plpgsql security definer set search_path=pg_catalog,app_private as $$
declare pending_id uuid;
begin
  perform app_private.assert_service_role();
  if not exists(select 1 from app_private.donation_claim_capabilities
    where donation_id=candidate_donation_id and consumed_at is null and expires_at>now()) then
    raise exception 'active donation claim required' using errcode='22023';
  end if;
  delete from app_private.pending_donation_claims where expires_at<now()-interval '1 day';
  insert into app_private.pending_donation_claims(donation_id,expires_at)
  values(candidate_donation_id,now()+interval '20 minutes') returning id into pending_id;
  return pending_id;
end $$;

drop function api.create_auth_login_attempt(text,text,jsonb,timestamptz);
create function api.create_auth_login_attempt(state_hash_value text,destination_value text,
  storage_value jsonb,expires_at_value timestamptz,pending_claim_value uuid default null) returns void
language plpgsql security definer set search_path=pg_catalog,app_private as $$
begin
  perform app_private.assert_service_role();
  if state_hash_value !~ '^[a-f0-9]{64}$' or destination_value not in ('/staff','/account','/partner')
    or jsonb_typeof(storage_value)<>'object' or expires_at_value<=now()
    or expires_at_value>now()+interval '20 minutes' then
    raise exception 'invalid login attempt' using errcode='22023';
  end if;
  if pending_claim_value is not null and (destination_value<>'/account' or not exists(
    select 1 from app_private.pending_donation_claims
    where id=pending_claim_value and consumed_at is null and expires_at>now())) then
    raise exception 'invalid pending claim' using errcode='22023';
  end if;
  delete from app_private.auth_login_attempts where expires_at<now()-interval '1 day';
  insert into app_private.auth_login_attempts(state_hash,destination,pkce_storage,expires_at,pending_claim_id)
  values(state_hash_value,destination_value,storage_value,expires_at_value,pending_claim_value);
end $$;

create or replace function api.consume_auth_login_attempt(state_hash_value text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,app_private as $$
declare attempt app_private.auth_login_attempts%rowtype;
begin
  perform app_private.assert_service_role();
  update app_private.auth_login_attempts set consumed_at=now()
  where state_hash=state_hash_value and consumed_at is null and expires_at>now()
  returning * into attempt;
  if attempt.state_hash is null then return null; end if;
  return jsonb_build_object('destination',attempt.destination,'storage',attempt.pkce_storage,
    'pendingClaimId',attempt.pending_claim_id);
end $$;

create function api.complete_pending_donation_claim(actor_user_id uuid,pending_claim_value uuid,
  verified_email text) returns jsonb language plpgsql security definer
set search_path=pg_catalog,app_private as $$
declare pending app_private.pending_donation_claims%rowtype; result jsonb;
begin
  perform app_private.assert_service_role();
  select * into pending from app_private.pending_donation_claims
  where id=pending_claim_value for update;
  if pending.id is null or pending.consumed_at is not null or pending.expires_at<=now() then
    raise exception 'pending claim expired or consumed' using errcode='22023';
  end if;
  result:=api.claim_donation(actor_user_id,pending.donation_id,verified_email);
  update app_private.pending_donation_claims set consumed_at=now() where id=pending.id;
  return result;
end $$;

revoke execute on function api.create_pending_donation_claim(uuid),
  api.create_auth_login_attempt(text,text,jsonb,timestamptz,uuid),
  api.complete_pending_donation_claim(uuid,uuid,text) from public,anon,authenticated;
grant execute on function api.create_pending_donation_claim(uuid),
  api.create_auth_login_attempt(text,text,jsonb,timestamptz,uuid),
  api.complete_pending_donation_claim(uuid,uuid,text) to service_role;

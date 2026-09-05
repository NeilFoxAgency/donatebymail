-- Production and beta must not report readiness against an older database
-- contract. This probe is deliberately service-only; the Worker compares the
-- version before exposing any operational HTTP surface.
create or replace function api.application_contract_version()
returns jsonb
language plpgsql
security definer
volatile
set search_path = pg_catalog, app_private
as $$
begin
  perform app_private.assert_service_role();
  if to_regprocedure('api.get_public_nonprofits()') is null
    or to_regprocedure('api.get_public_campaigns()') is null
    or to_regprocedure('api.get_public_nonprofit(text)') is null
    or to_regprocedure('api.get_public_campaign(text)') is null
    or to_regprocedure('api.get_published_articles()') is null
    or to_regprocedure('api.create_donation(jsonb,uuid,uuid,text,text)') is null
    or to_regprocedure('api.consume_anonymous_rate_limit(text,text,integer,integer)') is null
    or to_regprocedure('api.account_context(uuid)') is null
    or to_regprocedure('api.donor_account_overview(uuid)') is null
    or to_regprocedure('api.partner_workspace(uuid)') is null
    or to_regprocedure('api.staff_session_context(uuid)') is null
    or to_regprocedure('api.submit_partner_application(text,text,text,text,text,text,text,text,boolean,text,text)') is null
  then
    raise exception 'application contract incomplete' using errcode = '55000';
  end if;
  return jsonb_build_object('contractVersion', '20260808144611');
end;
$$;

revoke all on function api.application_contract_version()
  from public, anon, authenticated;
grant execute on function api.application_contract_version()
  to service_role;

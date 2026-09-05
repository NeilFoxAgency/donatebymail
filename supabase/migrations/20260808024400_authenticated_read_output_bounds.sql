-- Keep authenticated partner, donor, and staff read models bounded as the
-- underlying operational history grows. The original functions are retained
-- in app_private for their authorization and shape logic; API wrappers cap
-- repeated records without changing the JSON contract consumed by the site.

create or replace function app_private.bound_jsonb_array(value jsonb, maximum integer)
returns jsonb
language sql
immutable
strict
set search_path = pg_catalog
as $$
  select case
    when jsonb_typeof(value) <> 'array' or maximum < 1 then '[]'::jsonb
    else coalesce((
      select jsonb_agg(item order by ordinality)
      from jsonb_array_elements(value) with ordinality as elements(item, ordinality)
      where ordinality <= maximum
    ), '[]'::jsonb)
  end;
$$;

create or replace function app_private.bound_jsonb_array_field(value jsonb, field_name text, maximum integer)
returns jsonb
language sql
immutable
strict
set search_path = pg_catalog, app_private
as $$
  select jsonb_set(
    value,
    array[field_name],
    app_private.bound_jsonb_array(coalesce(value -> field_name, '[]'::jsonb), maximum),
    true
  );
$$;

alter function api.account_context(uuid) rename to account_context_unbounded;
alter function api.account_context_unbounded(uuid) set schema app_private;
alter function api.donor_account_overview(uuid) rename to donor_account_overview_unbounded;
alter function api.donor_account_overview_unbounded(uuid) set schema app_private;
alter function api.partner_campaign_detail(uuid, uuid) rename to partner_campaign_detail_unbounded;
alter function api.partner_campaign_detail_unbounded(uuid, uuid) set schema app_private;
alter function api.partner_campaign_workspace(uuid, uuid) rename to partner_campaign_workspace_unbounded;
alter function api.partner_campaign_workspace_unbounded(uuid, uuid) set schema app_private;
alter function api.partner_overview(uuid) rename to partner_overview_unbounded;
alter function api.partner_overview_unbounded(uuid) set schema app_private;
alter function api.partner_profile_detail(uuid, uuid) rename to partner_profile_detail_unbounded;
alter function api.partner_profile_detail_unbounded(uuid, uuid) set schema app_private;
alter function api.staff_campaign_overview(uuid) rename to staff_campaign_overview_unbounded;
alter function api.staff_campaign_overview_unbounded(uuid) set schema app_private;
alter function api.staff_financial_overview(uuid) rename to staff_financial_overview_unbounded;
alter function api.staff_financial_overview_unbounded(uuid) set schema app_private;
alter function api.staff_get_donation(uuid, uuid) rename to staff_get_donation_unbounded;
alter function api.staff_get_donation_unbounded(uuid, uuid) set schema app_private;
alter function api.staff_get_donation_financials(uuid, uuid) rename to staff_get_donation_financials_unbounded;
alter function api.staff_get_donation_financials_unbounded(uuid, uuid) set schema app_private;
alter function api.staff_partner_application_queue(uuid) rename to staff_partner_application_queue_unbounded;
alter function api.staff_partner_application_queue_unbounded(uuid) set schema app_private;
alter function api.staff_partner_overview(uuid) rename to staff_partner_overview_unbounded;
alter function api.staff_partner_overview_unbounded(uuid) set schema app_private;
alter function api.staff_partner_review_queue(uuid) rename to staff_partner_review_queue_unbounded;
alter function api.staff_partner_review_queue_unbounded(uuid) set schema app_private;

create function api.account_context(actor_user_id uuid)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, app_private, auth
as $$
declare result jsonb;
begin
  perform app_private.assert_service_role();
  result := app_private.account_context_unbounded(actor_user_id);
  return jsonb_set(coalesce(result, '{}'::jsonb), '{organizations}',
    app_private.bound_jsonb_array(coalesce(result->'organizations', '[]'::jsonb), 50), true);
end;
$$;

create function api.donor_account_overview(actor_user_id uuid)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, app_private
as $$
declare result jsonb;
begin
  perform app_private.assert_service_role();
  result := app_private.donor_account_overview_unbounded(actor_user_id);
  return jsonb_set(coalesce(result, '{}'::jsonb), '{donations}',
    app_private.bound_jsonb_array(coalesce(result->'donations', '[]'::jsonb), 50), true);
end;
$$;

create function api.partner_campaign_detail(actor_user_id uuid, candidate_campaign_id uuid)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, app_private
as $$
declare result jsonb;
begin
  perform app_private.assert_service_role();
  result := app_private.partner_campaign_detail_unbounded(actor_user_id, candidate_campaign_id);
  return jsonb_set(coalesce(result, '{}'::jsonb), '{revisions}',
    app_private.bound_jsonb_array(coalesce(result->'revisions', '[]'::jsonb), 100), true);
end;
$$;

create function api.partner_campaign_workspace(actor_user_id uuid, candidate_campaign_id uuid)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, app_private
as $$
declare result jsonb;
begin
  perform app_private.assert_service_role();
  result := app_private.partner_campaign_workspace_unbounded(actor_user_id, candidate_campaign_id);
  result := app_private.bound_jsonb_array_field(result, 'revisions', 100);
  result := app_private.bound_jsonb_array_field(result, 'assets', 100);
  result := app_private.bound_jsonb_array_field(result, 'reviews', 100);
  result := jsonb_set(result, '{financial,policyVersions}',
    app_private.bound_jsonb_array(coalesce(result#>'{financial,policyVersions}', '[]'::jsonb), 50), true);
  return result;
end;
$$;

create function api.partner_overview(actor_user_id uuid)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, app_private
as $$
declare result jsonb;
begin
  perform app_private.assert_service_role();
  result := app_private.partner_overview_unbounded(actor_user_id);
  select jsonb_build_object('organizations', coalesce(jsonb_agg(
    app_private.bound_jsonb_array_field(
      app_private.bound_jsonb_array_field(item, 'verifiedCharities', 50), 'campaigns', 100)
    order by ordinality) filter (where ordinality <= 50), '[]'::jsonb))
  into result
  from jsonb_array_elements(coalesce(result->'organizations', '[]'::jsonb)) with ordinality as elements(item, ordinality);
  return result;
end;
$$;

create function api.partner_profile_detail(actor_user_id uuid, candidate_organization_id uuid)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, app_private
as $$
declare result jsonb;
begin
  perform app_private.assert_service_role();
  result := app_private.partner_profile_detail_unbounded(actor_user_id, candidate_organization_id);
  result := app_private.bound_jsonb_array_field(result, 'revisions', 100);
  result := app_private.bound_jsonb_array_field(result, 'assets', 100);
  result := app_private.bound_jsonb_array_field(result, 'reviews', 100);
  return result;
end;
$$;

create or replace function api.partner_workspace(actor_user_id uuid)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, app_private
as $$
declare raw_workspace jsonb; result jsonb;
begin
  perform app_private.assert_service_role();
  raw_workspace := app_private.partner_workspace_unfiltered(actor_user_id);
  select jsonb_build_object('organizations', coalesce(jsonb_agg(
    app_private.bound_jsonb_array_field(
      app_private.bound_jsonb_array_field(
        app_private.bound_jsonb_array_field(
          app_private.bound_jsonb_array_field(
            case when organization->>'role'='partner_admin' then organization
              else jsonb_set(organization, '{invitations}', '[]'::jsonb, true) end,
            'verifiedCharities', 50),
          'campaigns', 100),
        'team', 100),
      'invitations', 100)
    order by ordinality) filter (where ordinality <= 50), '[]'::jsonb))
  into result
  from jsonb_array_elements(coalesce(raw_workspace->'organizations', '[]'::jsonb))
    with ordinality as items(organization, ordinality);
  return result;
end;
$$;

create function api.staff_campaign_overview(actor_user_id uuid)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, app_private
as $$
declare raw jsonb; result jsonb;
begin
  perform app_private.assert_service_role();
  raw := app_private.staff_campaign_overview_unbounded(actor_user_id);
  select jsonb_build_object('campaigns', coalesce(jsonb_agg(
    app_private.bound_jsonb_array_field(item, 'revisions', 100) order by ordinality)
      filter (where ordinality <= 500), '[]'::jsonb))
  into result
  from jsonb_array_elements(coalesce(raw->'campaigns', '[]'::jsonb)) with ordinality as elements(item, ordinality);
  return result;
end;
$$;

create function api.staff_financial_overview(actor_user_id uuid)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, app_private
as $$
declare result jsonb;
begin
  perform app_private.assert_service_role();
  result := app_private.staff_financial_overview_unbounded(actor_user_id);
  result := app_private.bound_jsonb_array_field(result, 'allocations', 500);
  result := app_private.bound_jsonb_array_field(result, 'disbursements', 200);
  return result;
end;
$$;

create function api.staff_get_donation(actor_user_id uuid, candidate_donation_id uuid)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, app_private
as $$
declare result jsonb;
begin
  perform app_private.assert_service_role();
  result := app_private.staff_get_donation_unbounded(actor_user_id, candidate_donation_id);
  result := app_private.bound_jsonb_array_field(result, 'devices', 100);
  result := app_private.bound_jsonb_array_field(result, 'notes', 100);
  result := app_private.bound_jsonb_array_field(result, 'events', 200);
  return result;
end;
$$;

create function api.staff_get_donation_financials(actor_user_id uuid, candidate_donation_id uuid)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, app_private
as $$
declare result jsonb;
begin
  perform app_private.assert_service_role();
  result := app_private.staff_get_donation_financials_unbounded(actor_user_id, candidate_donation_id);
  result := app_private.bound_jsonb_array_field(result, 'allocations', 100);
  result := app_private.bound_jsonb_array_field(result, 'sales', 100);
  result := app_private.bound_jsonb_array_field(result, 'costs', 100);
  return result;
end;
$$;

create function api.staff_partner_application_queue(actor_user_id uuid)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, app_private
as $$
declare result jsonb;
begin
  perform app_private.assert_service_role();
  result := app_private.staff_partner_application_queue_unbounded(actor_user_id);
  return jsonb_set(coalesce(result, '{}'::jsonb), '{applications}',
    app_private.bound_jsonb_array(coalesce(result->'applications', '[]'::jsonb), 500), true);
end;
$$;

create function api.staff_partner_overview(actor_user_id uuid)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, app_private
as $$
declare raw jsonb; result jsonb;
begin
  perform app_private.assert_service_role();
  raw := app_private.staff_partner_overview_unbounded(actor_user_id);
  select jsonb_build_object('organizations', coalesce(jsonb_agg(
    app_private.bound_jsonb_array_field(
      app_private.bound_jsonb_array_field(
        app_private.bound_jsonb_array_field(
          app_private.bound_jsonb_array_field(item, 'charities', 100), 'members', 100),
        'invitations', 100), 'campaigns', 200)
    order by ordinality) filter (where ordinality <= 500), '[]'::jsonb))
  into result
  from jsonb_array_elements(coalesce(raw->'organizations', '[]'::jsonb)) with ordinality as elements(item, ordinality);
  return result;
end;
$$;

create function api.staff_partner_review_queue(actor_user_id uuid)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, app_private
as $$
declare result jsonb;
begin
  perform app_private.assert_service_role();
  result := app_private.staff_partner_review_queue_unbounded(actor_user_id);
  result := app_private.bound_jsonb_array_field(result, 'applications', 500);
  result := app_private.bound_jsonb_array_field(result, 'profiles', 500);
  result := app_private.bound_jsonb_array_field(result, 'campaigns', 500);
  return result;
end;
$$;

revoke execute on function app_private.bound_jsonb_array(jsonb, integer),
  app_private.bound_jsonb_array_field(jsonb, text, integer),
  app_private.account_context_unbounded(uuid), app_private.donor_account_overview_unbounded(uuid),
  app_private.partner_campaign_detail_unbounded(uuid, uuid), app_private.partner_campaign_workspace_unbounded(uuid, uuid),
  app_private.partner_overview_unbounded(uuid), app_private.partner_profile_detail_unbounded(uuid, uuid),
  app_private.staff_campaign_overview_unbounded(uuid), app_private.staff_financial_overview_unbounded(uuid),
  app_private.staff_get_donation_unbounded(uuid, uuid), app_private.staff_get_donation_financials_unbounded(uuid, uuid),
  app_private.staff_partner_application_queue_unbounded(uuid), app_private.staff_partner_overview_unbounded(uuid),
  app_private.staff_partner_review_queue_unbounded(uuid)
  from public, anon, authenticated;
grant execute on function app_private.bound_jsonb_array(jsonb, integer),
  app_private.bound_jsonb_array_field(jsonb, text, integer),
  app_private.account_context_unbounded(uuid), app_private.donor_account_overview_unbounded(uuid),
  app_private.partner_campaign_detail_unbounded(uuid, uuid), app_private.partner_campaign_workspace_unbounded(uuid, uuid),
  app_private.partner_overview_unbounded(uuid), app_private.partner_profile_detail_unbounded(uuid, uuid),
  app_private.staff_campaign_overview_unbounded(uuid), app_private.staff_financial_overview_unbounded(uuid),
  app_private.staff_get_donation_unbounded(uuid, uuid), app_private.staff_get_donation_financials_unbounded(uuid, uuid),
  app_private.staff_partner_application_queue_unbounded(uuid), app_private.staff_partner_overview_unbounded(uuid),
  app_private.staff_partner_review_queue_unbounded(uuid)
  to service_role;

revoke execute on function api.account_context(uuid), api.donor_account_overview(uuid),
  api.partner_campaign_detail(uuid, uuid), api.partner_campaign_workspace(uuid, uuid), api.partner_overview(uuid),
  api.partner_profile_detail(uuid, uuid), api.partner_workspace(uuid), api.staff_campaign_overview(uuid),
  api.staff_financial_overview(uuid), api.staff_get_donation(uuid, uuid), api.staff_get_donation_financials(uuid, uuid),
  api.staff_partner_application_queue(uuid), api.staff_partner_overview(uuid), api.staff_partner_review_queue(uuid)
  from public, anon, authenticated;
grant execute on function api.account_context(uuid), api.donor_account_overview(uuid),
  api.partner_campaign_detail(uuid, uuid), api.partner_campaign_workspace(uuid, uuid), api.partner_overview(uuid),
  api.partner_profile_detail(uuid, uuid), api.partner_workspace(uuid), api.staff_campaign_overview(uuid),
  api.staff_financial_overview(uuid), api.staff_get_donation(uuid, uuid), api.staff_get_donation_financials(uuid, uuid),
  api.staff_partner_application_queue(uuid), api.staff_partner_overview(uuid), api.staff_partner_review_queue(uuid)
  to service_role;

-- Keep donor-facing charity labels tied to the verified internal charity row.
-- The browser supplies a Pledge UUID, but its display name and optional
-- metadata are untrusted presentation data.  Canonicalize the name/EIN at the
-- database boundary so a stale or manipulated widget response cannot make a
-- donation appear to support a different organization.

update app_private.donations d
set selected_charity_name = ch.canonical_name,
    selected_charity_ein = ch.ein
from app_private.charities ch
where ch.pledge_id = d.selected_charity_pledge_id;

create or replace function app_private.canonicalize_donation_charity()
returns trigger
language plpgsql
set search_path = pg_catalog, app_private
as $$
declare
  charity_row app_private.charities%rowtype;
begin
  select * into charity_row
  from app_private.charities
  where pledge_id = new.selected_charity_pledge_id;
  -- The public Pledge picker can select a nonprofit that has not yet been
  -- added to the private partner-verification table.  Keep that existing
  -- policy (the Worker still validates the Pledge UUID) while canonicalizing
  -- every charity that Donate by Mail has verified internally.
  if found and charity_row.status = 'verified' then
    new.selected_charity_name := charity_row.canonical_name;
    new.selected_charity_ein := charity_row.ein;
  end if;
  return new;
end;
$$;

drop trigger if exists donations_canonical_charity on app_private.donations;
create trigger donations_canonical_charity
before insert on app_private.donations
for each row execute function app_private.canonicalize_donation_charity();

create function api.get_donation_charity(candidate_donation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, app_private
as $$
declare result jsonb;
begin
  perform app_private.assert_service_role();
  select jsonb_build_object(
    'pledgeId', d.selected_charity_pledge_id,
    'name', d.selected_charity_name,
    'ein', d.selected_charity_ein
  )
  into result
  from app_private.donations d
  where d.id = candidate_donation_id;
  return result;
end;
$$;

revoke execute on function app_private.canonicalize_donation_charity() from public, anon, authenticated;
grant execute on function app_private.canonicalize_donation_charity() to service_role;
revoke execute on function api.get_donation_charity(uuid) from public, anon, authenticated;
grant execute on function api.get_donation_charity(uuid) to service_role;

-- Economic and effective-date fields on a proceeds policy version are immutable.
-- Lifecycle and approval metadata may advance, but changing terms requires a
-- new version so historical calculations remain reproducible.

create or replace function app_private.protect_proceeds_policy_version_history()
returns trigger
language plpgsql
set search_path = pg_catalog, app_private
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'policy version history cannot be deleted' using errcode = '22023';
  end if;

  if new.policy_id is distinct from old.policy_id
    or new.version is distinct from old.version
    or new.share_basis_points is distinct from old.share_basis_points
    or new.calculation_method is distinct from old.calculation_method
    or new.currency is distinct from old.currency
    or new.eligibility_rule_schema_version is distinct from old.eligibility_rule_schema_version
    or new.eligibility_rules is distinct from old.eligibility_rules
    or new.effective_from is distinct from old.effective_from
    or new.effective_to is distinct from old.effective_to
    or new.created_by is distinct from old.created_by
    or new.created_at is distinct from old.created_at
  then
    raise exception 'policy version effective dates and eligibility are immutable' using errcode = '22023';
  end if;

  return new;
end;
$$;

drop trigger if exists proceeds_policy_versions_history_guard
  on app_private.proceeds_policy_versions;
create trigger proceeds_policy_versions_history_guard
before update or delete on app_private.proceeds_policy_versions
for each row execute function app_private.protect_proceeds_policy_version_history();

revoke all on function app_private.protect_proceeds_policy_version_history()
  from public, anon, authenticated;
grant execute on function app_private.protect_proceeds_policy_version_history()
  to service_role;

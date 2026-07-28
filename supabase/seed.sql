-- Local development data only. Remote beta migrations do not execute this file.
with policy as (
  insert into app_private.proceeds_policies (
    id, policy_key, name, purpose, lifecycle
  ) values (
    '10000000-0000-0000-0000-000000000001',
    'local_example_general',
    'Local example general-donation policy',
    'Demonstrates a configurable 50 percent draft without activating a public policy.',
    'draft'
  )
  on conflict (id) do update set name = excluded.name
  returning id
)
insert into app_private.proceeds_policy_versions (
  id, policy_id, version, lifecycle, share_basis_points,
  calculation_method, effective_from
)
select
  '10000000-0000-0000-0000-000000000002',
  id,
  1,
  'draft',
  5000,
  'net_proceeds_share',
  '2026-01-01T00:00:00Z'
from policy
on conflict (id) do nothing;

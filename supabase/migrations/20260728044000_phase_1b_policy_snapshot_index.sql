-- Cover the optional policy snapshot foreign key used by later proceeds resolution.
create index donations_policy_version_snapshot_idx
  on app_private.donations (policy_version_snapshot_id)
  where policy_version_snapshot_id is not null;

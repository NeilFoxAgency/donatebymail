-- Expose only the intentionally narrow RPC schema through PostgREST.
-- Operational tables remain in app_private and have no Data API grants.
alter role authenticator set pgrst.db_schemas = 'public,graphql_public,api';
notify pgrst, 'reload config';

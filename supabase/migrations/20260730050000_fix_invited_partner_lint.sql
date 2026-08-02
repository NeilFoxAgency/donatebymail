-- The service-role assertion is intentionally volatile, so this authorization
-- predicate must not be marked STABLE by PostgreSQL's routine linter.
alter function api.is_invited_partner_email(text) volatile;

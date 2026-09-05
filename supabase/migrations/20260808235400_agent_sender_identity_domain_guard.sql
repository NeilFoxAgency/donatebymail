-- Outbound messages are evidence of a send performed by an approved Donate by
-- Mail sender.  Keeping this invariant at the journal boundary prevents a
-- compromised connector from making an external identity look like the
-- sender while still allowing provider-attested external identities on
-- inbound messages.
create or replace function app_private.validate_outbound_sender_identity()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, app_private
as $$
declare
  normalized_sender text := lower(btrim(coalesce(new.sender_identity_ref, '')));
begin
  if new.direction = 'outbound' then
    if normalized_sender !~ '^[a-z0-9._%+-]+@donatebymail\.org$' then
      raise exception 'approved sender identity required' using errcode = '22023';
    end if;
    new.sender_identity_ref := normalized_sender;
  end if;
  return new;
end;
$$;

drop trigger if exists communication_messages_outbound_sender_guard
  on app_private.communication_messages;
create trigger communication_messages_outbound_sender_guard
before insert or update of direction, sender_identity_ref
on app_private.communication_messages
for each row execute function app_private.validate_outbound_sender_identity();

revoke all on function app_private.validate_outbound_sender_identity() from public, anon, authenticated;
grant execute on function app_private.validate_outbound_sender_identity() to service_role;

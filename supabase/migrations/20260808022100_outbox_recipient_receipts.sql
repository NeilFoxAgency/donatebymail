-- Track successful recipient-level sends independently from completion of the
-- parent outbox event. This prevents a partial multi-recipient delivery from
-- replaying recipients that already succeeded.

create function api.outbox_handler_receipt_exists(p_event_id uuid,p_handler_name text)
returns boolean language plpgsql security definer volatile
set search_path=pg_catalog,app_private as $$
begin
  perform app_private.assert_service_role();
  if p_handler_name !~ '^[a-z][a-z0-9_.-]{2,119}$' then
    raise exception 'bounded outbox handler name required' using errcode='22023'; end if;
  return exists(select 1 from app_private.outbox_handler_receipts
    where outbox_event_id=p_event_id and app_private.outbox_handler_receipts.handler_name=p_handler_name);
end $$;

create function api.record_outbox_handler_receipt(p_event_id uuid,p_handler_name text,p_result_metadata jsonb default '{}'::jsonb)
returns boolean language plpgsql security definer
set search_path=pg_catalog,app_private as $$
begin
  perform app_private.assert_service_role();
  if p_handler_name !~ '^[a-z][a-z0-9_.-]{2,119}$' or jsonb_typeof(p_result_metadata)<>'object' then
    raise exception 'bounded outbox handler receipt required' using errcode='22023'; end if;
  if not exists(select 1 from app_private.outbox_events where id=p_event_id) then
    raise exception 'outbox event not found' using errcode='22023'; end if;
  insert into app_private.outbox_handler_receipts(outbox_event_id,handler_name,result_metadata)
    values(p_event_id,p_handler_name,p_result_metadata) on conflict(outbox_event_id,handler_name) do nothing;
  return true;
end $$;

revoke execute on function api.outbox_handler_receipt_exists(uuid,text),
  api.record_outbox_handler_receipt(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function api.outbox_handler_receipt_exists(uuid,text),
  api.record_outbox_handler_receipt(uuid,text,jsonb) to service_role;

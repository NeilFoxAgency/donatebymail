-- Let an idempotent donor retry recover the durable notification event that
-- belongs to its existing donation. This keeps tracking/claim links and the
-- notification-pending state truthful after a client-side timeout.

create function api.get_donation_notification_event(candidate_donation_id uuid)
returns jsonb
language plpgsql
security definer
volatile
set search_path = pg_catalog, app_private
as $$
declare result jsonb;
begin
  perform app_private.assert_service_role();
  select jsonb_build_object(
    'eventId', o.id,
    'eventType', o.event_type,
    'status', o.status
  )
  into result
  from app_private.outbox_events o
  join app_private.domain_events d on d.id = o.domain_event_id
  where d.aggregate_type = 'donation'
    and d.aggregate_id = candidate_donation_id
    and d.event_type = 'donation.created'
    and o.handler_key = 'donation_notifications'
  order by o.created_at desc
  limit 1;
  return result;
end;
$$;

revoke execute on function api.get_donation_notification_event(uuid) from public, anon, authenticated;
grant execute on function api.get_donation_notification_event(uuid) to service_role;

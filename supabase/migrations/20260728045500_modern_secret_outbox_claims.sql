-- Apply modern secret-key claim handling to the pre-Phase-1B outbox RPCs.
create or replace function api.claim_outbox_events(
  worker_id text, batch_size integer default 20, lease_seconds integer default 60
)
returns table (id uuid, domain_event_id uuid, handler_key text, event_type text,
  payload jsonb, attempt_count integer, max_attempts integer, locked_until timestamptz)
language plpgsql security definer set search_path = pg_catalog, app_private
as $$
begin
  if coalesce(current_setting('request.jwt.claim.role', true),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if char_length(worker_id) not between 3 and 120
     or batch_size not between 1 and 100 or lease_seconds not between 10 and 900 then
    raise exception 'invalid outbox lease bounds' using errcode = '22023';
  end if;
  return query with candidates as (
    select candidate.id from app_private.outbox_events candidate
    where candidate.status in ('pending', 'retry') and candidate.available_at <= now()
      and (candidate.locked_until is null or candidate.locked_until < now())
      and candidate.attempt_count < candidate.max_attempts
    order by candidate.available_at, candidate.created_at for update skip locked limit batch_size
  ) update app_private.outbox_events event set status = 'processing', locked_by = worker_id,
      locked_until = now() + make_interval(secs => lease_seconds),
      attempt_count = event.attempt_count + 1, updated_at = now()
    from candidates where event.id = candidates.id
    returning event.id, event.domain_event_id, event.handler_key, event.event_type,
      event.payload, event.attempt_count, event.max_attempts, event.locked_until;
end;
$$;

create or replace function api.complete_outbox_event(event_id uuid, worker_id text)
returns boolean language plpgsql security definer set search_path = pg_catalog, app_private
as $$
declare changed integer;
begin
  if coalesce(current_setting('request.jwt.claim.role', true),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  update app_private.outbox_events set status = 'completed', completed_at = now(),
    locked_by = null, locked_until = null, last_error_code = null, updated_at = now()
  where id = event_id and status = 'processing' and locked_by = worker_id;
  get diagnostics changed = row_count; return changed = 1;
end;
$$;

create or replace function api.fail_outbox_event(event_id uuid, worker_id text,
  retry_at timestamptz, error_code text, retryable boolean default true)
returns boolean language plpgsql security definer set search_path = pg_catalog, app_private
as $$
declare changed integer;
begin
  if coalesce(current_setting('request.jwt.claim.role', true),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if error_code is null or char_length(error_code) not between 1 and 160 then
    raise exception 'invalid redacted error code' using errcode = '22023';
  end if;
  update app_private.outbox_events set status = case when retryable and attempt_count < max_attempts
      then 'retry'::app_private.outbox_status else 'failed'::app_private.outbox_status end,
    available_at = case when retryable and attempt_count < max_attempts then retry_at else available_at end,
    locked_by = null, locked_until = null, last_error_code = error_code, updated_at = now()
  where id = event_id and status = 'processing' and locked_by = worker_id;
  get diagnostics changed = row_count; return changed = 1;
end;
$$;

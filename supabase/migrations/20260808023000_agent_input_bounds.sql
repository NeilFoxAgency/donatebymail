-- Keep the service-only communication journal bounded even when a caller
-- reaches the table through a future code path rather than the agent RPC.

create or replace function app_private.validate_article_blocks(blocks jsonb)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog, app_private
as $$
declare block jsonb; block_type text; item_value jsonb; item text;
begin
  if jsonb_typeof(blocks) <> 'array' or jsonb_array_length(blocks) not between 1 and 50 then return false; end if;
  for block in select value from jsonb_array_elements(blocks) loop
    if jsonb_typeof(block) <> 'object' then return false; end if;
    block_type := block->>'type';
    if block_type in ('paragraph', 'quote') then
      if jsonb_typeof(block->'text') <> 'string' or char_length(block->>'text') not between 1 and 4000 then return false; end if;
    elsif block_type = 'heading' then
      if jsonb_typeof(block->'text') <> 'string' or char_length(block->>'text') not between 1 and 180 then return false; end if;
      if coalesce((block->>'level')::integer, 0) not between 2 and 4 then return false; end if;
    elsif block_type = 'list' then
      if jsonb_typeof(block->'items') <> 'array' or jsonb_array_length(block->'items') not between 1 and 24 then return false; end if;
      for item_value in select value from jsonb_array_elements(block->'items') loop
        if jsonb_typeof(item_value) <> 'string' then
          return false;
        end if;
        item := item_value #>> '{}';
        if char_length(item) not between 1 and 400 then return false; end if;
      end loop;
    elsif block_type = 'link' then
      if jsonb_typeof(block->'label') <> 'string' or char_length(block->>'label') not between 1 and 180 then return false; end if;
      if jsonb_typeof(block->'href') <> 'string' or char_length(block->>'href') not between 1 and 1000 then return false; end if;
      if (block->>'href') !~ '^(/|https://)[^[:space:]<>"'']+$'
        or (block->>'href') ~ '^//'
        or position(chr(92) in block->>'href') > 0 then return false; end if;
    else
      return false;
    end if;
  end loop;
  return true;
exception when others then
  return false;
end;
$$;

create or replace function app_private.validate_communication_message_refs()
returns trigger
language plpgsql
volatile
set search_path = pg_catalog, app_private
as $$
declare
  normalized jsonb;
begin
  if jsonb_typeof(new.recipient_identity_refs) <> 'array' then
    raise exception 'bounded recipient email references required' using errcode = '22023';
  end if;
  if jsonb_array_length(new.recipient_identity_refs) not between 1 and 25 then
    raise exception 'bounded recipient email references required' using errcode = '22023';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(new.recipient_identity_refs) as elements(element)
    where jsonb_typeof(element) <> 'string'
      or char_length(btrim(element #>> '{}')) not between 3 and 320
      or btrim(element #>> '{}') !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  ) then
    raise exception 'bounded recipient email references required' using errcode = '22023';
  end if;

  select jsonb_agg(to_jsonb(lower(btrim(element #>> '{}'))) order by ordinal)
  into normalized
  from jsonb_array_elements(new.recipient_identity_refs) with ordinality as elements(element, ordinal);
  new.recipient_identity_refs := normalized;
  return new;
end;
$$;

drop trigger if exists communication_messages_recipient_bounds
  on app_private.communication_messages;
create trigger communication_messages_recipient_bounds
before insert on app_private.communication_messages
for each row execute function app_private.validate_communication_message_refs();

revoke all on function app_private.validate_communication_message_refs() from public, anon, authenticated;
grant execute on function app_private.validate_communication_message_refs() to service_role;

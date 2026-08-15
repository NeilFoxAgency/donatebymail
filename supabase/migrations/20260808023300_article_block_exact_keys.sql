-- Keep the database validator aligned with the agent and browser schemas:
-- article blocks are a closed union, so ignored properties cannot smuggle a
-- second representation into an immutable content hash or published page.

create or replace function app_private.validate_article_blocks(blocks jsonb)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog, app_private
as $$
declare
  block jsonb;
  block_type text;
  item_value jsonb;
  item text;
begin
  if jsonb_typeof(blocks) <> 'array' or jsonb_array_length(blocks) not between 1 and 50 then return false; end if;
  for block in select value from jsonb_array_elements(blocks) loop
    if jsonb_typeof(block) <> 'object' then return false; end if;
    block_type := block->>'type';
    if block_type in ('paragraph', 'quote') then
      if exists(select 1 from jsonb_object_keys(block) as keys(key) where key not in ('type', 'text'))
        or jsonb_typeof(block->'text') <> 'string'
        or char_length(block->>'text') not between 1 and 4000 then return false; end if;
    elsif block_type = 'heading' then
      if exists(select 1 from jsonb_object_keys(block) as keys(key) where key not in ('type', 'level', 'text'))
        or (block->>'level') not in ('2', '3', '4')
        or jsonb_typeof(block->'text') <> 'string'
        or char_length(block->>'text') not between 1 and 180
        then return false; end if;
    elsif block_type = 'list' then
      if exists(select 1 from jsonb_object_keys(block) as keys(key) where key not in ('type', 'ordered', 'items'))
        or jsonb_typeof(block->'ordered') <> 'boolean'
        or jsonb_typeof(block->'items') <> 'array'
        or jsonb_array_length(block->'items') not between 1 and 24 then return false; end if;
      for item_value in select value from jsonb_array_elements(block->'items') loop
        if jsonb_typeof(item_value) <> 'string' then return false; end if;
        item := item_value #>> '{}';
        if char_length(item) not between 1 and 400 then return false; end if;
      end loop;
    elsif block_type = 'link' then
      if exists(select 1 from jsonb_object_keys(block) as keys(key) where key not in ('type', 'label', 'href'))
        or jsonb_typeof(block->'label') <> 'string'
        or char_length(block->>'label') not between 1 and 180
        or jsonb_typeof(block->'href') <> 'string'
        or char_length(block->>'href') not between 1 and 1000 then return false; end if;
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

revoke all on function app_private.validate_article_blocks(jsonb) from public, anon, authenticated;
grant execute on function app_private.validate_article_blocks(jsonb) to service_role;

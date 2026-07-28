begin;

create extension if not exists pgtap with schema extensions;

select plan(36);

select has_table('app_private', 'donor_contacts', 'private donor contacts exist');
select has_table('app_private', 'donations', 'persistent donations exist');
select has_table('app_private', 'donation_devices', 'actual device records exist');
select has_table('app_private', 'donation_status_events', 'donor status history exists');
select has_table('app_private', 'donation_internal_notes', 'internal notes exist');

select is(
  (
    select count(*)::bigint from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'app_private'
      and c.relname in (
        'donor_contacts', 'donations', 'donation_devices',
        'donation_status_events', 'donation_internal_notes', 'donor_account_links'
      ) and not c.relrowsecurity
  ),
  0::bigint,
  'RLS is enabled on every Phase 1B private table'
);
select is(
  has_table_privilege('anon', 'app_private.donor_contacts', 'select'),
  false,
  'anonymous callers cannot read donor PII'
);
select is(
  has_table_privilege('authenticated', 'app_private.donations', 'select'),
  false,
  'authenticated callers cannot query donations directly'
);
select is(
  has_function_privilege('anon', 'api.create_donation(jsonb,uuid)', 'execute'),
  false,
  'anonymous callers cannot execute donation intake directly'
);
select is(
  has_function_privilege('service_role', 'api.create_donation(jsonb,uuid)', 'execute'),
  true,
  'the Worker service role can execute narrow donation intake'
);

select set_config('request.jwt.claim.role', 'service_role', true);

create temporary table phase_1b_result as
select api.create_donation(
  '{
    "id":"client-beta-0001",
    "createdAt":"2026-07-28T04:30:00Z",
    "shippingMethod":"label",
    "donor":{
      "firstName":"Beta","middleName":"","lastName":"Donor",
      "email":"beta.donor@example.com","address1":"123 Test St",
      "address2":"","city":"Kissimmee","state":"FL","zip":"34741",
      "country":"US","marketingEmailConsent":false
    },
    "charity":{
      "pledgeId":"3685b542-61d5-45da-9580-162dca725966",
      "name":"American Kidney Fund"
    },
    "devices":[
      {"id":"phone-1","brand":"Apple","model":"iPhone 13",
       "age":"2-3 years","condition":"Good","storage":"128 GB",
       "powersOn":true,"unlocked":true},
      {"id":"phone-2","brand":"Google","model":"Pixel 7",
       "age":"2-3 years","condition":"Fair","storage":"128 GB",
       "powersOn":true,"unlocked":false}
    ]
  }'::jsonb,
  '71000000-0000-4000-8000-000000000001'::uuid
) as result;

select matches(
  (select result ->> 'publicId' from phase_1b_result),
  '^DBM-[0-9]{8}-[A-F0-9]{8}$',
  'the server creates the canonical public donation ID'
);
select is(
  (select count(*)::bigint from app_private.donor_contacts), 1::bigint,
  'donor PII is stored in the separate private contact table'
);
select is(
  (select count(*)::bigint from app_private.donation_devices), 2::bigint,
  'all donor-described devices persist'
);
select is(
  (select count(*)::bigint from app_private.audit_events
    where metadata ? 'email' or redacted_changes ? 'email'),
  0::bigint,
  'audit records do not copy donor email addresses'
);
select is(
  (select count(*)::bigint from app_private.outbox_events
    where handler_key = 'donation_notifications' and status = 'pending'),
  1::bigint,
  'donation creation atomically creates a notification outbox item'
);
select is(
  (api.create_donation(
    jsonb_build_object(
      'id','client-beta-0001','donor','{}'::jsonb,'charity','{}'::jsonb,
      'devices','[]'::jsonb
    ), '71000000-0000-4000-8000-000000000002'::uuid
  ) ->> 'created')::boolean,
  false,
  'the client submission key makes intake idempotent'
);
select is(
  (select count(*)::bigint from app_private.donations), 1::bigint,
  'idempotent replay does not duplicate the donation'
);
select ok(
  api.get_donation_tracking_material(
    (select result ->> 'publicId' from phase_1b_result)
  ) ? 'trackingNonce',
  'the service can fetch capability-token verification material'
);
select is(
  api.get_donation_status(
    (select result ->> 'publicId' from phase_1b_result)
  ) ? 'donor',
  false,
  'donor status payload does not expose contact PII'
);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at
) values (
  '72000000-0000-4000-8000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'staff-beta@example.com', '',
  now(), now(), now()
);
insert into app_private.profiles (user_id, display_name)
values ('72000000-0000-4000-8000-000000000001', 'Beta Staff');
insert into app_private.staff_memberships (user_id, role, status, activated_at)
values ('72000000-0000-4000-8000-000000000001', 'admin', 'active', now());

select throws_ok(
  $$select api.staff_search_donations(
    '72000000-0000-4000-8000-000000000099', '', 25
  )$$,
  '42501', 'active staff membership required',
  'staff search fails closed for a non-member'
);
select is(
  jsonb_array_length(api.staff_search_donations(
    '72000000-0000-4000-8000-000000000001', 'kidney', 25
  )),
  1,
  'active staff can search donations by charity'
);
select lives_ok(
  format(
    $$select api.staff_record_receipt(
      '72000000-0000-4000-8000-000000000001', %L::uuid, now(),
      'Package intact', %L::jsonb
    )$$,
    (select result ->> 'donationId' from phase_1b_result),
    (select jsonb_agg(jsonb_build_object(
      'deviceId', id, 'received', donor_device_key = 'phone-1'
    ))::text from app_private.donation_devices)
  ),
  'human staff can record physical receipt and actual device presence'
);
select is(
  (select status::text from app_private.donations), 'received',
  'receipt moves the donation to received'
);
select results_eq(
  $$select receipt_status::text from app_private.donation_devices order by donor_device_key$$,
  array['received'::text, 'missing'::text],
  'receipt records which expected devices actually arrived'
);
select is(
  (select count(*)::bigint from app_private.audit_events
    where action_name = 'donation.record_physical_receipt'),
  1::bigint,
  'physical receipt is audited'
);
select lives_ok(
  format(
    $$select api.staff_update_device(
      '72000000-0000-4000-8000-000000000001', %L::uuid, %L::uuid,
      '{"actualBrand":"Apple","actualModel":"iPhone 13",
        "inspectionStatus":"inspected","processingStatus":"resale",
        "dataWipeStatus":"completed","assessedValueCents":22500}'::jsonb
    )$$,
    (select result ->> 'donationId' from phase_1b_result),
    (select id from app_private.donation_devices where donor_device_key = 'phone-1')
  ),
  'human staff can record inspection, processing, wipe, and valuation facts'
);
select ok(
  (select assessed_value_cents = 22500 and valued_by is not null
     and data_wipe_status = 'completed' and wipe_verified_by is not null
   from app_private.donation_devices where donor_device_key = 'phone-1'),
  'valuation and wipe verification retain staff attribution'
);
select lives_ok(
  format(
    $$select api.staff_add_internal_note(
      '72000000-0000-4000-8000-000000000001', %L::uuid, 'Battery is swollen.'
    )$$,
    (select result ->> 'donationId' from phase_1b_result)
  ),
  'staff can add an internal operational note'
);
select throws_ok(
  $$update app_private.donation_internal_notes set body = 'rewritten'$$,
  '55000', 'donation_internal_notes is append-only',
  'internal note history cannot be rewritten'
);
select throws_ok(
  format(
    $$select api.staff_change_donation_status(
      '72000000-0000-4000-8000-000000000001', %L::uuid, 'completed', 'Done.'
    )$$,
    (select result ->> 'donationId' from phase_1b_result)
  ),
  '22023', 'invalid donation status transition',
  'invalid operational status transitions fail closed'
);
select lives_ok(
  format(
    $$select api.staff_change_donation_status(
      '72000000-0000-4000-8000-000000000001', %L::uuid, 'inspecting',
      'Your donated devices are being inspected.'
    )$$,
    (select result ->> 'donationId' from phase_1b_result)
  ),
  'staff can make an allowed donor-visible transition'
);
select is(
  (select count(*)::bigint from app_private.donation_status_events
    where donor_visible and status = 'inspecting'),
  1::bigint,
  'donor-visible status history records the transition'
);
select set_config('request.jwt.claim.role', '', true);
select throws_ok(
  $$select api.get_donation_tracking_material('DBM-20260728-AAAAAAAA')$$,
  '42501', 'service role required',
  'tracking material fails closed without the service claim'
);
select is(
  has_function_privilege(
    'authenticated', 'api.staff_get_donation(uuid,uuid)', 'execute'
  ),
  false,
  'authenticated users cannot bypass the Worker to call staff RPCs'
);
select set_config('request.jwt.claim.role', 'service_role', true);
select lives_ok(
  format(
    $$select api.staff_add_unexpected_device(
      '72000000-0000-4000-8000-000000000001', %L::uuid, 'Samsung', 'Unknown A'
    )$$,
    (select result ->> 'donationId' from phase_1b_result)
  ),
  'staff can record one unexpected physical device'
);
select lives_ok(
  format(
    $$select api.staff_add_unexpected_device(
      '72000000-0000-4000-8000-000000000001', %L::uuid, 'Google', 'Unknown B'
    )$$,
    (select result ->> 'donationId' from phase_1b_result)
  ),
  'multiple unexpected devices can be recorded independently'
);

select * from finish();
rollback;

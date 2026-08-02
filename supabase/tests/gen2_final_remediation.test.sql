begin;
create extension if not exists pgtap with schema extensions;
select plan(42);
select set_config('request.jwt.claim.role','service_role',true);

insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at)
values
('a3000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','finance-remediation@example.com','',now(),now(),now()),
('a3000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','donor-remediation@example.com','',now(),now(),now());
insert into app_private.profiles(user_id) values
('a3000000-0000-4000-8000-000000000001'),('a3000000-0000-4000-8000-000000000002');
insert into app_private.staff_memberships(user_id,role,status,activated_at)
values('a3000000-0000-4000-8000-000000000001','admin','active',now());
insert into app_private.charities(id,pledge_id,canonical_name,status,verified_by,verified_at)
values('a3000000-0000-4000-8000-000000000010','3685b542-61d5-45da-9580-162dca725966','Remediation Charity','verified','a3000000-0000-4000-8000-000000000001',now());
insert into app_private.proceeds_policies(id,policy_key,name,purpose,lifecycle)
values('a3000000-0000-4000-8000-000000000020','remediation_policy','Remediation policy','Tests configurable cost semantics','active');
insert into app_private.proceeds_policy_versions(id,policy_id,version,lifecycle,share_basis_points,calculation_method,effective_from,approved_by,approved_at)
values('a3000000-0000-4000-8000-000000000021','a3000000-0000-4000-8000-000000000020',1,'active',5000,'net_proceeds_share','2026-01-01','a3000000-0000-4000-8000-000000000001',now());
insert into app_private.proceeds_policy_assignments(policy_version_id,scope,precedence,effective_from)
values('a3000000-0000-4000-8000-000000000021','general',1,'2026-01-01');
insert into app_private.proceeds_policy_cost_rules(policy_version_id,cost_category,deductible,allocation_method,cap_basis_points,priority,metadata)
values
('a3000000-0000-4000-8000-000000000021','direct_cost',true,'direct',null,50,'{}'),
('a3000000-0000-4000-8000-000000000021','shared_cost',true,'pro_rata',null,40,'{}'),
('a3000000-0000-4000-8000-000000000021','capped_cost',true,'capped',500,30,'{}'),
('a3000000-0000-4000-8000-000000000021','fixed_cost',true,'fixed',null,20,'{"fixed_cents":250}'),
('a3000000-0000-4000-8000-000000000021','not_deductible',false,'direct',null,100,'{}');

select is(app_private.calculate_policy_cost_cents(1000,'direct',null,'{}',10000),1000::bigint,'direct cost is applied in full');
select is(app_private.calculate_policy_cost_cents(501,'pro_rata',null,'{}',10000),501::bigint,'shared pro-rata cost is applied exactly once');
select is(app_private.calculate_policy_cost_cents(2000,'capped',500,'{}',10000),500::bigint,'capped cost above five percent is capped at gross basis');
select is(app_private.calculate_policy_cost_cents(200,'capped',500,'{}',10000),200::bigint,'capped cost below cap is unchanged');
select is(app_private.calculate_policy_cost_cents(900,'fixed',null,'{"fixed_cents":250}',10000),250::bigint,'fixed cost uses explicit policy metadata');
select is(app_private.calculate_policy_cost_cents(900,'fixed',null,'{}',10000),null::bigint,'fixed cost without semantics fails closed');

create temporary table finance_fixture as select api.create_donation(
  '{"clientSubmissionKey":"a3000000-0000-4000-8000-000000000100","shippingMethod":"label","donor":{"firstName":"Remediation","middleName":"","lastName":"Donor","email":"donor-remediation@example.com","address1":"1 Main","address2":"","city":"Kissimmee","state":"FL","zip":"34741","country":"US","marketingEmailConsent":false},"charity":{"pledgeId":"3685b542-61d5-45da-9580-162dca725966","name":"Remediation Charity"},"devices":[{"id":"r1","brand":"Apple","model":"Phone","age":"2-3 years","condition":"Good","storage":"128 GB","powersOn":true,"unlocked":true}]}'::jsonb,
  'a3000000-0000-4000-8000-000000000101','a3000000-0000-4000-8000-000000000102',repeat('a',64),null) result;
update app_private.donation_devices set receipt_status='received',received_at=now(),inspection_status='inspected',inspected_at=now(),inspected_by='a3000000-0000-4000-8000-000000000001',processing_status='resale'
where donation_id=(select (result->>'donationId')::uuid from finance_fixture);
select throws_ok(format($$select api.staff_record_sale_and_allocation('a3000000-0000-4000-8000-000000000001',%L::uuid,10000,'test','wipe-required',now())$$,(select id from app_private.donation_devices where donation_id=(select (result->>'donationId')::uuid from finance_fixture))), '22023','received, inspected, resale-eligible device required','resale cannot be recorded before verified wipe');
update app_private.donation_devices set data_wipe_status='completed',wipe_verified_at=now(),wipe_verified_by='a3000000-0000-4000-8000-000000000001'
where donation_id=(select (result->>'donationId')::uuid from finance_fixture);
select lives_ok(format($$select api.staff_record_sale_and_allocation('a3000000-0000-4000-8000-000000000001',%L::uuid,10000,'test','sale-a',now())$$,(select id from app_private.donation_devices where donation_id=(select (result->>'donationId')::uuid from finance_fixture))),'verified wipe permits resale');
insert into app_private.donation_costs(donation_id,category,amount_cents,incurred_at,recorded_by) values
((select (result->>'donationId')::uuid from finance_fixture),'direct_cost',100,now(),'a3000000-0000-4000-8000-000000000001'),
((select (result->>'donationId')::uuid from finance_fixture),'shared_cost',501,now(),'a3000000-0000-4000-8000-000000000001'),
((select (result->>'donationId')::uuid from finance_fixture),'capped_cost',2000,now(),'a3000000-0000-4000-8000-000000000001'),
((select (result->>'donationId')::uuid from finance_fixture),'fixed_cost',900,now(),'a3000000-0000-4000-8000-000000000001'),
((select (result->>'donationId')::uuid from finance_fixture),'not_deductible',9999,now(),'a3000000-0000-4000-8000-000000000001');
select lives_ok(format($$select api.staff_finalize_donation_financials('a3000000-0000-4000-8000-000000000001',%L::uuid)$$,(select (result->>'donationId')::uuid from finance_fixture)),'financial finalization accepts configured cost rules');
select is((select eligible_cost_cents from app_private.proceeds_allocations where donation_id=(select (result->>'donationId')::uuid from finance_fixture) and status='calculated'),1351::bigint,'direct, capped, fixed, and shared costs total exact applied cents');
select is((select (calculation_snapshot->>'capBase') from app_private.financial_cost_applications a join app_private.donation_costs c on c.id=a.cost_id where c.category='capped_cost'),'gross_proceeds','cap basis is recorded in evidence');
select is((select count(*) from app_private.financial_cost_applications a join app_private.donation_costs c on c.id=a.cost_id where c.category='not_deductible'),0::bigint,'non-deductible costs are excluded');
select throws_ok(format($$select api.staff_update_device('a3000000-0000-4000-8000-000000000001',%L::uuid,%L::uuid,'{"actualModel":"Changed"}'::jsonb)$$,(select (result->>'donationId')::uuid from finance_fixture),(select id from app_private.donation_devices where donation_id=(select (result->>'donationId')::uuid from finance_fixture))), '22023','financial inputs finalized; reopen required','device facts lock after finalization');
select throws_ok(format($$select api.staff_add_unexpected_device('a3000000-0000-4000-8000-000000000001',%L::uuid,'Google','Unexpected')$$,(select (result->>'donationId')::uuid from finance_fixture)), '22023','financial inputs finalized; reopen required','unexpected devices lock after finalization');
select lives_ok(format($$select api.staff_reopen_donation_financials('a3000000-0000-4000-8000-000000000001',%L::uuid,'correct sale')$$,(select (result->>'donationId')::uuid from finance_fixture)),'undisbursed finalized financials can reopen');
select lives_ok(format($$select api.staff_reverse_sale('a3000000-0000-4000-8000-000000000001',%L::uuid,'wrong sale')$$,(select id from app_private.device_sale_results where external_reference='sale-a')),'sale correction is append-only');
select lives_ok(format($$select api.staff_record_sale_and_allocation('a3000000-0000-4000-8000-000000000001',%L::uuid,12000,'test','sale-b',now())$$,(select id from app_private.donation_devices where donation_id=(select (result->>'donationId')::uuid from finance_fixture))),'replacement sale can be recorded after reopen');
select lives_ok(format($$select api.staff_finalize_donation_financials('a3000000-0000-4000-8000-000000000001',%L::uuid)$$,(select (result->>'donationId')::uuid from finance_fixture)),'re-finalization creates a new revision');
select is((select financial_revision from app_private.donations where id=(select (result->>'donationId')::uuid from finance_fixture)),2,'revision increments after correction');
select is((select count(*) from app_private.effective_proceeds_allocations where donation_id=(select (result->>'donationId')::uuid from finance_fixture)),1::bigint,'exactly one current allocation exists after correction');
select is((select count(*) from app_private.proceeds_allocations where donation_id=(select (result->>'donationId')::uuid from finance_fixture) and status='reversed'),1::bigint,'reversal remains historical');

-- A mixed donation may have one sold phone and one recycled phone. The
-- recycled device is excluded from gross proceeds without a fabricated sale.
create temporary table mixed_fixture as select api.create_donation(
  '{"clientSubmissionKey":"a3000000-0000-4000-8000-000000000110","shippingMethod":"label","donor":{"firstName":"Mixed","middleName":"","lastName":"Donor","email":"mixed-remediation@example.com","address1":"2 Main","address2":"","city":"Kissimmee","state":"FL","zip":"34741","country":"US","marketingEmailConsent":false},"charity":{"pledgeId":"3685b542-61d5-45da-9580-162dca725966","name":"Remediation Charity"},"devices":[{"id":"m1","brand":"Apple","model":"Phone","age":"2-3 years","condition":"Good","storage":"128 GB","powersOn":true,"unlocked":true},{"id":"m2","brand":"Samsung","model":"Phone","age":"4-5 years","condition":"Poor","storage":"64 GB","powersOn":false,"unlocked":true}]}'::jsonb,
  'a3000000-0000-0000-0000-000000000111','a3000000-0000-0000-0000-000000000112',repeat('c',64),null) result;
update app_private.donation_devices set receipt_status='received',received_at=now(),inspection_status='inspected',inspected_at=now(),inspected_by='a3000000-0000-4000-8000-000000000001',processing_status=(case when donor_model='Phone' and donor_brand='Apple' then 'resale' else 'recycle' end)::app_private.device_processing_status
where donation_id=(select (result->>'donationId')::uuid from mixed_fixture);
update app_private.donation_devices set data_wipe_status='completed',wipe_verified_at=now(),wipe_verified_by='a3000000-0000-4000-8000-000000000001'
where donation_id=(select (result->>'donationId')::uuid from mixed_fixture) and donor_brand='Apple';
select lives_ok(format($$select api.staff_record_sale_and_allocation('a3000000-0000-4000-8000-000000000001',%L::uuid,1234,'test','mixed-sale',now())$$,(select id from app_private.donation_devices where donation_id=(select (result->>'donationId')::uuid from mixed_fixture) and donor_brand='Apple')),'mixed donation records only the resale device');
select lives_ok(format($$select api.staff_finalize_donation_financials('a3000000-0000-4000-8000-000000000001',%L::uuid)$$,(select (result->>'donationId')::uuid from mixed_fixture)),'mixed resale and recycle donation finalizes');
select is((select gross_cents from app_private.proceeds_allocations where donation_id=(select (result->>'donationId')::uuid from mixed_fixture) and status='calculated'),1234::bigint,'mixed gross includes sold device only');
select is((select eligible_device_count from app_private.financial_reconciliation_snapshots where donation_id=(select (result->>'donationId')::uuid from mixed_fixture)),1,'mixed snapshot excludes recycled device');
select is((select allocated_cents from app_private.proceeds_allocations where donation_id=(select (result->>'donationId')::uuid from mixed_fixture) and status='calculated'),617::bigint,'mixed proceeds share is based on sold value');
select is((select count(*) from app_private.device_sale_results s join app_private.donation_devices x on x.id=s.device_id where x.donation_id=(select (result->>'donationId')::uuid from mixed_fixture)),1::bigint,'mixed donation has no fake sale');

-- Pro-rata evidence records an uneven remainder against the frozen two-device
-- denominator while applying the shared cost exactly once.
create temporary table prorata_fixture as select api.create_donation(
  '{"clientSubmissionKey":"a3000000-0000-4121-8000-000000000130","shippingMethod":"label","donor":{"firstName":"Pro","middleName":"","lastName":"Rata","email":"prorata-remediation@example.com","address1":"4 Main","address2":"","city":"Kissimmee","state":"FL","zip":"34741","country":"US","marketingEmailConsent":false},"charity":{"pledgeId":"3685b542-61d5-45da-9580-162dca725966","name":"Remediation Charity"},"devices":[{"id":"p1","brand":"Apple","model":"Phone A","age":"2-3 years","condition":"Good","storage":"128 GB","powersOn":true,"unlocked":true},{"id":"p2","brand":"Samsung","model":"Phone B","age":"2-3 years","condition":"Good","storage":"128 GB","powersOn":true,"unlocked":true}]}'::jsonb,
  'a3000000-0000-0000-0000-000000000131','a3000000-0000-0000-0000-000000000132',repeat('e',64),null) result;
update app_private.donation_devices set receipt_status='received',received_at=now(),inspection_status='inspected',inspected_at=now(),inspected_by='a3000000-0000-4000-8000-000000000001',processing_status='resale',data_wipe_status='completed',wipe_verified_at=now(),wipe_verified_by='a3000000-0000-4000-8000-000000000001'
where donation_id=(select (result->>'donationId')::uuid from prorata_fixture);
select lives_ok(format($$select api.staff_record_sale_and_allocation('a3000000-0000-4000-8000-000000000001',%L::uuid,1000,'test','prorata-sale-a',now())$$,(select id from app_private.donation_devices where donation_id=(select (result->>'donationId')::uuid from prorata_fixture) and donor_device_key='p1')),'first pro-rata device sale records');
select lives_ok(format($$select api.staff_record_sale_and_allocation('a3000000-0000-4000-8000-000000000001',%L::uuid,1000,'test','prorata-sale-b',now())$$,(select id from app_private.donation_devices where donation_id=(select (result->>'donationId')::uuid from prorata_fixture) and donor_device_key='p2')),'second pro-rata device sale records');
insert into app_private.donation_costs(donation_id,category,amount_cents,incurred_at,recorded_by) values((select (result->>'donationId')::uuid from prorata_fixture),'shared_cost',501,now(),'a3000000-0000-4000-8000-000000000001');
select lives_ok(format($$select api.staff_finalize_donation_financials('a3000000-0000-4000-8000-000000000001',%L::uuid)$$,(select (result->>'donationId')::uuid from prorata_fixture)),'uneven pro-rata donation finalizes');
select is((select (a.calculation_snapshot->>'denominator')::integer from app_private.financial_cost_applications a join app_private.donation_costs c on c.id=a.cost_id where c.donation_id=(select (result->>'donationId')::uuid from prorata_fixture)),2,'pro-rata denominator is frozen eligible-device count');
select is((select (a.calculation_snapshot->>'proRataBaseCents')::integer from app_private.financial_cost_applications a join app_private.donation_costs c on c.id=a.cost_id where c.donation_id=(select (result->>'donationId')::uuid from prorata_fixture)),250,'pro-rata base cents are deterministic');
select is((select (a.calculation_snapshot->>'proRataRemainderCents')::integer from app_private.financial_cost_applications a join app_private.donation_costs c on c.id=a.cost_id where c.donation_id=(select (result->>'donationId')::uuid from prorata_fixture)),1,'pro-rata remainder cent is recorded');
select is((select eligible_cost_cents from app_private.proceeds_allocations where donation_id=(select (result->>'donationId')::uuid from prorata_fixture) and status='calculated'),501::bigint,'pro-rata shared cost is applied exactly once');

-- A wholly non-resalable donation closes with an explicit zero-proceeds
-- allocation and no sale result.
create temporary table zero_fixture as select api.create_donation(
  '{"clientSubmissionKey":"a3000000-0000-4120-8000-000000000120","shippingMethod":"label","donor":{"firstName":"Zero","middleName":"","lastName":"Donor","email":"zero-remediation@example.com","address1":"3 Main","address2":"","city":"Kissimmee","state":"FL","zip":"34741","country":"US","marketingEmailConsent":false},"charity":{"pledgeId":"3685b542-61d5-45da-9580-162dca725966","name":"Remediation Charity"},"devices":[{"id":"z1","brand":"Apple","model":"Broken","age":"6+ years","condition":"Broken","storage":"16 GB","powersOn":false,"unlocked":true}]}'::jsonb,
  'a3000000-0000-0000-0000-000000000121','a3000000-0000-0000-0000-000000000122',repeat('d',64),null) result;
update app_private.donation_devices set receipt_status='received',received_at=now(),inspection_status='inspected',inspected_at=now(),inspected_by='a3000000-0000-4000-8000-000000000001',processing_status='recycle'
where donation_id=(select (result->>'donationId')::uuid from zero_fixture);
select lives_ok(format($$select api.staff_finalize_donation_financials('a3000000-0000-4000-8000-000000000001',%L::uuid)$$,(select (result->>'donationId')::uuid from zero_fixture)),'zero-resalable donation finalizes without a sale');
select is((select gross_cents from app_private.proceeds_allocations where donation_id=(select (result->>'donationId')::uuid from zero_fixture) and status='calculated'),0::bigint,'zero-resalable donation has zero gross proceeds');
select is((select allocated_cents from app_private.proceeds_allocations where donation_id=(select (result->>'donationId')::uuid from zero_fixture) and status='calculated'),0::bigint,'zero-resalable donation has zero allocated proceeds');
select is((select count(*) from app_private.device_sale_results s join app_private.donation_devices x on x.id=s.device_id where x.donation_id=(select (result->>'donationId')::uuid from zero_fixture)),0::bigint,'zero-resalable donation has no fabricated sale');

insert into app_private.organizations(id,name,slug,status,created_by) values('a3000000-0000-4000-8000-000000000030','Remediation Partner','remediation-partner','active','a3000000-0000-4000-8000-000000000001');
select ok((api.staff_invite_partner_admin('a3000000-0000-4000-8000-000000000001','a3000000-0000-4000-8000-000000000030','partner-remediation@example.com')->>'outboxEventId') is not null,'partner invitation creates an outbox event');
select is((select (payload ? 'email') from app_private.outbox_events where handler_key='partner_invitation_email' order by created_at desc limit 1),false,'outbox payload contains no partner PII');
select is((api.account_context('a3000000-0000-4000-8000-000000000001')->>'staff')::boolean,true,'staff role is resolved server-side');
select is((api.evaluate_agent_command('agent-remediation','verify_device_wipe','device',null,'low','{}',repeat('b',64),gen_random_uuid(),'wipe-agent')->>'outcome'),'DENY','agent cannot verify device wipe');

select * from finish();
rollback;

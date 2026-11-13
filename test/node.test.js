'use strict';

// Unit tests of the built node (npm run build first): every request checked, no network.
const test = require('node:test');
const assert = require('node:assert/strict');
const { execute, loadOptions, mapperFields, fakeTransport } = require('./harness');

const credentials = { apiKey: 'sk_test', baseUrl: 'https://sendapp.test/' };
const run = (params, answers) => {
	const transport = fakeTransport(answers);
	return { transport, result: execute(params, { transport, credentials }) };
};

const RULES = {
	status: 'success',
	automations: [
		{ id: 41, name: 'New order', active: true, account: { token: 'tok1', name: 'Caffè Aurora' }, fields: ['order_id', 'order.total'] },
		{ id: 42, name: 'Every account', active: true, account: null, fields: [] },
	],
};
const FIELDS = {
	status: 'success',
	fields: [
		{ id: 1, name: 'City', type: 'input', options: null },
		{ id: 2, name: 'Points', type: 'number', options: null },
		{ id: 3, name: 'Level', type: 'select', options: ['Bronze', 'Gold'] },
		{ id: 4, name: 'Interests', type: 'multiselect', options: ['Coffee', 'Wine'] },
		{ id: 5, name: 'Newsletter', type: 'boolean', options: null },
		{ id: 6, name: 'Joined', type: 'date', options: null },
		{ id: 7, name: 'Summary', type: 'ai', options: null },
	],
};

test('automations dropdown: startable rules with their account', async () => {
	const transport = fakeTransport([{ match: (o) => o.url === 'https://sendapp.test/api/automations' && o.qs.startable === 1, body: RULES }]);
	const out = await loadOptions('getAutomations', {}, { transport, credentials });
	assert.deepEqual(out, [{ name: 'New order · Caffè Aurora', value: '41' }, { name: 'Every account', value: '42' }]);
});

test('data fields of the chosen rule', async () => {
	const transport = fakeTransport([{ body: RULES }]);
	const out = await mapperFields('getAutomationFields', { automationId: '41' }, { transport, credentials });
	assert.deepEqual(out.fields.map((f) => f.id), ['order_id', 'order.total']);
	assert.deepEqual((await mapperFields('getAutomationFields', {}, { transport, credentials })).fields, []);
});

test('start: contact details, dotted names nested, other data, options; answer handed on', async () => {
	const { transport, result } = run(
		{
			resource: 'automation', operation: 'start', automationId: '41', contactBy: 'details',
			automationContact: { email: ' g@example.com ', name: 'Giulia', phone: '' },
			automationData: { value: { order_id: 'A-1', 'order.total': '19.90', empty: '' } },
			automationExtra: { field: [{ name: 'order.currency', value: 'EUR' }, { name: ' ', value: 'x' }] },
			automationOptions: { idempotency_key: ' A-1 ', token: 'tok1' },
		},
		[{
			match: (o) => o.method === 'POST' && o.url === 'https://sendapp.test/api/automations/41/start'
				&& JSON.stringify(o.body) === JSON.stringify({ email: 'g@example.com', name: 'Giulia', data: { order_id: 'A-1', order: { total: '19.90', currency: 'EUR' } }, token: 'tok1', idempotency_key: 'A-1' }),
			body: { status: 'success', ran: true, run_id: 5, run_status: 'done', reason: null, contact_id: 9, contact_created: true },
		}],
	);
	const [out] = await result;
	assert.equal(transport.left.length, 0);
	assert.deepEqual(out, { automation_id: 41, status: 'success', duplicate: false, ran: true, run_id: 5, run_status: 'done', reason: null, contact_id: 9, contact_created: true, resumes_at: null, warning: null });
});

test('start: by contact ID; a duplicate is an answer, not an error', async () => {
	const { result } = run(
		{ resource: 'automation', operation: 'start', automationId: '41', contactBy: 'id', automationContactId: '7' },
		[{ match: (o) => JSON.stringify(o.body) === '{"contact_id":7}', body: { status: 'duplicate', message: 'Already started.', ran: false } }],
	);
	const [out] = await result;
	assert.equal(out.duplicate, true);
	assert.equal(out.reason, 'Already started.');
});

test('start: readable errors for 409, 404 and 429', async () => {
	const p = { resource: 'automation', operation: 'start', automationId: '41', contactBy: 'none' };
	await assert.rejects(run(p, [{ status: 409, body: { status: 'error', message: 'switched off' } }]).result, /switched off in SendApp/);
	await assert.rejects(run(p, [{ status: 404, body: { status: 'error', message: 'Automation not found in your account.' } }]).result, /does not exist in your SendApp account any more/);
	await assert.rejects(run(p, [{ status: 404, body: { status: 'error', message: 'Contact not found in your account.' } }]).result, /This contact does not exist/);
	await assert.rejects(run(p, [{ status: 429, body: { status: 'error', message: 'Too many.' }, headers: { 'retry-after': '12' } }]).result, (e) => /Too many runs/.test(e.message) && /12 seconds/.test(e.description));
	await assert.rejects(run(p, [{ status: 422, body: { status: 'error', message: 'email is not a valid email address.' } }]).result, /email is not a valid/);
	await assert.rejects(run({ ...p, automationId: 'x' }, []).result, /Choose an automation/);
});

test('custom field columns: typed, AI fields left out', async () => {
	const transport = fakeTransport([{ body: FIELDS }]);
	const { fields } = await mapperFields('getCustomFieldColumns', {}, { transport, credentials });
	assert.deepEqual(fields.map((f) => [f.id, f.type]), [['1', 'string'], ['2', 'number'], ['3', 'options'], ['4', 'string'], ['5', 'boolean'], ['6', 'dateTime']]);
	assert.deepEqual(fields[2].options, [{ name: 'Bronze', value: 'Bronze' }, { name: 'Gold', value: 'Gold' }]);
	assert.match(fields[3].displayName, /Coffee, Wine/);
});

test('update contact: custom_fields by name, in stored form', async () => {
	const { result } = run(
		{ resource: 'contact', operation: 'update', contactId: '7', contactFields: { name: 'Giulia' }, customFields: { value: { 1: 'Roma', 2: '3', 3: 'Gold', 4: 'Coffee, Wine', 5: false, 6: '2026-10-29T10:00:00.000+01:00', 7: 'x', 99: 'gone' } } },
		[
			{ match: (o) => o.url.endsWith('/api/contact-fields'), body: FIELDS },
			{
				match: (o) => o.method === 'PUT' && JSON.stringify(o.body) === JSON.stringify({ name: 'Giulia', custom_fields: { City: 'Roma', Points: 3, Level: 'Gold', Interests: ['Coffee', 'Wine'], Newsletter: '0', Joined: '2026-10-29' } }),
				body: { status: 'success', contact: { id: 7, name: 'Giulia', custom_fields: { City: 'Roma', Summary: 'AI text' } } },
			},
		],
	);
	const [out] = await result;
	assert.deepEqual(out.custom_fields, { City: 'Roma', Summary: 'AI text' });
});

test('create contact: custom fields in a second call; none → one call', async () => {
	const a = run(
		{ resource: 'contact', operation: 'create', contactFields: { email: 'g@example.com' }, customFields: { value: { 2: 10 } } },
		[
			{ body: FIELDS },
			{ match: (o) => o.method === 'POST' && JSON.stringify(o.body) === '{"email":"g@example.com"}', status: 201, body: { contact: { id: 7, email: 'g@example.com' } } },
			{ match: (o) => o.method === 'PUT' && o.url.endsWith('/api/contacts/7') && JSON.stringify(o.body) === '{"custom_fields":{"Points":10}}', body: { contact: { id: 7, custom_fields: { Points: '10' } } } },
		],
	);
	assert.deepEqual((await a.result)[0].custom_fields, { Points: '10' });
	const b = run({ resource: 'contact', operation: 'create', contactFields: { phone: '+393331234567' } }, [{ status: 201, body: { contact: { id: 8 } } }]);
	assert.equal((await b.result)[0].id, 8);
	assert.equal(b.transport.calls.length, 1);
});

test('custom field resource: get many and create', async () => {
	const a = run({ resource: 'customField', operation: 'getAll' }, [{ body: FIELDS }]);
	const all = await a.result;
	assert.equal(all.length, 7);
	assert.equal(all[6].computed_by_ai, true);
	const b = run(
		{ resource: 'customField', operation: 'create', fieldName: ' Level ', fieldType: 'select', fieldOptions: 'Bronze, Gold', fieldFlags: { show_in_list: true } },
		[{ match: (o) => JSON.stringify(o.body) === JSON.stringify({ name: 'Level', type: 'select', options: ['Bronze', 'Gold'], show_in_list: true }), status: 201, body: { status: 'success', field: { id: 9, name: 'Level' } } }],
	);
	assert.deepEqual((await b.result)[0], { id: 9, name: 'Level' });
});

// ── SendApp Trigger: Automation Runs ───────────────────────────────────────
const path = require('path');
const { SendAppTrigger } = require(path.join(__dirname, '..', 'dist', 'nodes', 'SendAppTrigger', 'SendAppTrigger.node.js'));

function triggerCtx(params, answers, body) {
	const calls = [];
	const stat = {};
	const httpRequestWithAuthentication = async (_cred, opts) => {
		calls.push(opts);
		const a = answers.shift() || { body: {} };
		return opts.returnFullResponse ? { statusCode: a.status || 200, body: a.body, headers: {} } : a.body;
	};
	const ctx = {
		getNodeParameter: (n, d) => (n in params ? params[n] : d),
		getNodeWebhookUrl: () => 'https://n8n.example.com/webhook/x',
		getWorkflowStaticData: () => stat,
		getCredentials: async () => credentials,
		getNode: () => ({ name: 'SendApp Trigger' }),
		getBodyData: () => body,
		logger: { warn() {} },
		helpers: { httpRequestWithAuthentication, returnJsonArray: (a) => a.map((json) => ({ json })) },
	};
	return { ctx, calls, stat };
}

test('trigger: activation subscribes the address for the automation and events chosen', async () => {
	const n = new SendAppTrigger();
	const { ctx, calls, stat } = triggerCtx({ source: 'automations', automationId: '41', runEvents: ['run_failed'] }, [{ status: 201, body: { id: 'rh_1' } }]);
	assert.equal(await n.webhookMethods.default.create.call(ctx), true);
	assert.equal(stat.webhookId, 'rh_1');
	assert.equal(calls[0].method, 'POST');
	assert.match(calls[0].url, /api\/automations\/hooks$/);
	assert.deepEqual(calls[0].body, { url: 'https://n8n.example.com/webhook/x', events: ['run_failed'], label: 'n8n', automation_id: '41' });
});

test('trigger: every automation sends no id; an existing subscription is recognized only when equal', async () => {
	const n = new SendAppTrigger();
	const { ctx, calls } = triggerCtx({ source: 'automations', automationId: '', runEvents: ['run_started'] }, [{ status: 201, body: { id: 'rh_2' } }]);
	await n.webhookMethods.default.create.call(ctx);
	assert.equal('automation_id' in calls[0].body, false);

	const hooks = { hooks: [{ id: 'rh_3', url: 'https://n8n.example.com/webhook/x', automation_id: 41, events: ['run_started'] }] };
	const same = triggerCtx({ source: 'automations', automationId: '41', runEvents: ['run_started'] }, [{ body: hooks }]);
	assert.equal(await n.webhookMethods.default.checkExists.call(same.ctx), true);
	assert.equal(same.stat.webhookId, 'rh_3');
	const other = triggerCtx({ source: 'automations', automationId: '42', runEvents: ['run_started'] }, [{ body: hooks }]);
	assert.equal(await n.webhookMethods.default.checkExists.call(other.ctx), false);
});

test('trigger: deactivation removes it; the WhatsApp path stays as it was', async () => {
	const n = new SendAppTrigger();
	const { ctx, calls, stat } = triggerCtx({ source: 'automations' }, [{ body: { status: 'success' } }]);
	stat.webhookId = 'rh_4';
	assert.equal(await n.webhookMethods.default.delete.call(ctx), true);
	assert.equal(calls[0].method, 'DELETE');
	assert.match(calls[0].url, /api\/automations\/hooks\/rh_4$/);

	// an old node has no «source» parameter: messages, as before
	const old = triggerCtx({ token: 'tok', events: ['message_received'] }, [{ status: 201, body: { webhook: { id: 'wh_1' } } }]);
	await n.webhookMethods.default.create.call(old.ctx);
	assert.match(old.calls[0].url, /whatsapp-meta\/webhooks$/);
});

test('trigger: a delivery becomes one item, as it is', async () => {
	const n = new SendAppTrigger();
	const payload = { id: '7:run_started', event: 'run_started', contact: { email: 'a@example.com' } };
	const { ctx } = triggerCtx({ source: 'automations' }, [], payload);
	const out = await n.webhook.call(ctx);
	assert.deepEqual(out.workflowData, [[{ json: payload }]]);
});

test('trigger: the event data only when switched on; a change makes a new subscribe', async () => {
	const n = new SendAppTrigger();
	const off = triggerCtx({ source: 'automations', automationId: '', runEvents: ['run_started'] }, [{ status: 201, body: { id: 'rh_5' } }]);
	await n.webhookMethods.default.create.call(off.ctx);
	assert.equal('include_event_data' in off.calls[0].body, false);
	const on = triggerCtx({ source: 'automations', automationId: '', runEvents: ['run_started'], includeEventData: true }, [{ status: 201, body: { id: 'rh_6' } }]);
	await n.webhookMethods.default.create.call(on.ctx);
	assert.equal(on.calls[0].body.include_event_data, true);
	const hooks = { hooks: [{ id: 'rh_7', url: 'https://n8n.example.com/webhook/x', automation_id: null, events: ['run_started'], include_event_data: false }] };
	const changed = triggerCtx({ source: 'automations', automationId: '', runEvents: ['run_started'], includeEventData: true }, [{ body: hooks }]);
	assert.equal(await n.webhookMethods.default.checkExists.call(changed.ctx), false);
});

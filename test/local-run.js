'use strict';

/**
 * The real node against a SendApp you choose (never production by accident):
 *   SENDAPP_BASE_URL=http://127.0.0.1:8000 SENDAPP_KEY_FILE=<file with an sk_ key> SENDAPP_AUTOMATION_ID=<id> \
 *     [SENDAPP_AUTOMATION_OFF_ID=<id of a switched-off rule>] node test/local-run.js
 * It starts the automation for an @example.com contact (no phone: nothing can be sent on WhatsApp),
 * writes custom fields on it and lists the fields. The key is read from a file and never printed.
 */

const fs = require('fs');
const { execute, loadOptions, mapperFields, networkTransport } = require('./harness');

const base = process.env.SENDAPP_BASE_URL || '';
if (!base || /app\.sendapp\.ai/.test(base)) {
	console.error('Set SENDAPP_BASE_URL to a test server (production is refused).');
	process.exit(2);
}
const credentials = { apiKey: fs.readFileSync(process.env.SENDAPP_KEY_FILE, 'utf8').trim(), baseUrl: base };
const opts = { transport: networkTransport(), credentials };
const id = String(process.env.SENDAPP_AUTOMATION_ID || '');
const email = process.env.SENDAPP_TEST_EMAIL || 'n8n-2910@example.com';

(async () => {
	const rules = await loadOptions('getAutomations', {}, opts);
	console.log('automations:', JSON.stringify(rules));
	const { fields } = await mapperFields('getAutomationFields', { automationId: id }, opts);
	console.log('data fields:', fields.map((f) => f.id).join(', '));

	const started = await execute({
		resource: 'automation', operation: 'start', automationId: id, contactBy: 'details',
		automationContact: { email, name: 'Prova n8n 2910' },
		automationData: { value: Object.fromEntries(fields.map((f) => [f.id, `n8n-${f.id}`])) },
		automationExtra: { field: [{ name: 'canale', value: 'n8n' }] },
		automationOptions: { idempotency_key: `n8n-2910-${Date.now()}` },
	}, opts);
	console.log('start:', JSON.stringify(started[0]));

	if (process.env.SENDAPP_AUTOMATION_OFF_ID) {
		try {
			await execute({ resource: 'automation', operation: 'start', automationId: process.env.SENDAPP_AUTOMATION_OFF_ID, contactBy: 'details', automationContact: { email } }, opts);
			console.log('switched off: NOT refused (unexpected)');
		} catch (e) {
			console.log('switched off:', e.message, '/', e.description);
		}
	}
	try {
		await execute({ resource: 'automation', operation: 'start', automationId: '999999999', contactBy: 'none' }, opts);
	} catch (e) {
		console.log('missing rule:', e.message);
	}

	const columns = (await mapperFields('getCustomFieldColumns', {}, opts)).fields;
	console.log('custom field columns:', columns.map((c) => `${c.displayName.split(' (')[0]}:${c.type}`).join(', '));
	const value = {};
	columns.forEach((c) => {
		if (c.type === 'number') value[c.id] = '5';
		else if (c.type === 'boolean') value[c.id] = false;
		else if (c.type === 'dateTime') value[c.id] = '2026-10-29T12:00:00.000+01:00';
		else if (c.type === 'options') value[c.id] = c.options[0].value;
		else if (/several of/.test(c.displayName)) value[c.id] = c.displayName.match(/several of: ([^;]+);/)[1];
	});
	const updated = await execute({ resource: 'contact', operation: 'update', contactId: String(started[0].contact_id), contactFields: {}, customFields: { value } }, opts);
	console.log('update custom_fields:', JSON.stringify(updated[0].custom_fields));
	const created = await execute({ resource: 'contact', operation: 'create', contactFields: { email }, customFields: { value: { [columns[0].id]: 'da create' } } }, opts);
	console.log('create (same email) custom_fields:', JSON.stringify(created[0].custom_fields));
	const newField = await execute({ resource: 'customField', operation: 'create', fieldName: 'n8n 2910 prova', fieldType: 'multiselect', fieldOptions: 'A, B' }, opts);
	console.log('custom field created:', JSON.stringify({ id: newField[0].id, name: newField[0].name, options: newField[0].options }));
	const all = await execute({ resource: 'customField', operation: 'getAll' }, opts);
	console.log('custom fields:', all.length, 'computed by AI:', all.filter((f) => f.computed_by_ai).map((f) => f.name).join(', '));
})().catch((e) => {
	console.error('FAILED:', e.message, e.description || '');
	process.exit(1);
});

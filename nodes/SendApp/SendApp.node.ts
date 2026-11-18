import type {
	IDataObject,
	IExecuteFunctions,
	ILoadOptionsFunctions,
	INodeExecutionData,
	INodePropertyOptions,
	INodeType,
	INodeTypeDescription,
	ResourceMapperFields,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import {
	cleanContact,
	cleanNumber,
	customFieldColumns,
	customFieldsByName,
	filled,
	getCustomFields,
	nest,
	sendAppRequest,
	sendAppRequestFull,
	tagList,
	type CustomField,
} from './GenericFunctions';
import { componentsFor, fieldsFor, refusal, templateId, type Template } from './Templates';

/**
 * SendApp: WhatsApp, SMS, contacts and bookings through SendApp's REST API.
 *
 * Programmatic style: sending a template takes two dependent calls (read the approved template, then send it with
 * the components built from its variables), which the declarative style cannot express.
 */
export class SendApp implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'SendApp',
		name: 'sendApp',
		icon: { light: 'file:sendapp.svg', dark: 'file:sendapp.dark.svg' },
		group: ['output'],
		version: [1],
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description: 'Send WhatsApp messages and templates, SMS, start automations, and manage contacts, custom fields and bookings in SendApp',
		defaults: { name: 'SendApp' },
		usableAsTool: true,
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'sendAppApi', required: true }],
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'Automation', value: 'automation' },
					{ name: 'Booking', value: 'booking' },
					{ name: 'Contact', value: 'contact' },
					{ name: 'Custom Field', value: 'customField' },
					{ name: 'Message', value: 'message' },
				],
				default: 'message',
			},

			// ------------------------------------------------------------------ Message
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['message'] } },
				options: [
					{
						name: 'Send SMS',
						value: 'sendSms',
						description: 'Send an SMS with SendApp credits',
						action: 'Send an SMS',
					},
					{
						name: 'Send WhatsApp Message',
						value: 'sendWhatsApp',
						description: 'Send a free text WhatsApp message, with an optional file, within 24 hours of the customer’s last message',
						// Brand name kept as written: the sentence-case lint rule would print it «whats app»
						action: `Send a WhatsApp message`,
					},
					{
						name: 'Send WhatsApp Template',
						value: 'sendTemplate',
						description: 'Send an approved WhatsApp template, at any time',
						// Brand name kept as written: the sentence-case lint rule would print it «whats app»
						action: `Send a WhatsApp template`,
					},
				],
				default: 'sendWhatsApp',
			},
			{
				displayName: 'WhatsApp Account Name or ID',
				name: 'token',
				type: 'options',
				typeOptions: { loadOptionsMethod: 'getAccounts' },
				required: true,
				default: '',
				description:
					'The SendApp account (WhatsApp number) to send from. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
				displayOptions: { show: { resource: ['message'] } },
			},
			{
				displayName: 'Recipient Phone Number',
				name: 'number',
				type: 'string',
				required: true,
				default: '',
				placeholder: '+393331234567',
				description: 'International format',
				displayOptions: { show: { resource: ['message'] } },
			},
			{
				displayName: 'Message',
				name: 'message',
				type: 'string',
				typeOptions: { rows: 4 },
				default: '',
				description:
					'WhatsApp only delivers free text within 24 hours of the customer’s last message. Outside that window use «Send WhatsApp Template».',
				displayOptions: { show: { resource: ['message'], operation: ['sendWhatsApp', 'sendSms'] } },
			},
			{
				displayName: 'Additional Fields',
				name: 'additionalFields',
				type: 'collection',
				placeholder: 'Add Field',
				default: {},
				displayOptions: { show: { resource: ['message'], operation: ['sendWhatsApp'] } },
				options: [
					{
						displayName: 'File Link',
						name: 'media_url',
						type: 'string',
						default: '',
						description: 'A public https link to an image, video, audio or document. The message becomes its caption.',
					},
					{
						displayName: 'File Type',
						name: 'media_type',
						type: 'options',
						options: [
							{ name: 'Audio', value: 'audio' },
							{ name: 'Document', value: 'document' },
							{ name: 'Image', value: 'image' },
							{ name: 'Video', value: 'video' },
						],
						default: 'image',
					},
				],
			},
			{
				displayName: 'Template Name or ID',
				name: 'template',
				type: 'options',
				typeOptions: { loadOptionsMethod: 'getTemplates', loadOptionsDependsOn: ['token'] },
				required: true,
				default: '',
				description:
					'Only the templates approved by Meta are listed. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
				displayOptions: { show: { resource: ['message'], operation: ['sendTemplate'] } },
			},
			{
				displayName: 'Template Variables',
				name: 'variables',
				type: 'resourceMapper',
				noDataExpression: true,
				default: { mappingMode: 'defineBelow', value: null },
				required: true,
				typeOptions: {
					loadOptionsDependsOn: ['token', 'template'],
					resourceMapper: {
						resourceMapperMethod: 'getTemplateFields',
						mode: 'add',
						fieldWords: { singular: 'variable', plural: 'variables' },
						addAllFields: true,
						supportAutoMap: false,
						hideNoDataError: true,
					},
				},
				displayOptions: { show: { resource: ['message'], operation: ['sendTemplate'] } },
			},

			// ------------------------------------------------------------------ Contact
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['contact'] } },
				options: [
					{
						name: 'Add Tags',
						value: 'addTags',
						description: 'Add tags to a contact',
						action: 'Add tags to a contact',
					},
					{
						name: 'Create',
						value: 'create',
						description: 'Create a contact, or get the one that already has this phone number or email',
						action: 'Create a contact',
					},
					{
						name: 'Find',
						value: 'find',
						description: 'Find contacts by phone number, email or name',
						action: 'Find contacts',
					},
					{
						name: 'Remove Tags',
						value: 'removeTags',
						description: 'Remove tags from a contact',
						action: 'Remove tags from a contact',
					},
					{
						name: 'Update',
						value: 'update',
						description: 'Update a contact',
						action: 'Update a contact',
					},
				],
				default: 'create',
			},
			{
				displayName: 'Contact ID',
				name: 'contactId',
				type: 'string',
				required: true,
				default: '',
				description: 'The ID of the contact, for example from «Find» or the trigger',
				displayOptions: { show: { resource: ['contact'], operation: ['update', 'addTags', 'removeTags'] } },
			},
			{
				displayName: 'Search',
				name: 'query',
				type: 'string',
				required: true,
				default: '',
				description: 'A phone number (in any format), an email or a name',
				displayOptions: { show: { resource: ['contact'], operation: ['find'] } },
			},
			{
				displayName: 'Tags',
				name: 'tags',
				type: 'string',
				required: true,
				default: '',
				description: 'Several tags separated by commas',
				displayOptions: { show: { resource: ['contact'], operation: ['addTags', 'removeTags'] } },
			},
			{
				displayName: 'Contact Fields',
				name: 'contactFields',
				type: 'collection',
				placeholder: 'Add Field',
				default: {},
				displayOptions: { show: { resource: ['contact'], operation: ['create', 'update'] } },
				options: [
					{ displayName: 'Email', name: 'email', type: 'string', placeholder: 'name@email.com', default: '' },
					{ displayName: 'First Name', name: 'first_name', type: 'string', default: '' },
					{ displayName: 'Full Name', name: 'name', type: 'string', default: '' },
					{ displayName: 'Last Name', name: 'last_name', type: 'string', default: '' },
					{
						displayName: 'Phone',
						name: 'phone',
						type: 'string',
						default: '',
						description: 'International format, for example +393331234567',
					},
					{
						displayName: 'Tags',
						name: 'tags',
						type: 'string',
						default: '',
						description: 'Several tags separated by commas. On update they replace the contact’s tags.',
					},
				],
			},
			{
				displayName: 'Custom Fields',
				name: 'customFields',
				type: 'resourceMapper',
				noDataExpression: true,
				default: { mappingMode: 'defineBelow', value: null },
				typeOptions: {
					resourceMapper: {
						resourceMapperMethod: 'getCustomFieldColumns',
						mode: 'add',
						fieldWords: { singular: 'custom field', plural: 'custom fields' },
						addAllFields: false,
						supportAutoMap: false,
						hideNoDataError: true,
					},
				},
				description: 'The contact’s custom fields (Contacts → Custom fields in SendApp). Fields computed by AI are not listed: they come back in the output.',
				displayOptions: { show: { resource: ['contact'], operation: ['create', 'update'] } },
			},

			// ------------------------------------------------------------------ Automation
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['automation'] } },
				options: [
					{
						name: 'Start',
						value: 'start',
						description: 'Start an automation whose trigger is «Called by another system», for a contact',
						action: 'Start an automation',
					},
				],
				default: 'start',
			},
			{
				displayName: 'Automation Name or ID',
				name: 'automationId',
				type: 'options',
				typeOptions: { loadOptionsMethod: 'getAutomations' },
				required: true,
				default: '',
				description:
					'Only automations switched on whose trigger is «Called by another system» are listed. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
				displayOptions: { show: { resource: ['automation'] } },
			},
			{
				displayName: 'Contact',
				name: 'contactBy',
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'By Phone or Email', value: 'details', description: 'Found or created by phone or email' },
					{ name: 'By Contact ID', value: 'id', description: 'An existing contact' },
					{ name: 'None', value: 'none', description: 'SendApp reads the contact from the data, as the automation’s own address does' },
				],
				default: 'details',
				displayOptions: { show: { resource: ['automation'] } },
			},
			{
				displayName: 'Contact ID',
				name: 'automationContactId',
				type: 'string',
				required: true,
				default: '',
				displayOptions: { show: { resource: ['automation'], contactBy: ['id'] } },
			},
			{
				displayName: 'Contact Details',
				name: 'automationContact',
				type: 'collection',
				placeholder: 'Add Field',
				default: {},
				displayOptions: { show: { resource: ['automation'], contactBy: ['details'] } },
				options: [
					{ displayName: 'Email', name: 'email', type: 'string', placeholder: 'name@email.com', default: '' },
					{ displayName: 'First Name', name: 'first_name', type: 'string', default: '' },
					{ displayName: 'Full Name', name: 'name', type: 'string', default: '', description: 'Used for a new contact' },
					{ displayName: 'Last Name', name: 'last_name', type: 'string', default: '' },
					{
						displayName: 'Phone',
						name: 'phone',
						type: 'string',
						default: '',
						description: 'International format, for example +393331234567',
					},
				],
			},
			{
				displayName: 'Data',
				name: 'automationData',
				type: 'resourceMapper',
				noDataExpression: true,
				default: { mappingMode: 'defineBelow', value: null },
				typeOptions: {
					loadOptionsDependsOn: ['automationId'],
					resourceMapper: {
						resourceMapperMethod: 'getAutomationFields',
						mode: 'add',
						fieldWords: { singular: 'field', plural: 'fields' },
						addAllFields: true,
						supportAutoMap: true,
						hideNoDataError: true,
					},
				},
				description: 'The fields of the last call the automation received: its steps read them as «hook:» followed by the name',
				displayOptions: { show: { resource: ['automation'] } },
			},
			{
				displayName: 'Other Data',
				name: 'automationExtra',
				type: 'fixedCollection',
				typeOptions: { multipleValues: true },
				placeholder: 'Add Data Field',
				default: {},
				description: 'More fields by name. A dot makes a nested field, for example order.total.',
				displayOptions: { show: { resource: ['automation'] } },
				options: [
					{
						name: 'field',
						displayName: 'Field',
						values: [
							{ displayName: 'Name', name: 'name', type: 'string', default: '' },
							{ displayName: 'Value', name: 'value', type: 'string', default: '' },
						],
					},
				],
			},
			{
				displayName: 'Options',
				name: 'automationOptions',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				displayOptions: { show: { resource: ['automation'] } },
				options: [
					{
						displayName: 'Account Name or ID',
						name: 'token',
						type: 'options',
						typeOptions: { loadOptionsMethod: 'getAccounts' },
						default: '',
						description:
							'Only for an automation that applies to all your accounts, when you have more than one. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
					},
					{
						displayName: 'Idempotency Key',
						name: 'idempotency_key',
						type: 'string',
						default: '',
						description: 'The same key within 24 hours does not start the automation twice (for example the order ID)',
					},
				],
			},

			// ------------------------------------------------------------------ Custom Field
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['customField'] } },
				options: [
					{
						name: 'Create',
						value: 'create',
						description: 'Add a custom field to your contacts',
						action: 'Create a custom field',
					},
					{
						name: 'Get Many',
						value: 'getAll',
						description: 'List the custom fields of your contacts, with their type and choices',
						action: 'Get many custom fields',
					},
				],
				default: 'getAll',
			},
			{
				displayName: 'Name',
				name: 'fieldName',
				type: 'string',
				required: true,
				default: '',
				description: 'Must be unique: contacts are written by field name',
				displayOptions: { show: { resource: ['customField'], operation: ['create'] } },
			},
			{
				displayName: 'Type',
				name: 'fieldType',
				type: 'options',
				options: [
					{ name: 'Computed by AI', value: 'ai' },
					{ name: 'Date', value: 'date' },
					{ name: 'Email', value: 'email' },
					{ name: 'Link', value: 'url' },
					{ name: 'Long Text', value: 'textarea' },
					{ name: 'Multiple Choice', value: 'multiselect' },
					{ name: 'Number', value: 'number' },
					{ name: 'Phone', value: 'phone' },
					{ name: 'Single Choice', value: 'select' },
					{ name: 'Text', value: 'input' },
					{ name: 'Yes / No', value: 'boolean' },
				],
				default: 'input',
				displayOptions: { show: { resource: ['customField'], operation: ['create'] } },
			},
			{
				displayName: 'Choices',
				name: 'fieldOptions',
				type: 'string',
				required: true,
				default: '',
				description: 'Several choices separated by commas (at most 50)',
				displayOptions: { show: { resource: ['customField'], operation: ['create'], fieldType: ['select', 'multiselect'] } },
			},
			{
				displayName: 'AI Instruction',
				name: 'fieldPrompt',
				type: 'string',
				typeOptions: { rows: 3 },
				required: true,
				default: '',
				description: 'What the AI should write in this field, for example «The customer’s favourite product»',
				displayOptions: { show: { resource: ['customField'], operation: ['create'], fieldType: ['ai'] } },
			},
			{
				displayName: 'Field Options',
				name: 'fieldFlags',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				displayOptions: { show: { resource: ['customField'], operation: ['create'] } },
				options: [
					{ displayName: 'Required', name: 'is_required', type: 'boolean', default: false },
					{ displayName: 'Show in the Contact List', name: 'show_in_list', type: 'boolean', default: false },
					{ displayName: 'Visible to the AI', name: 'visible_to_ai', type: 'boolean', default: true },
				],
			},

			// ------------------------------------------------------------------ Booking
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['booking'] } },
				options: [
					{
						name: 'Create or Update',
						value: 'upsert',
						description: 'Create a new record, or update the current one if it already exists (upsert)',
						action: 'Create or update a booking',
					},
				],
				default: 'upsert',
			},
			{
				displayName: 'Booking Reference',
				name: 'reference',
				type: 'string',
				required: true,
				default: '',
				description: 'Your own ID for this booking: sending it again updates the same booking',
				displayOptions: { show: { resource: ['booking'] } },
			},
			{
				displayName: 'Start',
				name: 'start_time',
				type: 'dateTime',
				required: true,
				default: '',
				displayOptions: { show: { resource: ['booking'] } },
			},
			{
				displayName: 'Customer Name',
				name: 'customerName',
				type: 'string',
				required: true,
				default: '',
				displayOptions: { show: { resource: ['booking'] } },
			},
			{
				displayName: 'Account Name or ID',
				name: 'bookingToken',
				type: 'options',
				typeOptions: { loadOptionsMethod: 'getAccounts' },
				default: '',
				description:
					'Needed only if you have more than one account in SendApp. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
				displayOptions: { show: { resource: ['booking'] } },
			},
			{
				displayName: 'Booking Fields',
				name: 'bookingFields',
				type: 'collection',
				placeholder: 'Add Field',
				default: {},
				displayOptions: { show: { resource: ['booking'] } },
				options: [
					{
						displayName: 'Customer Email',
						name: 'email',
						type: 'string',
						placeholder: 'name@email.com',
						default: '',
					},
					{
						displayName: 'Customer Phone',
						name: 'phone',
						type: 'string',
						default: '',
						description: 'International format. Phone or email is required.',
					},
					{
						displayName: 'End',
						name: 'end_time',
						type: 'dateTime',
						default: '',
						description: 'One hour after the start if left empty',
					},
					{ displayName: 'Location', name: 'location', type: 'string', default: '' },
					{ displayName: 'Notes', name: 'notes', type: 'string', typeOptions: { rows: 3 }, default: '' },
					{ displayName: 'Number of People', name: 'people', type: 'number', default: 1 },
					{
						displayName: 'Status',
						name: 'status',
						type: 'options',
						options: [
							{ name: 'Cancelled', value: 'cancelled' },
							{ name: 'Confirmed', value: 'confirmed' },
						],
						default: 'confirmed',
					},
					{
						displayName: 'Time Zone',
						name: 'timezone',
						type: 'string',
						default: '',
						placeholder: 'Europe/Rome',
						description: 'Empty: the time zone of your SendApp account',
					},
				],
			},
		],
	};

	methods = {
		loadOptions: {
			async getAccounts(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const data = await sendAppRequest.call(this, 'GET', 'get_tokens');
				return ((data.data as IDataObject[]) ?? []).map((t) => ({
					name: String(t.name || t.token),
					value: String(t.token),
				}));
			},
			async getTemplates(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const token = this.getCurrentNodeParameter('token') as string;
				if (!token) return [];
				const data = await sendAppRequest.call(this, 'GET', 'whatsapp-meta/get_templates', {}, { token });
				return ((data.templates as Template[]) ?? []).map((t) => ({
					name: `${t.name} (${t.language})`,
					value: templateId(t),
				}));
			},
			async getAutomations(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const data = await sendAppRequest.call(this, 'GET', 'automations', {}, { startable: 1 });
				return ((data.automations as IDataObject[]) ?? []).map((a) => {
					const account = a.account as IDataObject | null;
					return {
						name: account && account.name ? `${a.name} · ${account.name}` : String(a.name),
						value: String(a.id),
					};
				});
			},
		},
		resourceMapping: {
			async getTemplateFields(this: ILoadOptionsFunctions): Promise<ResourceMapperFields> {
				const token = this.getCurrentNodeParameter('token') as string;
				const chosen = this.getCurrentNodeParameter('template') as string;
				if (!token || !chosen) return { fields: [] };
				const data = await sendAppRequest.call(this, 'GET', 'whatsapp-meta/get_templates', {}, { token });
				const t = ((data.templates as Template[]) ?? []).find((x) => templateId(x) === chosen);
				return {
					fields: t ? fieldsFor(t) : [],
					emptyFieldsNotice: 'This template has no variables',
				};
			},
			async getCustomFieldColumns(this: ILoadOptionsFunctions): Promise<ResourceMapperFields> {
				return {
					fields: customFieldColumns(await getCustomFields.call(this)),
					emptyFieldsNotice: 'Your SendApp contacts have no custom fields yet (Contacts → Custom fields)',
				};
			},
			async getAutomationFields(this: ILoadOptionsFunctions): Promise<ResourceMapperFields> {
				const id = String(this.getCurrentNodeParameter('automationId') ?? '');
				if (!id) return { fields: [] };
				const data = await sendAppRequest.call(this, 'GET', 'automations', {}, { startable: 1 });
				const rule = ((data.automations as IDataObject[]) ?? []).find((a) => String(a.id) === id);
				const names = rule && Array.isArray(rule.fields) ? (rule.fields as string[]) : [];
				return {
					fields: names.map((name) => ({
						id: name,
						displayName: name,
						required: false,
						defaultMatch: false,
						display: true,
						canBeUsedToMatch: false,
						type: 'string',
					})),
					emptyFieldsNotice: 'This automation has not received any data yet: add fields by name in «Other Data»',
				};
			},
		},
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const out: INodeExecutionData[] = [];

		for (let i = 0; i < items.length; i++) {
			try {
				const resource = this.getNodeParameter('resource', i) as string;
				const operation = this.getNodeParameter('operation', i) as string;
				const result = await run.call(this, resource, operation, i);
				(Array.isArray(result) ? result : [result]).forEach((json) => out.push({ json, pairedItem: { item: i } }));
			} catch (error) {
				if (this.continueOnFail()) {
					out.push({ json: { error: (error as Error).message }, pairedItem: { item: i } });
					continue;
				}
				// a NodeOperationError passes through as it is; an API error keeps its message
				throw new NodeOperationError(this.getNode(), error as Error, { itemIndex: i });
			}
		}

		return [out];
	}
}

async function run(this: IExecuteFunctions, resource: string, operation: string, i: number): Promise<IDataObject | IDataObject[]> {
	const node = this.getNode();

	if (resource === 'message') {
		const token = this.getNodeParameter('token', i) as string;
		const number = cleanNumber(this.getNodeParameter('number', i));
		if (number.length < 8) {
			throw new NodeOperationError(node, 'Write the recipient’s number in international format, for example +393331234567.', { itemIndex: i });
		}
		if (operation === 'sendSms') {
			const message = this.getNodeParameter('message', i) as string;
			// as typed: SendApp completes a national number with the account's country
			const raw = String(this.getNodeParameter('number', i)).trim();
			const data = await sendAppRequest.call(this, 'POST', 'sms/send', { token, number: raw, message });
			return { status: data.status, number };
		}
		if (operation === 'sendWhatsApp') {
			const message = this.getNodeParameter('message', i, '') as string;
			const extra = this.getNodeParameter('additionalFields', i, {}) as IDataObject;
			if (!message && !extra.media_url) {
				throw new NodeOperationError(node, 'Write a message or add a file link.', { itemIndex: i });
			}
			const body = filled({
				token,
				number,
				type: 'freetext',
				message,
				media_url: extra.media_url as string,
				media_type: extra.media_url ? ((extra.media_type as string) || 'image') : undefined,
			});
			const data = await sendAppRequest.call(this, 'POST', 'whatsapp-meta/send', body);
			return { status: data.status, message_id: data.message_id ?? null, number };
		}
		if (operation === 'sendTemplate') {
			const chosen = this.getNodeParameter('template', i) as string;
			const data = await sendAppRequest.call(this, 'GET', 'whatsapp-meta/get_templates', {}, { token });
			const t = ((data.templates as Template[]) ?? []).find((x) => templateId(x) === chosen);
			if (!t) {
				throw new NodeOperationError(node, 'This template is not approved on this WhatsApp account any more. Choose it again.', { itemIndex: i });
			}
			const why = refusal(t);
			if (why) throw new NodeOperationError(node, why, { itemIndex: i });
			const mapped = this.getNodeParameter('variables', i, {}) as { value?: IDataObject | null };
			const template: IDataObject = { name: t.name, language: { code: t.language } };
			const components = componentsFor(t, mapped.value ?? {});
			if (components.length) template.components = components;
			const sent = await sendAppRequest.call(this, 'POST', 'whatsapp-meta/send', { token, number, type: 'template', template });
			return { status: sent.status, message_id: sent.message_id ?? null, number, template: t.name, language: t.language };
		}
	}

	if (resource === 'contact') {
		if (operation === 'find') {
			const query = String(this.getNodeParameter('query', i)).trim();
			const digits = query.replace(/\D+/g, '');
			const isPhone = digits.length >= 6 && !/[a-z@]/i.test(query);
			const first = await sendAppRequest.call(this, 'GET', 'contacts', {}, { search: isPhone ? digits : query, per_page: 10 });
			let found = (first.contacts as IDataObject[]) ?? [];
			if (!found.length && isPhone && digits.length > 9) {
				// saved without the country code: the last 9 digits, keeping only numbers that really end with them
				const tail = digits.slice(-9);
				const second = await sendAppRequest.call(this, 'GET', 'contacts', {}, { search: tail, per_page: 10 });
				found = ((second.contacts as IDataObject[]) ?? []).filter((c) => String(c.phone ?? '').replace(/\D+/g, '').endsWith(tail));
			}
			return found.map(cleanContact);
		}
		if (operation === 'addTags' || operation === 'removeTags') {
			const id = encodeURIComponent(String(this.getNodeParameter('contactId', i)));
			const tags = tagList(this.getNodeParameter('tags', i));
			const data = await sendAppRequest.call(this, operation === 'addTags' ? 'POST' : 'DELETE', `contacts/${id}/tags`, { tags });
			return cleanContact(data.contact as IDataObject);
		}
		const f = this.getNodeParameter('contactFields', i, {}) as IDataObject;
		const body = filled({ name: f.name as string, first_name: f.first_name as string, last_name: f.last_name as string, phone: f.phone as string, email: f.email as string });
		if (f.tags) body.tags = tagList(f.tags);
		const mapped = this.getNodeParameter('customFields', i, {}) as { value?: IDataObject | null };
		let custom: IDataObject = {};
		if (mapped.value && Object.keys(mapped.value).length) {
			custom = customFieldsByName(await getCustomFields.call(this), mapped.value);
		}
		if (operation === 'create') {
			if (!body.phone && !body.email) {
				throw new NodeOperationError(node, 'Write at least a phone number or an email.', { itemIndex: i });
			}
			const data = await sendAppRequest.call(this, 'POST', 'contacts', body);
			const created = data.contact as IDataObject;
			// POST /api/contacts does not write custom fields: a second call on the contact it answered
			if (Object.keys(custom).length && created && created.id) {
				const updated = await sendAppRequest.call(this, 'PUT', `contacts/${encodeURIComponent(String(created.id))}`, { custom_fields: custom });
				return cleanContact((updated.contact as IDataObject) ?? created);
			}
			return cleanContact(created);
		}
		if (operation === 'update') {
			const id = encodeURIComponent(String(this.getNodeParameter('contactId', i)));
			if (Object.keys(custom).length) body.custom_fields = custom;
			const data = await sendAppRequest.call(this, 'PUT', `contacts/${id}`, body);
			return cleanContact(data.contact as IDataObject);
		}
	}

	if (resource === 'automation' && operation === 'start') {
		const id = String(this.getNodeParameter('automationId', i)).trim();
		if (!/^\d+$/.test(id)) {
			throw new NodeOperationError(node, 'Choose an automation.', { itemIndex: i });
		}
		const body: IDataObject = {};
		const by = this.getNodeParameter('contactBy', i, 'details') as string;
		if (by === 'id') {
			const cid = String(this.getNodeParameter('automationContactId', i)).trim();
			if (!/^\d+$/.test(cid)) throw new NodeOperationError(node, 'The Contact ID is a number.', { itemIndex: i });
			body.contact_id = Number(cid);
		} else if (by === 'details') {
			const c = this.getNodeParameter('automationContact', i, {}) as IDataObject;
			Object.assign(body, filled({
				phone: c.phone ? String(c.phone).trim() : undefined,
				email: c.email ? String(c.email).trim() : undefined,
				name: c.name as string,
				first_name: c.first_name as string,
				last_name: c.last_name as string,
			}));
		}
		const flat: IDataObject = {};
		const mapped = this.getNodeParameter('automationData', i, {}) as { value?: IDataObject | null };
		Object.entries(mapped.value ?? {}).forEach(([k, v]) => {
			if (v !== undefined && v !== null && v !== '') flat[k] = v;
		});
		const extra = this.getNodeParameter('automationExtra', i, {}) as { field?: Array<{ name: string; value: string }> };
		(extra.field ?? []).forEach((x) => {
			if (String(x.name ?? '').trim() !== '') flat[String(x.name).trim()] = x.value;
		});
		const data = nest(flat);
		if (Object.keys(data).length) body.data = data;
		const opts = this.getNodeParameter('automationOptions', i, {}) as IDataObject;
		if (opts.token) body.token = opts.token;
		if (opts.idempotency_key && String(opts.idempotency_key).trim() !== '') body.idempotency_key = String(opts.idempotency_key).trim();

		const res = await sendAppRequestFull.call(this, 'POST', `automations/${id}/start`, body);
		const out = res.body;
		const message = String(out.message ?? '');
		if (res.statusCode === 409) {
			throw new NodeOperationError(node, 'This automation is switched off in SendApp', {
				itemIndex: i,
				description: 'Switch it on in SendApp (Automations) and run the workflow again.',
			});
		}
		if (res.statusCode === 404) {
			throw new NodeOperationError(
				node,
				/contact/i.test(message) ? 'This contact does not exist in your SendApp account' : 'This automation does not exist in your SendApp account any more',
				{ itemIndex: i, description: message },
			);
		}
		if (res.statusCode === 429) {
			const wait = String(res.headers['retry-after'] ?? '');
			throw new NodeOperationError(node, 'Too many runs of this automation right now', {
				itemIndex: i,
				description: `${message}${wait ? ` Retry after ${wait} seconds.` : ''}`,
			});
		}
		if (res.statusCode >= 400) {
			throw new NodeOperationError(node, message || `SendApp answered with status ${res.statusCode}`, { itemIndex: i });
		}
		const duplicate = out.status === 'duplicate';
		return {
			automation_id: Number(id),
			status: out.status ?? 'success',
			duplicate,
			ran: Boolean(out.ran),
			run_id: out.run_id ?? null,
			run_status: out.run_status ?? null,
			reason: out.reason ?? (duplicate ? message : null),
			contact_id: out.contact_id ?? null,
			contact_created: Boolean(out.contact_created),
			resumes_at: out.resumes_at ?? null,
			warning: out.warning ?? null,
		};
	}

	if (resource === 'customField') {
		if (operation === 'getAll') {
			return (await getCustomFields.call(this)).map((f: CustomField) => ({ ...f, computed_by_ai: f.type === 'ai' }));
		}
		if (operation === 'create') {
			const type = this.getNodeParameter('fieldType', i) as string;
			const body: IDataObject = { name: String(this.getNodeParameter('fieldName', i)).trim(), type };
			if (type === 'select' || type === 'multiselect') body.options = tagList(this.getNodeParameter('fieldOptions', i));
			if (type === 'ai') body.ai_prompt = String(this.getNodeParameter('fieldPrompt', i)).trim();
			Object.assign(body, this.getNodeParameter('fieldFlags', i, {}) as IDataObject);
			const data = await sendAppRequest.call(this, 'POST', 'contact-fields', body);
			return (data.field as IDataObject) ?? {};
		}
	}

	if (resource === 'booking' && operation === 'upsert') {
		const f = this.getNodeParameter('bookingFields', i, {}) as IDataObject;
		if (!f.phone && !f.email) {
			throw new NodeOperationError(node, 'Write the customer’s phone number or email.', { itemIndex: i });
		}
		const body = filled({
			reference: this.getNodeParameter('reference', i) as string,
			start_time: this.getNodeParameter('start_time', i) as string,
			name: this.getNodeParameter('customerName', i) as string,
			end_time: f.end_time as string,
			phone: f.phone as string,
			email: f.email as string,
			people: f.people as number,
			notes: f.notes as string,
			location: f.location as string,
			status: f.status as string,
			timezone: f.timezone as string,
			token: this.getNodeParameter('bookingToken', i, '') as string,
		});
		const data = await sendAppRequest.call(this, 'POST', 'bookings', body);
		return { ...((data.booking as IDataObject) ?? {}), created: Boolean(data.created) };
	}

	throw new NodeOperationError(node, `The operation «${operation}» is not supported for «${resource}».`, { itemIndex: i });
}

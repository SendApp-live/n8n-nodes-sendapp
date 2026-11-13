import type {
	IDataObject,
	IHookFunctions,
	ILoadOptionsFunctions,
	INodePropertyOptions,
	INodeType,
	INodeTypeDescription,
	IWebhookFunctions,
	IWebhookResponseData,
} from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';

import { sendAppRequest } from '../SendApp/GenericFunctions';

/**
 * SendApp Trigger: starts the workflow when a WhatsApp number of SendApp receives a message, sends one (AI,
 * operator, automation, campaign, API) or gets a delivery status. On activation it subscribes the workflow's
 * webhook to that number (POST /api/whatsapp-meta/webhooks: a subscription next to the customer's own webhook,
 * never instead of it) and removes the subscription on deactivation. «Automation Runs» does the same with
 * /api/automations/hooks: the run of an automation chosen from a menu starts, finishes or fails.
 */
export class SendAppTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'SendApp Trigger',
		name: 'sendAppTrigger',
		icon: { light: 'file:sendapp.svg', dark: 'file:sendapp.dark.svg' },
		group: ['trigger'],
		version: [1],
		subtitle: '={{($parameter["source"] === "automations" ? $parameter["runEvents"] : $parameter["events"]).join(", ")}}',
		description: 'Starts the workflow on WhatsApp messages and statuses of a SendApp number, or when a SendApp automation runs',
		defaults: { name: 'SendApp Trigger' },
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'sendAppApi', required: true }],
		webhooks: [{ name: 'default', httpMethod: 'POST', responseMode: 'onReceived', path: 'webhook' }],
		properties: [
			{
				displayName: 'Listen To',
				name: 'source',
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'WhatsApp Messages', value: 'messages', description: 'Messages and statuses of a WhatsApp number' },
					{
						name: 'Automation Runs',
						value: 'automations',
						description: 'A SendApp automation starts, finishes or fails: make an automation on any event and pick it here',
					},
				],
				default: 'messages',
			},
			{
				displayName: 'WhatsApp Account Name or ID',
				name: 'token',
				type: 'options',
				typeOptions: { loadOptionsMethod: 'getAccounts' },
				displayOptions: { show: { source: ['messages'] } },
				required: true,
				default: '',
				description:
					'The SendApp account (WhatsApp number) to listen to. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
			},
			{
				displayName: 'Automation Name or ID',
				name: 'automationId',
				type: 'options',
				typeOptions: { loadOptionsMethod: 'getAllAutomations' },
				displayOptions: { show: { source: ['automations'] } },
				default: '',
				description:
					'The automation to listen to; empty = every automation. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
			},
			{
				displayName: 'When',
				name: 'runEvents',
				type: 'multiOptions',
				displayOptions: { show: { source: ['automations'] } },
				required: true,
				options: [
					{ name: 'The Automation Fails', value: 'run_failed' },
					{ name: 'The Automation Finishes', value: 'run_completed' },
					{ name: 'The Automation Starts', value: 'run_started' },
				],
				default: ['run_started'],
				description: "When the workflow starts. You receive the contact's personal data and must respect their opted out status (contact.opted_out).",
			},
			{
				displayName: 'Include Event Data',
				name: 'includeEventData',
				type: 'boolean',
				displayOptions: { show: { source: ['automations'] } },
				default: false,
				description:
					'Whether to include the data of the event that started the automation, without credentials and known free text fields. It can contain personal data and other data of the connected systems, under your responsibility.',
			},
			{
				displayName: 'Events',
				name: 'events',
				type: 'multiOptions',
				displayOptions: { show: { source: ['messages'] } },
				required: true,
				options: [
					{ name: 'Message Received', value: 'message_received', description: 'A contact writes on WhatsApp' },
					{
						name: 'Message Sent',
						value: 'message_sent',
						description: 'SendApp sends a message: the AI, an operator, an automation, a campaign or the API',
					},
					{ name: 'Message Status', value: 'message_status', description: 'A sent message is delivered, read or fails' },
				],
				default: ['message_received'],
			},
			{
				displayName: 'Include Raw Payload',
				name: 'includeRaw',
				type: 'boolean',
				displayOptions: { show: { source: ['messages'] } },
				default: false,
				description: 'Whether to add the payload exactly as Meta or SendApp sent it, under «raw»',
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
			async getAllAutomations(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const data = await sendAppRequest.call(this, 'GET', 'automations', {}, { all: 1 });
				const rows = ((data.automations as IDataObject[]) ?? []).map((a) => {
					const account = (a.account as IDataObject | null)?.name;
					return {
						name: `${String(a.name)}${account ? ` · ${String(account)}` : ''}${a.active ? '' : ' (off)'}`,
						value: String(a.id),
					};
				});
				return [{ name: 'Every Automation', value: '' }, ...rows];
			},
		},
	};

	webhookMethods = {
		default: {
			async checkExists(this: IHookFunctions): Promise<boolean> {
				const url = this.getNodeWebhookUrl('default');
				if (this.getNodeParameter('source', 'messages') === 'automations') {
					const events = [...(this.getNodeParameter('runEvents', []) as string[])].sort();
					const wanted = String(this.getNodeParameter('automationId', '') ?? '');
					const data = await sendAppRequest.call(this, 'GET', 'automations/hooks');
					const hit = ((data.hooks as IDataObject[]) ?? []).find(
						(h) =>
							h.url === url &&
							String(h.automation_id ?? '') === wanted &&
							Boolean(h.include_event_data) === (this.getNodeParameter('includeEventData', false) as boolean) &&
							[...((h.events as string[]) ?? [])].sort().join(',') === events.join(','),
					);
					if (!hit) return false;
					this.getWorkflowStaticData('node').webhookId = hit.id;
					return true;
				}
				const token = this.getNodeParameter('token') as string;
				const data = await sendAppRequest.call(this, 'GET', 'whatsapp-meta/webhooks', {}, { token });
				const hit = ((data.webhooks as IDataObject[]) ?? []).find((w) => w.url === url);
				if (!hit) return false;
				this.getWorkflowStaticData('node').webhookId = hit.id;
				return true;
			},
			async create(this: IHookFunctions): Promise<boolean> {
				const url = this.getNodeWebhookUrl('default');
				if (this.getNodeParameter('source', 'messages') === 'automations') {
					const body: IDataObject = { url, events: this.getNodeParameter('runEvents', []) as string[], label: 'n8n' };
					const automationId = String(this.getNodeParameter('automationId', '') ?? '');
					if (automationId !== '') body.automation_id = automationId;
					if (this.getNodeParameter('includeEventData', false)) body.include_event_data = true;
					const data = await sendAppRequest.call(this, 'POST', 'automations/hooks', body);
					if (!data.id) return false;
					this.getWorkflowStaticData('node').webhookId = data.id;
					return true;
				}
				const token = this.getNodeParameter('token') as string;
				const data = await sendAppRequest.call(this, 'POST', 'whatsapp-meta/webhooks', { token, url, label: 'n8n' });
				const id = (data.webhook as IDataObject | undefined)?.id;
				if (!id) return false;
				this.getWorkflowStaticData('node').webhookId = id;
				return true;
			},
			async delete(this: IHookFunctions): Promise<boolean> {
				const staticData = this.getWorkflowStaticData('node');
				const id = staticData.webhookId as string | undefined;
				if (!id) return true;
				if (this.getNodeParameter('source', 'messages') === 'automations') {
					try {
						await sendAppRequest.call(this, 'DELETE', `automations/hooks/${encodeURIComponent(id)}`);
					} catch (error) {
						this.logger.warn(`SendApp Trigger: the automation hook ${id} could not be removed: ${(error as Error).message}`);
						return false;
					}
					delete staticData.webhookId;
					return true;
				}
				const token = this.getNodeParameter('token') as string;
				try {
					await sendAppRequest.call(this, 'DELETE', `whatsapp-meta/webhooks/${encodeURIComponent(id)}`, {}, { token });
				} catch (error) {
					this.logger.warn(`SendApp Trigger: the webhook subscription ${id} could not be removed: ${(error as Error).message}`);
					return false;
				}
				delete staticData.webhookId;
				return true;
			},
		},
	};

	async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
		const body = this.getBodyData() as IDataObject;
		// An automation run: the delivery as it is (SendApp's hook filtered the automation and the event already).
		if (this.getNodeParameter('source', 'messages') === 'automations') {
			return { workflowData: [this.helpers.returnJsonArray([body])] };
		}
		const events = this.getNodeParameter('events', []) as string[];
		const includeRaw = this.getNodeParameter('includeRaw', false) as boolean;
		const items = toItems(body).filter((x) => events.includes(String(x.event)));
		if (!items.length) {
			return { noWebhookResponse: false, workflowData: undefined };
		}
		return {
			workflowData: [this.helpers.returnJsonArray(items.map((x) => (includeRaw ? { ...x, raw: body } : x)))],
		};
	}
}

/** Meta's payload (inbound messages, statuses) and SendApp's own `message_sent`, as simple items. */
function toItems(body: IDataObject): IDataObject[] {
	if (body.object === 'sendapp' && body.event === 'message_sent') {
		const m = (body.message as IDataObject) ?? {};
		return [
			{
				event: 'message_sent',
				account: body.token,
				to: body.to,
				conversation_id: body.conversation_id,
				text: m.text ?? null,
				media: m.media ?? null,
				sent_by: m.sent_by ?? null,
				operator: m.operator ?? null,
				message_id: m.wamid ?? null,
				status: m.status ?? null,
				error: m.error ?? null,
				timestamp: m.timestamp ?? null,
			},
		];
	}
	if (body.object !== 'whatsapp_business_account') return [];
	const out: IDataObject[] = [];
	for (const entry of (body.entry as IDataObject[]) ?? []) {
		for (const change of (entry.changes as IDataObject[]) ?? []) {
			const value = (change.value as IDataObject) ?? {};
			const contacts = (value.contacts as IDataObject[]) ?? [];
			for (const msg of (value.messages as IDataObject[]) ?? []) {
				const from = String(msg.from ?? '');
				const who = contacts.find((c) => c.wa_id === from);
				const type = String(msg.type ?? '');
				const part = (msg[type] as IDataObject) ?? {};
				const text =
					type === 'text'
						? ((msg.text as IDataObject)?.body ?? null)
						: type === 'button'
							? ((msg.button as IDataObject)?.text ?? null)
							: type === 'interactive'
								? (((part.button_reply as IDataObject) ?? (part.list_reply as IDataObject))?.title ?? null)
								: (part.caption ?? null);
				out.push({
					event: 'message_received',
					from,
					name: ((who?.profile as IDataObject) ?? {}).name ?? null,
					type,
					text,
					media_url: part.url ?? null,
					media_type: part.mime_type ?? null,
					message_id: msg.id ?? null,
					timestamp: msg.timestamp ? new Date(Number(msg.timestamp) * 1000).toISOString() : null,
				});
			}
			for (const st of (value.statuses as IDataObject[]) ?? []) {
				out.push({
					event: 'message_status',
					message_id: st.id ?? null,
					status: st.status ?? null,
					recipient: st.recipient_id ?? null,
					errors: st.errors ?? null,
					timestamp: st.timestamp ? new Date(Number(st.timestamp) * 1000).toISOString() : null,
				});
			}
		}
	}
	return out;
}

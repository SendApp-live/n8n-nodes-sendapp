import type {
	IAuthenticateGeneric,
	IAuthenticateRuleResponseCode,
	IAuthenticateRuleResponseSuccessBody,
	Icon,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class SendAppApi implements ICredentialType {
	name = 'sendAppApi';

	displayName = 'SendApp API';

	icon: Icon = {
		light: 'file:../nodes/SendApp/sendapp.svg',
		dark: 'file:../nodes/SendApp/sendapp.dark.svg',
	};

	documentationUrl = 'https://app.sendapp.ai/docs';

	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			description: 'Create it in SendApp: Settings → API keys',
		},
		{
			displayName: 'SendApp URL',
			name: 'baseUrl',
			type: 'string',
			default: 'https://app.sendapp.ai',
			description: 'Leave it as it is, unless SendApp gave you another address',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				'X-API-Key': '={{$credentials.apiKey}}',
			},
		},
	};

	// n8n only shows «Forbidden» for a refused key: these rules say why. They are checked in order — the response
	// codes when the call fails, the body when it succeeds (an expired plan still answers /me, with plan.expired).
	test: ICredentialTestRequest = {
		request: {
			baseURL: '={{$credentials.baseUrl.replace(/\\/+$/, "")}}/api',
			url: '/me',
			method: 'GET',
		},
		rules: [
			{
				type: 'responseCode',
				properties: {
					value: 401,
					message:
						'SendApp did not recognise this API key. Copy it again from SendApp: Settings → API keys.',
				},
			},
			{
				type: 'responseCode',
				properties: {
					value: 403,
					message:
						'SendApp refused this API key: the plan of this account does not include API access, or the account is suspended.',
				},
			},
			{
				type: 'responseSuccessBody',
				properties: {
					key: 'plan.expired',
					value: true,
					message:
						'The API key is valid, but the SendApp plan of this account has expired: renew it to send messages and save contacts from n8n.',
				},
			},
		] as Array<
			IAuthenticateRuleResponseCode | IAuthenticateRuleResponseSuccessBody
		> as IAuthenticateRuleResponseCode[],
	};
}

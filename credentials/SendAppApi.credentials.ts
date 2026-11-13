import type {
	IAuthenticateGeneric,
	Icon,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class SendAppApi implements ICredentialType {
	name = 'sendAppApi';

	displayName = 'SendApp API';

	icon: Icon = { light: 'file:../nodes/SendApp/sendapp.svg', dark: 'file:../nodes/SendApp/sendapp.dark.svg' };

	documentationUrl = 'https://app.sendapp.ai/docs/api';

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

	test: ICredentialTestRequest = {
		request: {
			baseURL: '={{$credentials.baseUrl.replace(/\\/+$/, "")}}/api',
			url: '/me',
			method: 'GET',
		},
	};
}

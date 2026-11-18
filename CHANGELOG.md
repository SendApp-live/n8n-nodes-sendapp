# Changelog

## 0.3.2

- Node picker: the actions read «Send a WhatsApp message» and «Send a WhatsApp template» (they read «whats app»).
- Node picker: the SendApp entry describes both the actions and the trigger (n8n shows the trigger's description for the merged entry).
- Credential test: says why SendApp refused the key (unknown key; plan without API access or account suspended; plan expired) instead of n8n's bare «Forbidden».
- Documentation links point to the SendApp API documentation (https://app.sendapp.ai/docs) and to this repository; search aliases WhatsApp and SMS.

## 0.3.1

- Source code now on GitHub (https://github.com/SendApp-live/n8n-nodes-sendapp); published from GitHub Actions with npm provenance. No functional changes.

## 0.3.0

- SendApp Trigger: new **Automation Runs**. The workflow starts as soon as a SendApp automation starts, finishes or fails; choose the automation from a list or leave it on every automation. The subscription is created on activation and removed on deactivation.

## 0.2.0

- New resource **Automation** → **Start**: starts a SendApp automation whose trigger is «Called by another system», for a contact found or created by phone or email, or an existing contact ID. **Data** shows the fields of the automation's last call; **Other Data** sends more fields by name (a dot makes a nested field). Optional idempotency key and account. Clear errors when the automation is switched off (409) or no longer exists (404), and when too many runs are started (429, with the wait).
- Contact **Create** and **Update**: **Custom Fields** shows the custom fields of your SendApp contacts with their type (number, date, yes/no, single choice with its choices, multiple choice). Fields computed by AI are not inputs; they come back in the output's `custom_fields`.
- New resource **Custom Field**: **Get Many** and **Create**.

## 0.1.0

- SendApp node: Send WhatsApp Message, Send WhatsApp Template (one field per template variable), Send SMS; Contact Create, Update, Find, Add Tags, Remove Tags; Booking Create or Update.
- SendApp Trigger: Message Received, Message Sent, Message Status, through a webhook subscription that is created on activation and removed on deactivation.

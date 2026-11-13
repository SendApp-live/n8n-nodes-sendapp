# Changelog

## 0.3.0

- SendApp Trigger: new **Automation Runs**. The workflow starts as soon as a SendApp automation starts, finishes or fails; choose the automation from a list or leave it on every automation. The subscription is created on activation and removed on deactivation.

## 0.2.0

- New resource **Automation** → **Start**: starts a SendApp automation whose trigger is «Called by another system», for a contact found or created by phone or email, or an existing contact ID. **Data** shows the fields of the automation's last call; **Other Data** sends more fields by name (a dot makes a nested field). Optional idempotency key and account. Clear errors when the automation is switched off (409) or no longer exists (404), and when too many runs are started (429, with the wait).
- Contact **Create** and **Update**: **Custom Fields** shows the custom fields of your SendApp contacts with their type (number, date, yes/no, single choice with its choices, multiple choice). Fields computed by AI are not inputs; they come back in the output's `custom_fields`.
- New resource **Custom Field**: **Get Many** and **Create**.

## 0.1.0

- SendApp node: Send WhatsApp Message, Send WhatsApp Template (one field per template variable), Send SMS; Contact Create, Update, Find, Add Tags, Remove Tags; Booking Create or Update.
- SendApp Trigger: Message Received, Message Sent, Message Status, through a webhook subscription that is created on activation and removed on deactivation.

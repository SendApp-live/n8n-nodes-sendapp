# n8n-nodes-sendapp

Official [SendApp](https://sendapp.live) nodes for [n8n](https://n8n.io): send WhatsApp messages and approved templates, send SMS, start SendApp automations, manage contacts, custom fields and bookings, and start workflows when a WhatsApp number of SendApp receives or sends a message.

[Installation](#installation) · [Credentials](#credentials) · [Operations](#operations) · [Trigger](#trigger) · [Compatibility](#compatibility) · [Resources](#resources)

## Installation

Follow the [installation guide](https://docs.n8n.io/integrations/community-nodes/installation/) in the n8n community nodes documentation and install `n8n-nodes-sendapp`.

## Credentials

1. In SendApp open **Settings → API keys** and create a key.
2. In n8n create a **SendApp API** credential and paste the key. Leave **SendApp URL** as `https://app.sendapp.ai`.

The key is sent in the `X-API-Key` header. Your SendApp plan must include API access.

## Operations

**Message**
- **Send WhatsApp Message**: free text, with an optional file (image, video, audio, document). WhatsApp delivers free text only within 24 hours of the customer's last message.
- **Send WhatsApp Template**: an approved template, at any time. After you choose the template, n8n shows one field for each of its variables (header, body, URL button, coupon code).
- **Send SMS**: with your SendApp SMS credits.

**Contact**
- **Create** (or get the contact that already has this phone number or email), **Update**, **Find** (by phone number in any format, email or name), **Add Tags**, **Remove Tags**.

**Contact custom fields**: on Create and Update, **Custom Fields** lists the custom fields of your SendApp contacts (Contacts → Custom fields) with their type. Fields computed by AI are filled in by SendApp and come back in the output (`custom_fields`).

**Custom Field**
- **Get Many**: the custom fields of your contacts, with type and choices. **Create**: a new custom field (text, number, date, choice, multiple choice, yes/no, link, phone, email, or computed by AI).

**Automation**
- **Start**: starts a SendApp automation whose trigger is **Called by another system** (switched on), for a contact found or created by phone or email, or an existing contact ID. **Data** lists the fields the automation received last time; **Other Data** adds more by name. An **Idempotency Key** (for example the order ID) makes sure the same key does not start it twice within 24 hours. The output says whether it started (`ran`, `run_id`, `run_status`, `reason`) and which contact it used (`contact_id`, `contact_created`).

**Booking**
- **Create or Update** a booking in the SendApp Agenda, identified by your own reference: sending the same reference again updates it. Reminders and automations work as for any SendApp booking.

The SendApp node can also be used as a tool by n8n's AI Agent.

## Trigger

**SendApp Trigger** starts the workflow on the events of one WhatsApp number:

- **Message Received**: a contact writes on WhatsApp (`from`, `name`, `type`, `text`, `media_url`, `message_id`, `timestamp`).
- **Message Sent**: SendApp sends a message: the AI, an operator, an automation, a campaign or the API (`to`, `text`, `sent_by`, `operator`, `message_id`).
- **Message Status**: a sent message is delivered, read or fails (`message_id`, `status`, `recipient`, `errors`).

When the workflow is activated the node subscribes its webhook to that number in SendApp; when it is deactivated the subscription is removed. Your own webhook set in SendApp keeps working: a number can have up to 10 subscriptions next to it.

## Development

```bash
npm run lint && npm run build
npm test                                  # the built node against simulated answers (node:test)
SENDAPP_BASE_URL=http://127.0.0.1:8000 SENDAPP_KEY_FILE=<file with an sk_ key> SENDAPP_AUTOMATION_ID=<id> node test/local-run.js
```

## Compatibility

Built and tested with n8n 2.x (Node.js 24).

## Resources

- [SendApp API documentation](https://app.sendapp.ai/docs)
- [n8n community nodes documentation](https://docs.n8n.io/integrations/#community-nodes)

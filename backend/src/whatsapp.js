export class WhatsAppClient {
  constructor(config = process.env) {
    this.accessToken = config.WHATSAPP_ACCESS_TOKEN || '';
    this.phoneNumberId = config.WHATSAPP_PHONE_NUMBER_ID || '';
    this.verifyToken = config.WHATSAPP_VERIFY_TOKEN || 'inablink_verify_token';
    this.graphApiVersion = config.WHATSAPP_API_VERSION || 'v19.0';
  }

  async sendMessage(to, text) {
    if (!this.accessToken || !this.phoneNumberId) {
      throw new Error('Meta WhatsApp credentials are not configured.');
    }
    const url = `https://graph.facebook.com/${this.graphApiVersion}/${this.phoneNumberId}/messages`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: 'text',
        text: { body: text },
      }),
    });

    if (!response.ok) {
      const errBody = await response.text();
      throw new Error(`Meta API error (${response.status}): ${errBody}`);
    }

    return await response.json();
  }

  verifyWebhook(mode, token, challenge) {
    if (mode === 'subscribe' && token === this.verifyToken) {
      return challenge;
    }
    throw new Error('Webhook verification failed.');
  }

  parseIncomingWebhook(body) {
    const entry = body?.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;
    const message = value?.messages?.[0];
    const contact = value?.contacts?.[0];

    if (!message) return null;

    return {
      from: message.from,
      id: message.id,
      timestamp: message.timestamp,
      type: message.type,
      text: message.text?.body || '',
      profileName: contact?.profile?.name || '',
    };
  }
}

import { createHmac, timingSafeEqual } from 'node:crypto';

export class WhatsAppClient {
  constructor(config = process.env, fetchImpl = fetch) {
    this.accessToken = config.WHATSAPP_ACCESS_TOKEN || '';
    this.phoneNumberId = config.WHATSAPP_PHONE_NUMBER_ID || '';
    this.verifyToken = config.WHATSAPP_VERIFY_TOKEN || '';
    this.appSecret = config.WHATSAPP_APP_SECRET || '';
    this.graphApiVersion = config.WHATSAPP_API_VERSION || '';
    this.fetch = fetchImpl;
  }

  async sendTextMessage(to, text) {
    if (!this.accessToken || !this.phoneNumberId || !this.graphApiVersion) {
      throw new Error('WhatsApp API credentials are not configured.');
    }

    const response = await this.fetch(
      `https://graph.facebook.com/${this.graphApiVersion}/${this.phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: to.replace(/^\+/, ''),
          type: 'text',
          text: { body: text },
        }),
      },
    );

    if (!response.ok) {
      const result = await response.json().catch(() => null);
      const providerError = result?.error;
      const error = new Error('WhatsApp API rejected the message.');
      error.statusCode = response.status;
      if (Number.isInteger(providerError?.code)) error.providerCode = providerError.code;
      if (Number.isInteger(providerError?.error_subcode)) {
        error.providerSubcode = providerError.error_subcode;
      }
      throw error;
    }

    const result = await response.json();
    const messageId = result.messages?.[0]?.id;
    if (!messageId) throw new Error('WhatsApp API response did not include a message ID.');
    return messageId;
  }

  verifyWebhook(mode, token, challenge) {
    if (!this.verifyToken) throw new Error('WhatsApp webhook verification is not configured.');
    if (mode === 'subscribe' && token === this.verifyToken && typeof challenge === 'string') {
      return challenge;
    }
    throw new Error('Webhook verification failed.');
  }

  verifyWebhookSignature(rawBody, signature) {
    if (!this.appSecret || !Buffer.isBuffer(rawBody) || typeof signature !== 'string') return false;
    const expected = `sha256=${createHmac('sha256', this.appSecret).update(rawBody).digest('hex')}`;
    const receivedBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expected);
    return receivedBuffer.length === expectedBuffer.length
      && timingSafeEqual(receivedBuffer, expectedBuffer);
  }
}

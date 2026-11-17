import { createHmac, timingSafeEqual } from 'node:crypto';

export interface MetaBusinessProfile {
  display_phone_number?: string;
  verified_name?: string;
  about?: string;
  address?: string;
  description?: string;
  email?: string;
  profile_picture_url?: string;
  websites?: string[];
  vertical?: string;
}

export interface MetaUpdateBusinessProfileInput {
  about?: string;
  address?: string;
  description?: string;
  email?: string;
  websites?: string[];
  vertical?: string;
}

export class WhatsAppClient {
  readonly accessToken: string;
  readonly phoneNumberId: string;
  readonly verifyToken: string;
  readonly appSecret: string;
  readonly graphApiVersion: string;
  private readonly fetch: typeof fetch;

  constructor(config: NodeJS.ProcessEnv = process.env, fetchImpl: typeof fetch = fetch) {
    this.accessToken = config.WHATSAPP_ACCESS_TOKEN || '';
    this.phoneNumberId = config.WHATSAPP_PHONE_NUMBER_ID || '';
    this.verifyToken = config.WHATSAPP_VERIFY_TOKEN || '';
    this.appSecret = config.WHATSAPP_APP_SECRET || '';
    this.graphApiVersion = config.WHATSAPP_API_VERSION || '';
    this.fetch = fetchImpl;
  }

  isConfigured(): boolean {
    return Boolean(this.accessToken && this.phoneNumberId && this.graphApiVersion);
  }

  async getBusinessProfile(): Promise<MetaBusinessProfile | null> {
    if (!this.isConfigured()) return null;

    const baseHeaders = {
      Authorization: `Bearer ${this.accessToken}`,
    };

    const [phoneRes, profileRes] = await Promise.all([
      this.fetch(
        `https://graph.facebook.com/${this.graphApiVersion}/${this.phoneNumberId}?fields=display_phone_number,verified_name`,
        { headers: baseHeaders },
      ).catch(() => null),
      this.fetch(
        `https://graph.facebook.com/${this.graphApiVersion}/${this.phoneNumberId}/whatsapp_business_profile?fields=about,address,description,email,profile_picture_url,websites,vertical`,
        { headers: baseHeaders },
      ).catch(() => null),
    ]);

    const result: MetaBusinessProfile = {};

    if (phoneRes && phoneRes.ok) {
      const phoneData = await phoneRes.json().catch(() => null);
      if (phoneData) {
        if (typeof phoneData.display_phone_number === 'string') {
          result.display_phone_number = phoneData.display_phone_number;
        }
        if (typeof phoneData.verified_name === 'string') {
          result.verified_name = phoneData.verified_name;
        }
      }
    }

    if (profileRes && profileRes.ok) {
      const profileData = await profileRes.json().catch(() => null);
      const profileItem = profileData?.data?.[0];
      if (profileItem && typeof profileItem === 'object') {
        if (typeof profileItem.about === 'string') result.about = profileItem.about;
        if (typeof profileItem.address === 'string') result.address = profileItem.address;
        if (typeof profileItem.description === 'string') result.description = profileItem.description;
        if (typeof profileItem.email === 'string') result.email = profileItem.email;
        if (typeof profileItem.profile_picture_url === 'string') {
          result.profile_picture_url = profileItem.profile_picture_url;
        }
        if (Array.isArray(profileItem.websites)) {
          result.websites = profileItem.websites.filter((w: unknown) => typeof w === 'string');
        }
        if (typeof profileItem.vertical === 'string') result.vertical = profileItem.vertical;
      }
    }

    return result;
  }

  async updateBusinessProfile(input: MetaUpdateBusinessProfileInput): Promise<void> {
    if (!this.isConfigured()) {
      throw new Error('WhatsApp API credentials are not configured.');
    }

    const payload: Record<string, unknown> = {
      messaging_product: 'whatsapp',
    };
    if (input.about !== undefined) payload.about = input.about;
    if (input.address !== undefined) payload.address = input.address;
    if (input.description !== undefined) payload.description = input.description;
    if (input.email !== undefined) payload.email = input.email;
    if (input.websites !== undefined) payload.websites = input.websites;
    if (input.vertical !== undefined) payload.vertical = input.vertical;

    const response = await this.fetch(
      `https://graph.facebook.com/${this.graphApiVersion}/${this.phoneNumberId}/whatsapp_business_profile`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      },
    );

    if (!response.ok) {
      const result = await response.json().catch(() => null);
      const providerError = result?.error;
      const error = new Error('WhatsApp API rejected the profile update.');
      Object.assign(error, { statusCode: response.status });
      if (Number.isInteger(providerError?.code)) Object.assign(error, { providerCode: providerError.code });
      if (Number.isInteger(providerError?.error_subcode)) {
        Object.assign(error, { providerSubcode: providerError.error_subcode });
      }
      throw error;
    }
  }

  async sendTextMessage(to: string, text: string): Promise<string> {
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
      Object.assign(error, { statusCode: response.status });
      if (Number.isInteger(providerError?.code)) Object.assign(error, { providerCode: providerError.code });
      if (Number.isInteger(providerError?.error_subcode)) {
        Object.assign(error, { providerSubcode: providerError.error_subcode });
      }
      throw error;
    }

    const result = await response.json();
    const messageId = result.messages?.[0]?.id;
    if (!messageId) throw new Error('WhatsApp API response did not include a message ID.');
    return messageId;
  }

  verifyWebhook(mode: unknown, token: unknown, challenge: unknown): string {
    if (!this.verifyToken) throw new Error('WhatsApp webhook verification is not configured.');
    if (mode === 'subscribe' && token === this.verifyToken && typeof challenge === 'string') {
      return challenge;
    }
    throw new Error('Webhook verification failed.');
  }

  verifyWebhookSignature(rawBody: Buffer, signature: string | undefined): boolean {
    if (!this.appSecret || !Buffer.isBuffer(rawBody) || typeof signature !== 'string') return false;
    const expected = `sha256=${createHmac('sha256', this.appSecret).update(rawBody).digest('hex')}`;
    const receivedBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expected);
    return receivedBuffer.length === expectedBuffer.length
      && timingSafeEqual(receivedBuffer, expectedBuffer);
  }
}

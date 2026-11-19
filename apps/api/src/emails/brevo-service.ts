import { env } from '../config/env';
import { isDatabaseConfigured, pool } from '../database/pool';
import { logError } from '../utils/logger';

interface EmailPayload {
  userId?: string | null;
  to: string;
  toName?: string;
  subject: string;
  htmlContent: string;
  templateType: string;
}

export async function sendBrevoEmail(payload: EmailPayload) {
  if (!env.brevoApiKey) {
    if (isDatabaseConfigured) {
      await pool.query(
        `INSERT INTO email_logs (user_id, recipient_email, template_type, subject, status, error_message)
         VALUES ($1, $2, $3, $4, 'failed', 'BREVO_API_KEY not configured')`,
        [payload.userId ?? null, payload.to, payload.templateType, payload.subject]
      );
    }
    return { sent: false, error: 'BREVO_API_KEY not configured' };
  }

  try {
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'api-key': env.brevoApiKey,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        sender: { email: env.brevoSenderEmail, name: env.brevoSenderName },
        to: [{ email: payload.to, name: payload.toName ?? payload.to }],
        subject: payload.subject,
        htmlContent: payload.htmlContent,
        tags: [payload.templateType]
      })
    });

    const data = (await res.json()) as { messageId?: string; message?: string };
    if (!res.ok) {
      throw new Error(data.message ?? `Brevo HTTP ${res.status}`);
    }

    if (isDatabaseConfigured) {
      await pool.query(
        `INSERT INTO email_logs (user_id, recipient_email, template_type, subject, brevo_message_id, status)
         VALUES ($1, $2, $3, $4, $5, 'sent')`,
        [payload.userId ?? null, payload.to, payload.templateType, payload.subject, data.messageId ?? null]
      );
    }
    return { sent: true, messageId: data.messageId };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown Brevo error';
    logError('brevo-service', 'Failed to send Brevo transactional email', err);
    if (isDatabaseConfigured) {
      await pool.query(
        `INSERT INTO email_logs (user_id, recipient_email, template_type, subject, status, error_message)
         VALUES ($1, $2, $3, $4, 'failed', $5)`,
        [payload.userId ?? null, payload.to, payload.templateType, payload.subject, msg]
      );
    }
    return { sent: false, error: msg };
  }
}

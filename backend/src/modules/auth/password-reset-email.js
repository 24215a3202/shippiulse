import nodemailer from 'nodemailer';
import { env } from '../../config/env.js';

let transport;

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

export async function sendPasswordResetEmail({ email, organizationName, resetUrl }) {
  if (!env.SMTP_URL) return false;

  transport ??= nodemailer.createTransport(env.SMTP_URL);
  const safeOrganizationName = escapeHtml(organizationName);
  await transport.sendMail({
    from: env.SMTP_FROM ?? 'ShipPulse <no-reply@localhost>',
    to: email,
    subject: 'Reset your ShipPulse password',
    text: `A password reset was requested for ${organizationName}. Use this link within 30 minutes: ${resetUrl}`,
    html: `<p>A password reset was requested for ${safeOrganizationName}.</p><p><a href="${resetUrl}">Reset your password</a></p><p>This link expires in 30 minutes. If you did not request it, you can ignore this email.</p>`,
  });
  return true;
}

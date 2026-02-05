/**
 * Email service for Cloudflare Workers
 * Uses Cloudflare Email Workers or external providers (Resend, SendGrid)
 */

import { generateRandomString } from './crypto';

// Email template types
export type EmailTemplate = 
  | 'verification'
  | 'password-reset'
  | 'welcome'
  | '2fa-enabled'
  | '2fa-disabled';

export interface EmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export interface EmailConfig {
  apiKey?: string;
  fromEmail: string;
  fromName: string;
  provider: 'resend' | 'sendgrid' | 'mailgun' | 'console';
}

/**
 * Generate a secure verification token
 */
export function generateVerificationToken(): string {
  return generateRandomString(32);
}

/**
 * Generate email HTML for verification
 */
export function getVerificationEmailHtml(
  userName: string,
  verificationUrl: string,
  appName: string
): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Verify your email</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; border-radius: 10px 10px 0 0;">
    <h1 style="color: white; margin: 0; font-size: 24px;">${appName}</h1>
  </div>
  <div style="background: #f9fafb; padding: 30px; border-radius: 0 0 10px 10px; border: 1px solid #e5e7eb; border-top: none;">
    <h2 style="color: #1f2937; margin-top: 0;">Verify your email address</h2>
    <p>Hi ${userName},</p>
    <p>Thanks for signing up! Please verify your email address by clicking the button below:</p>
    <div style="text-align: center; margin: 30px 0;">
      <a href="${verificationUrl}" style="background: #667eea; color: white; padding: 12px 30px; border-radius: 6px; text-decoration: none; font-weight: 500; display: inline-block;">Verify Email</a>
    </div>
    <p style="color: #6b7280; font-size: 14px;">If the button doesn't work, copy and paste this link into your browser:</p>
    <p style="color: #6b7280; font-size: 12px; word-break: break-all;">${verificationUrl}</p>
    <p style="color: #6b7280; font-size: 14px;">This link will expire in 24 hours.</p>
    <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;">
    <p style="color: #9ca3af; font-size: 12px; margin-bottom: 0;">If you didn't create an account, you can safely ignore this email.</p>
  </div>
</body>
</html>`;
}

/**
 * Generate email HTML for password reset
 */
export function getPasswordResetEmailHtml(
  userName: string,
  resetUrl: string,
  appName: string
): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Reset your password</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%); padding: 30px; border-radius: 10px 10px 0 0;">
    <h1 style="color: white; margin: 0; font-size: 24px;">${appName}</h1>
  </div>
  <div style="background: #f9fafb; padding: 30px; border-radius: 0 0 10px 10px; border: 1px solid #e5e7eb; border-top: none;">
    <h2 style="color: #1f2937; margin-top: 0;">Reset your password</h2>
    <p>Hi ${userName},</p>
    <p>We received a request to reset your password. Click the button below to choose a new password:</p>
    <div style="text-align: center; margin: 30px 0;">
      <a href="${resetUrl}" style="background: #f5576c; color: white; padding: 12px 30px; border-radius: 6px; text-decoration: none; font-weight: 500; display: inline-block;">Reset Password</a>
    </div>
    <p style="color: #6b7280; font-size: 14px;">If the button doesn't work, copy and paste this link into your browser:</p>
    <p style="color: #6b7280; font-size: 12px; word-break: break-all;">${resetUrl}</p>
    <p style="color: #6b7280; font-size: 14px;">This link will expire in 1 hour.</p>
    <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;">
    <p style="color: #9ca3af; font-size: 12px; margin-bottom: 0;">If you didn't request a password reset, you can safely ignore this email. Your password will remain unchanged.</p>
  </div>
</body>
</html>`;
}

/**
 * Send email using Resend API
 */
async function sendWithResend(options: EmailOptions, config: EmailConfig): Promise<boolean> {
  if (!config.apiKey) {
    throw new Error('Resend API key not configured');
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: `${config.fromName} <${config.fromEmail}>`,
      to: [options.to],
      subject: options.subject,
      html: options.html,
      text: options.text,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    console.error('Resend error:', error);
    throw new Error(`Failed to send email: ${response.status}`);
  }

  return true;
}

/**
 * Send email using SendGrid API
 */
async function sendWithSendGrid(options: EmailOptions, config: EmailConfig): Promise<boolean> {
  if (!config.apiKey) {
    throw new Error('SendGrid API key not configured');
  }

  const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: options.to }] }],
      from: { email: config.fromEmail, name: config.fromName },
      subject: options.subject,
      content: [
        { type: 'text/html', value: options.html },
        ...(options.text ? [{ type: 'text/plain', value: options.text }] : []),
      ],
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    console.error('SendGrid error:', error);
    throw new Error(`Failed to send email: ${response.status}`);
  }

  return true;
}

/**
 * Log email to console (for development)
 */
function sendToConsole(options: EmailOptions, config: EmailConfig): boolean {
  console.log('='.repeat(50));
  console.log('EMAIL (console mode)');
  console.log('='.repeat(50));
  console.log(`From: ${config.fromName} <${config.fromEmail}>`);
  console.log(`To: ${options.to}`);
  console.log(`Subject: ${options.subject}`);
  console.log('-'.repeat(50));
  console.log(options.text || 'See HTML content');
  console.log('='.repeat(50));
  return true;
}

/**
 * Send email using configured provider
 */
export async function sendEmail(
  options: EmailOptions,
  config: EmailConfig
): Promise<boolean> {
  switch (config.provider) {
    case 'resend':
      return sendWithResend(options, config);
    case 'sendgrid':
      return sendWithSendGrid(options, config);
    case 'console':
    default:
      return sendToConsole(options, config);
  }
}

/**
 * Send verification email
 */
export async function sendVerificationEmail(
  to: string,
  userName: string,
  token: string,
  config: EmailConfig,
  clientUrl: string,
  appName: string = 'L_EXE'
): Promise<boolean> {
  const verificationUrl = `${clientUrl}/verify-email?token=${token}`;
  
  return sendEmail({
    to,
    subject: `Verify your email for ${appName}`,
    html: getVerificationEmailHtml(userName, verificationUrl, appName),
    text: `Hi ${userName},\n\nPlease verify your email by visiting: ${verificationUrl}\n\nThis link expires in 24 hours.`,
  }, config);
}

/**
 * Send password reset email
 */
export async function sendPasswordResetEmail(
  to: string,
  userName: string,
  token: string,
  config: EmailConfig,
  clientUrl: string,
  appName: string = 'L_EXE'
): Promise<boolean> {
  const resetUrl = `${clientUrl}/reset-password?token=${token}`;
  
  return sendEmail({
    to,
    subject: `Reset your password for ${appName}`,
    html: getPasswordResetEmailHtml(userName, resetUrl, appName),
    text: `Hi ${userName},\n\nReset your password by visiting: ${resetUrl}\n\nThis link expires in 1 hour.`,
  }, config);
}

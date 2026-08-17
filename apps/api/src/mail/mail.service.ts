import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
  replyTo?: string;
}

/**
 * SMTP delivery. When SMTP_HOST is unset the service logs the message instead
 * of sending it, so the stack is fully runnable in development and CI without
 * a mail server and without silently swallowing outbound mail.
 */
@Injectable()
export class MailService implements OnModuleInit {
  private readonly logger = new Logger(MailService.name);
  private transporter: Transporter | null = null;

  constructor(@Inject(ENV) private readonly env: Env) {}

  onModuleInit(): void {
    if (!this.env.SMTP_HOST) {
      this.logger.warn('SMTP_HOST is not set; outbound email will be logged rather than sent');
      return;
    }
    this.transporter = createTransport({
      host: this.env.SMTP_HOST,
      port: this.env.SMTP_PORT,
      secure: this.env.SMTP_SECURE,
      ...(this.env.SMTP_USER
        ? { auth: { user: this.env.SMTP_USER, pass: this.env.SMTP_PASSWORD ?? '' } }
        : {}),
      pool: true,
      maxConnections: 3,
    });
  }

  get isConfigured(): boolean {
    return this.transporter !== null;
  }

  async send(message: MailMessage): Promise<void> {
    if (!this.transporter) {
      this.logger.log(`[dry-run email] to=${message.to} subject="${message.subject}"`);
      return;
    }
    await this.transporter.sendMail({
      from: this.env.MAIL_FROM,
      to: message.to,
      subject: message.subject,
      text: message.text,
      ...(message.html ? { html: message.html } : {}),
      ...(message.replyTo ? { replyTo: message.replyTo } : {}),
    });
  }
}

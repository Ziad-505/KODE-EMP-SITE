import { useState, type FormEvent } from 'react';
import {
  ALL_TICKET_CATEGORIES,
  ALL_TICKET_PRIORITIES,
  TicketCategory,
  TicketPriority,
  createTicketSchema,
} from '@kode/contracts';
import { ApiError } from '../lib/api-client';
import { useCreateTicket, useMyTickets } from '../lib/queries';
import { Icon } from '../components/icon';
import { InnerBanner, formatDate } from './shared';

const LABEL: Record<string, string> = {
  HARDWARE: 'Hardware',
  SOFTWARE: 'Software',
  NETWORK: 'Network or Wi-Fi',
  ACCESS: 'Accounts and access',
  OTHER: 'Something else',
  LOW: 'Low',
  NORMAL: 'Normal',
  HIGH: 'High',
  URGENT: 'Urgent',
};

export function SupportPage() {
  const createTicket = useCreateTicket();
  const { data: tickets } = useMyTickets();

  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [location, setLocation] = useState('');
  const [category, setCategory] = useState<TicketCategory>(TicketCategory.OTHER);
  const [priority, setPriority] = useState<TicketPriority>(TicketPriority.NORMAL);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [reference, setReference] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    setReference(null);

    const parsed = createTicketSchema.safeParse({
      subject,
      body,
      category,
      priority,
      location: location || null,
      attachmentIds: [],
    });

    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0];
        if (typeof key === 'string' && !next[key]) next[key] = issue.message;
      }
      setErrors(next);
      return;
    }

    setErrors({});
    try {
      const ticket = await createTicket.mutateAsync(parsed.data);
      setReference(ticket.reference);
      setSubject('');
      setBody('');
      setLocation('');
    } catch (error) {
      if (error instanceof ApiError) {
        setFormError(error.message);
        const details: Record<string, string> = {};
        for (const [field, messages] of Object.entries(error.details)) {
          if (messages[0]) details[field] = messages[0];
        }
        setErrors(details);
      } else {
        setFormError('Your request could not be sent. Please try again.');
      }
    }
  }

  return (
    <main className="inner-page">
      <InnerBanner
        title="IT support"
        description="A direct line to KODE IT. Your request reaches the inbox that opens its Odoo ticket."
      />

      <form className="support-form" onSubmit={onSubmit} noValidate>
        <p className="micro-label">THE HELPDESK, WITHOUT THE HASSLE</p>
        <div className="support-layout">
          <div>
            <h2>
              What needs
              <br />
              <strong>fixing?</strong>
            </h2>
            <p>
              Send the essentials. Your request goes to the KODE IT inbox and becomes an Odoo ticket
              automatically. You get a reference straight away.
            </p>
          </div>

          <div className="form-panel">
            {reference ? (
              <p className="form-alert" data-tone="success" role="status">
                Sent. Your reference is <strong className="tnum">{reference}</strong>. KODE IT will
                pick it up from the shared inbox.
              </p>
            ) : null}
            {formError ? (
              <p className="form-alert" role="alert">
                {formError}
              </p>
            ) : null}

            <label data-reveal="field">
              SUBJECT
              <input
                value={subject}
                onChange={(event) => setSubject(event.target.value)}
                placeholder="Short summary of the problem"
                aria-invalid={Boolean(errors.subject)}
                required
              />
            </label>
            {errors.subject ? <span className="field-error">{errors.subject}</span> : null}

            <label data-reveal="field">
              CATEGORY
              <select
                value={category}
                onChange={(event) => setCategory(event.target.value as TicketCategory)}
              >
                {ALL_TICKET_CATEGORIES.map((value) => (
                  <option key={value} value={value}>
                    {LABEL[value]}
                  </option>
                ))}
              </select>
            </label>

            <label data-reveal="field">
              PRIORITY
              <select
                value={priority}
                onChange={(event) => setPriority(event.target.value as TicketPriority)}
              >
                {ALL_TICKET_PRIORITIES.map((value) => (
                  <option key={value} value={value}>
                    {LABEL[value]}
                  </option>
                ))}
              </select>
            </label>

            <label data-reveal="field">
              WHERE
              <input
                value={location}
                onChange={(event) => setLocation(event.target.value)}
                placeholder="Reception, Studio 02, poolside office..."
              />
            </label>

            <label data-reveal="field">
              THE ISSUE
              <textarea
                value={body}
                onChange={(event) => setBody(event.target.value)}
                placeholder="Tell KODE IT what happened, where and when."
                rows={5}
                aria-invalid={Boolean(errors.body)}
                required
              />
            </label>
            {errors.body ? <span className="field-error">{errors.body}</span> : null}

            <button className="ink-button" type="submit" disabled={createTicket.isPending}>
              {createTicket.isPending ? 'SENDING...' : 'SEND TO IT'} <Icon name="arrow" />
            </button>
          </div>
        </div>
      </form>

      {tickets && tickets.items.length ? (
        <>
          <div className="filter-bar" style={{ marginBottom: 18 }}>
            <p className="micro-label" style={{ color: 'var(--blue)' }}>
              YOUR RECENT REQUESTS
            </p>
          </div>
          <div className="ticket-list">
            {tickets.items.map((ticket) => (
              <article className="ticket-row" data-reveal="row" key={ticket.id}>
                <div>
                  <b>{ticket.subject}</b>
                  <small>
                    {ticket.reference} · {formatDate(ticket.createdAt)} · {LABEL[ticket.category]}
                  </small>
                </div>
                <span className="status-chip" data-status={ticket.status}>
                  {ticket.status.replace('_', ' ')}
                </span>
              </article>
            ))}
          </div>
        </>
      ) : null}
    </main>
  );
}

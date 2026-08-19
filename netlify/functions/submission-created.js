/**
 * Sends the attendee their confirmation email after Netlify has accepted and
 * stored a registration.
 *
 * The filename is significant. Netlify only fires an event-triggered function
 * when the file is named after the event, so this MUST stay
 * `submission-created.js` for it to run automatically on a verified form
 * submission. Renaming it to something descriptive would silently stop it
 * firing. See netlify.toml for the functions directory.
 *
 * Netlify handles the team notification separately (dashboard setting), so
 * this function is only responsible for the attendee's copy.
 *
 * Required environment variables (set in the Netlify dashboard, never in git):
 *   SENDGRID_API_KEY  - SendGrid API key with "Mail Send" permission
 *   EMAIL_FROM        - verified SendGrid sender, e.g. marketing@evvolabs.com
 * Optional:
 *   EMAIL_FROM_NAME   - display name, defaults to "Evvo Labs"
 *   EMAIL_REPLY_TO    - defaults to EMAIL_FROM
 */

const FORM_NAME = 'webinar-registration';

/* Event details are taken from the existing register.html success pane. */
const EVENT = {
  name:     'Resilience by Design: Beyond the Outage Era',
  date:     'Thursday, 3 September 2026',
  time:     '11:00 AM – 12:00 PM SGT',
  platform: 'Microsoft Teams',
};

/** Escape values before they are interpolated into the HTML email. */
function esc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Conservative email check; SendGrid does the authoritative validation. */
function isValidEmail(value) {
  return typeof value === 'string'
    && value.length <= 254
    && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value.trim());
}

function buildHtml(data) {
  const firstName = esc((data.firstName || '').trim()) || 'there';

  const row = (label, value) => value
    ? `<tr>
         <td style="padding:6px 16px 6px 0;color:#5B6070;font:600 13px Arial,sans-serif;white-space:nowrap;vertical-align:top;">${esc(label)}</td>
         <td style="padding:6px 0;color:#1A1E33;font:400 14px Arial,sans-serif;">${esc(value)}</td>
       </tr>`
    : '';

  const orgType = data.orgType === 'Other' && data.orgTypeOther
    ? `Other – ${data.orgTypeOther}`
    : data.orgType;

  return `<!DOCTYPE html>
<html><body style="margin:0;background:#F4F6FB;padding:24px;">
<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;">
  <tr><td style="height:4px;background:#F05A2B;font-size:0;line-height:0;">&nbsp;</td></tr>
  <tr><td style="padding:28px 28px 4px;">
    <h1 style="margin:0;font:700 21px Arial,sans-serif;color:#1A1E33;">You&rsquo;re registered.</h1>
  </td></tr>
  <tr><td style="padding:12px 28px 4px;color:#3C4257;font:400 15px/1.55 Arial,sans-serif;">
    <p style="margin:0 0 14px;">Hi ${firstName},</p>
    <p style="margin:0 0 14px;">Thanks for registering for <strong>${esc(EVENT.name)}</strong>. Your slot is confirmed and we&rsquo;ve saved your details.</p>
    <p style="margin:0 0 18px;">Your Microsoft Teams joining link will be sent to this address closer to the date.</p>
  </td></tr>
  <tr><td style="padding:0 28px;">
    <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;background:#F4F6FB;border-radius:10px;">
      <tr><td style="padding:16px 18px;">
        <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;">
          ${row('Event', EVENT.name)}
          ${row('Date', EVENT.date)}
          ${row('Time', EVENT.time)}
          ${row('Platform', EVENT.platform)}
        </table>
      </td></tr>
    </table>
  </td></tr>
  <tr><td style="padding:20px 28px 8px;">
    <p style="margin:0 0 10px;color:#5B6070;font:600 12px Arial,sans-serif;text-transform:uppercase;letter-spacing:.08em;">Your registration</p>
    <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;">
      ${row('Name', [data.firstName, data.lastName].filter(Boolean).join(' '))}
      ${row('Email', data.email)}
      ${row('Job Title', data.jobTitle)}
      ${row('Organization', data.organization)}
      ${row('Organization Type', orgType)}
      ${row('Country', data.country)}
      ${row('Phone', data.phone)}
    </table>
  </td></tr>
  <tr><td style="padding:18px 28px 28px;color:#9599AC;font:400 12px/1.6 Arial,sans-serif;">
    If any of the above is wrong, just reply to this email and we&rsquo;ll correct it.
  </td></tr>
</table>
</body></html>`;
}

function buildText(data) {
  const firstName = (data.firstName || '').trim() || 'there';
  const lines = [
    `Hi ${firstName},`,
    '',
    `Thanks for registering for ${EVENT.name}. Your slot is confirmed.`,
    'Your Microsoft Teams joining link will be sent to this address closer to the date.',
    '',
    `Event:    ${EVENT.name}`,
    `Date:     ${EVENT.date}`,
    `Time:     ${EVENT.time}`,
    `Platform: ${EVENT.platform}`,
    '',
    'If any of your details are wrong, just reply to this email.',
  ];
  return lines.join('\n');
}

exports.handler = async (event) => {
  let data;

  try {
    const parsed = JSON.parse(event.body || '{}');
    const submission = parsed.payload || {};

    // Ignore submissions from any other form that might be added later.
    if (submission.form_name && submission.form_name !== FORM_NAME) {
      console.log(`Ignoring submission for form "${submission.form_name}"`);
      return { statusCode: 200, body: 'ignored' };
    }

    data = submission.data || {};
  } catch (err) {
    console.error('Could not parse submission payload:', err.message);
    // 200 keeps Netlify from retrying a payload that will never parse.
    return { statusCode: 200, body: 'bad payload' };
  }

  const to = String(data.email || '').trim().toLowerCase();

  if (!isValidEmail(to)) {
    console.error('Submission has no valid email address; skipping confirmation.');
    return { statusCode: 200, body: 'no valid recipient' };
  }

  const apiKey   = process.env.SENDGRID_API_KEY;
  const from     = process.env.EMAIL_FROM;
  const fromName = process.env.EMAIL_FROM_NAME || 'Evvo Labs';
  const replyTo  = process.env.EMAIL_REPLY_TO || from;

  // Report which variable is missing without ever logging its value.
  const missing = [
    ['SENDGRID_API_KEY', apiKey],
    ['EMAIL_FROM', from],
  ].filter(([, value]) => !value).map(([name]) => name);

  if (missing.length) {
    console.error(`Missing environment variable(s): ${missing.join(', ')}`);
    return { statusCode: 500, body: 'not configured' };
  }

  const message = {
    personalizations: [{ to: [{ email: to }] }],
    from:     { email: from, name: fromName },
    reply_to: { email: replyTo },
    subject:  'Registration Confirmed – Resilience by Design Webinar',
    content: [
      { type: 'text/plain', value: buildText(data) },
      { type: 'text/html',  value: buildHtml(data) },
    ],
  };

  try {
    const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(message),
    });

    if (!res.ok) {
      // SendGrid error bodies describe the problem and never echo the API key.
      const detail = await res.text();
      console.error(`SendGrid responded ${res.status}: ${detail}`);
      return { statusCode: 502, body: 'send failed' };
    }

    console.log(`Confirmation email sent to ${to}`);
    return { statusCode: 200, body: 'sent' };
  } catch (err) {
    console.error('SendGrid request failed:', err.message);
    return { statusCode: 502, body: 'send failed' };
  }
};

// backend/services/mailer.js
// Lightweight mail helper that falls back to console logging when SMTP env vars are absent.

const nodemailer = safeRequire('nodemailer');

function safeRequire(mod) {
  try {
    return require(mod);
  } catch (err) {
    return null;
  }
}

const {
  SMTP_HOST,
  SMTP_PORT,
  SMTP_SECURE,
  SMTP_USER,
  SMTP_PASS,
  APP_BASE_URL = 'https://www.phloat.io'
} = process.env;

let transporter = null;
if (nodemailer && SMTP_HOST && SMTP_USER && SMTP_PASS) {
  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT || 587),
    secure: String(SMTP_SECURE || 'false') === 'true',
    auth: {
      user: SMTP_USER,
      pass: SMTP_PASS
    }
  });
}

function renderVerificationEmail({ name, token }) {
  const verifyUrl = `${APP_BASE_URL.replace(/\/$/, '')}/verify-email.html?token=${encodeURIComponent(token)}`;
  return {
    subject: 'Confirm your Phloat.io email',
    html: `
      <div style="font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;">
        <h2>Verify your email</h2>
        <p>Hi ${name || 'there'},</p>
        <p>Welcome to Phloat.io. Please confirm your email address to unlock your AI accountant.</p>
        <p><a href="${verifyUrl}" style="background:#2b59ff;color:#fff;padding:12px 20px;border-radius:6px;text-decoration:none;font-weight:600;">Verify email</a></p>
        <p>If the button doesn't work, copy and paste this link:</p>
        <p><a href="${verifyUrl}">${verifyUrl}</a></p>
        <p style="margin-top:32px;">Thanks,<br/>The Phloat.io team</p>
      </div>
    `,
    text: `Hi ${name || 'there'},\n\nVisit the link below to confirm your Phloat.io account.\n${verifyUrl}\n\nThanks,\nPhloat.io`
  };
}

async function sendEmailVerification({ to, name, token }) {
  if (!token) throw new Error('Verification token missing');
  const { subject, html, text } = renderVerificationEmail({ name, token });

  if (!transporter) {
    console.info('[mailer] SMTP not configured. Verification link:', { to, subject, token });
    return;
  }

  await transporter.sendMail({
    to,
    from: process.env.MAIL_FROM || 'Phloat.io <no-reply@phloat.io>',
    subject,
    html,
    text
  });
}

module.exports = {
  sendEmailVerification
};

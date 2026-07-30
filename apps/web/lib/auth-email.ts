import { createTransport } from "nodemailer";
import type { SendVerificationRequestParams } from "next-auth/providers/email";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export async function sendMagicLink({
  identifier,
  url,
  provider,
}: SendVerificationRequestParams): Promise<void> {
  const transport = createTransport(provider.server);
  const host = new URL(url).host;
  const escapedUrl = escapeHtml(url);
  const escapedHost = escapeHtml(host);
  const result = await transport.sendMail({
    to: identifier,
    from: provider.from,
    subject: `Your Athenvia sign-in link`,
    text: `Sign in to Athenvia on ${host}\n${url}\n\nThis link expires in 15 minutes and can be used once.`,
    html: `
      <div style="background:#fbf8f4;padding:32px;font-family:Arial,sans-serif;color:#33251f">
        <div style="max-width:520px;margin:auto;background:#fff;padding:32px;border-radius:20px">
          <p style="margin:0 0 8px;font-size:14px">Athenvia</p>
          <h1 style="margin:0 0 16px;font:500 30px Georgia,serif">Sign in safely.</h1>
          <p style="line-height:1.6">Use the button below to sign in on ${escapedHost}.</p>
          <p style="margin:28px 0">
            <a href="${escapedUrl}" style="background:#493126;color:#fff;padding:14px 20px;border-radius:999px;text-decoration:none;font-weight:700">
              Sign in to Athenvia
            </a>
          </p>
          <p style="color:#6c5b52;line-height:1.6">This link expires in 15 minutes and works once. If you did not request it, you can ignore this email.</p>
        </div>
      </div>
    `,
  });

  if (result.rejected.length > 0 || result.pending.length > 0) {
    throw new Error("AUTH_EMAIL_DELIVERY_REJECTED");
  }
}

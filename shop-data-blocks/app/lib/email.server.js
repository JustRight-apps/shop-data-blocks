const RESEND_ENDPOINT = "https://api.resend.com/emails";

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function paragraphs(text) {
  return String(text ?? "")
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 1em 0;line-height:1.5">${escapeHtml(p).replaceAll("\n", "<br>")}</p>`)
    .join("");
}

async function sendEmail({ to, subject, html }) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!apiKey || !from) {
    throw new Error("Email not configured: set RESEND_API_KEY and EMAIL_FROM env vars.");
  }
  const response = await fetch(RESEND_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from, to: [to], subject, html }),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Resend error ${response.status}: ${body}`);
  }
  return response.json();
}

export async function sendMerchantAnsweredEmail({
  to,
  customerName,
  productTitle,
  productUrl,
  answer,
  threadUrl,
}) {
  const subject = `Re: your question about ${productTitle}`;
  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#202223">
      <p style="margin:0 0 1em 0">Hi ${escapeHtml(customerName || "there")},</p>
      <p style="margin:0 0 1em 0;line-height:1.5">
        We've answered your question about
        <a href="${escapeHtml(productUrl)}" style="color:#005bd3">${escapeHtml(productTitle)}</a>:
      </p>
      <blockquote style="margin:0 0 1.5em 0;padding:16px;background:#f6f6f7;border-left:3px solid #005bd3;border-radius:4px">
        ${paragraphs(answer)}
      </blockquote>
      ${threadUrl ? `<p style="margin:0 0 1em 0"><a href="${escapeHtml(threadUrl)}" style="color:#005bd3">View the full conversation</a></p>` : ""}
      <p style="margin:1.5em 0 0 0;color:#6d7175;font-size:13px">You're receiving this because you asked a product question.</p>
    </div>
  `;
  return sendEmail({ to, subject, html });
}

export async function sendCustomerMessagedEmail({
  to,
  customerName,
  productTitle,
  productUrl,
  message,
  inboxUrl,
}) {
  const subject = `New question from ${customerName || "a customer"}: ${productTitle}`;
  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#202223">
      <p style="margin:0 0 1em 0;line-height:1.5">
        ${escapeHtml(customerName || "A customer")} sent a message about
        <a href="${escapeHtml(productUrl)}" style="color:#005bd3">${escapeHtml(productTitle)}</a>:
      </p>
      <blockquote style="margin:0 0 1.5em 0;padding:16px;background:#f6f6f7;border-left:3px solid #008060;border-radius:4px">
        ${paragraphs(message)}
      </blockquote>
      ${inboxUrl ? `<p style="margin:0 0 1em 0"><a href="${escapeHtml(inboxUrl)}" style="color:#005bd3">Reply in your inbox</a></p>` : ""}
    </div>
  `;
  return sendEmail({ to, subject, html });
}

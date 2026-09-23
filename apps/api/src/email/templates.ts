// Email content. HTML uses inline styles (the only styling email clients reliably support) in the
// Jetlagged palette; every email also has a plain-text version. Anything a user typed is escaped.

const colors = {
  coral: "#e8856a",
  coralInk: "#c0442a",
  ink: "#4a3728",
  inkSoft: "#7a6555",
  cream: "#fffbf4",
  line: "#f1e6d4",
};

export function esc(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export type EmailContent = { subject: string; html: string; text: string };

// Building blocks: each has an HTML and a text form
type Block = { html: string; text: string };

export const p = (html: string, text = stripTags(html)): Block => ({
  html: `<p style="margin:0 0 16px;font-size:16px;line-height:1.5;color:${colors.ink}">${html}</p>`,
  text,
});

export const button = (label: string, url: string): Block => ({
  html: `<p style="margin:24px 0"><a href="${esc(url)}" style="display:inline-block;background:${colors.coral};color:#fff;font-weight:700;text-decoration:none;padding:12px 22px;border-radius:999px">${esc(label)}</a></p>`,
  text: `${label}: ${url}`,
});

/** A boxed list of label/value rows, e.g. event details. */
export const details = (rows: [string, string][]): Block => ({
  html: `<table role="presentation" style="width:100%;border-collapse:collapse;margin:0 0 20px;background:${colors.cream};border:1px solid ${colors.line};border-radius:12px">${rows
    .map(
      ([k, v]) =>
        `<tr><td style="padding:8px 14px;font-size:13px;color:${colors.inkSoft};white-space:nowrap;vertical-align:top">${esc(k)}</td><td style="padding:8px 14px;font-size:15px;color:${colors.ink};font-weight:600">${esc(v).replace(/\n/g, "<br>")}</td></tr>`,
    )
    .join("")}</table>`,
  text: rows.map(([k, v]) => `${k}: ${v}`).join("\n"),
});

/** A highlighted note, e.g. payment instructions. */
export const note = (title: string, body: string): Block => ({
  html: `<div style="margin:0 0 20px;padding:14px 16px;border-left:4px solid ${colors.coral};background:${colors.cream};border-radius:8px"><p style="margin:0 0 6px;font-size:12px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:${colors.inkSoft}">${esc(title)}</p><p style="margin:0;font-size:15px;line-height:1.5;color:${colors.ink};white-space:pre-line">${esc(body)}</p></div>`,
  text: `${title}:\n${body}`,
});

function stripTags(html: string) {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/** Wrap blocks in the branded layout. `footer` explains who sent the email and why. */
export function layout(subject: string, heading: string, blocks: Block[], footer: string): EmailContent {
  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#faf0dc;font-family:'Segoe UI',Arial,sans-serif">
<table role="presentation" style="width:100%;border-collapse:collapse"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" style="width:100%;max-width:560px;border-collapse:collapse;background:#ffffff;border-radius:20px;overflow:hidden">
<tr><td style="background:linear-gradient(90deg,#e8856a,#f5c842);background-color:#e8856a;padding:18px 28px;color:#fff;font-size:18px;font-weight:800">✈️ Flightplan</td></tr>
<tr><td style="padding:28px">
<h1 style="margin:0 0 18px;font-size:24px;line-height:1.25;color:${colors.ink}">${esc(heading)}</h1>
${blocks.map((b) => b.html).join("\n")}
</td></tr>
<tr><td style="padding:16px 28px;border-top:1px solid ${colors.line};font-size:12px;line-height:1.5;color:${colors.inkSoft}">${esc(footer)}</td></tr>
</table></td></tr></table></body></html>`;
  const text = [heading, "", ...blocks.map((b) => b.text + "\n"), "--", footer].join("\n");
  return { subject, html, text };
}

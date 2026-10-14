import { createHmac, timingSafeEqual } from "crypto";

// Transforma o texto da abordagem (gerado pela IA) em HTML simples. Precisa ser HTML para o
// SES rastrear abertura (pixel) e clique (reescreve os links) — texto puro não é rastreável.

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function linkify(escaped: string): string {
  return escaped.replace(/\bhttps?:\/\/[^\s<]+[^\s<.,;:!?)]/g, (url) => `<a href="${url}">${url}</a>`);
}

export function renderEmail(body: string, unsubscribeUrl: string): { html: string; text: string } {
  const paragraphs = body
    .trim()
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 14px">${linkify(escapeHtml(p)).replace(/\n/g, "<br>")}</p>`)
    .join("");
  const html = `<!doctype html><html><body style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#222;max-width:600px">${paragraphs}<p style="margin:28px 0 0;font-size:12px;color:#888">Não quer mais receber nossos e-mails? <a href="${unsubscribeUrl}" style="color:#888">Descadastrar</a></p></body></html>`;
  const text = `${body.trim()}\n\n--\nPara não receber mais nossos e-mails: ${unsubscribeUrl}`;
  return { html, text };
}

// Token de descadastro: id da mensagem + HMAC, para o link não ser forjável nem enumerável.
function sign(id: string, secret: string): string {
  return createHmac("sha256", secret).update(`unsub:${id}`).digest("base64url").slice(0, 22);
}

export function unsubscribeToken(messageId: string, secret: string): string {
  return `${messageId}.${sign(messageId, secret)}`;
}

export function parseUnsubscribeToken(token: string, secret: string): string | null {
  const [id, sig] = (token ?? "").split(".");
  if (!id || !sig) return null;
  const expected = Buffer.from(sign(id, secret));
  const given = Buffer.from(sig);
  return expected.length === given.length && timingSafeEqual(expected, given) ? id : null;
}

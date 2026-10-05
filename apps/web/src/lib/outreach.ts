// Envio em 1 clique: abre o WhatsApp/Gmail do usuário com a mensagem já preenchida.
// Nada é enviado automaticamente — a pessoa revisa e aperta "enviar" (evita bloqueio do número
// e dispensa a API oficial do WhatsApp/Gmail, que exigem verificação da Meta/Google).

/** Normaliza telefone brasileiro para o formato do wa.me (55 + DDD + número). */
export function toWhatsAppNumber(phone: string | null | undefined): string | null {
  if (!phone) return null;
  let digits = phone.replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("0")) digits = digits.slice(1); // 0 + DDD (discagem interurbana)
  if (digits.length === 10 || digits.length === 11) digits = `55${digits}`;
  return digits.length >= 12 && digits.length <= 13 ? digits : null;
}

export function whatsappUrl(phone: string | null | undefined, text: string): string | null {
  const number = toWhatsAppNumber(phone);
  return number ? `https://wa.me/${number}?text=${encodeURIComponent(text)}` : null;
}

export function gmailComposeUrl(to: string | null | undefined, subject: string, body: string): string {
  const params = new URLSearchParams({ view: "cm", fs: "1", su: subject, body });
  if (to) params.set("to", to);
  return `https://mail.google.com/mail/?${params.toString()}`;
}

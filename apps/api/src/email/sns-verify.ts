import { createVerify } from "crypto";

// Valida a assinatura das mensagens do Amazon SNS. A rota que recebe os eventos do SES é
// pública: sem isso, qualquer um poderia marcar e-mails como abertos ou leads como "respondeu".
// https://docs.aws.amazon.com/sns/latest/dg/sns-verify-signature-of-message.html

export interface SnsMessage {
  Type: "Notification" | "SubscriptionConfirmation" | "UnsubscribeConfirmation";
  MessageId: string;
  TopicArn: string;
  Subject?: string;
  Message: string;
  Timestamp: string;
  SignatureVersion: "1" | "2";
  Signature: string;
  SigningCertURL: string;
  SubscribeURL?: string;
  Token?: string;
}

const CERT_HOST = /^sns\.[a-z0-9-]+\.amazonaws\.com(\.cn)?$/;
const certCache = new Map<string, string>();

function signedString(msg: SnsMessage): string {
  const keys =
    msg.Type === "Notification"
      ? ["Message", "MessageId", "Subject", "Timestamp", "TopicArn", "Type"]
      : ["Message", "MessageId", "SubscribeURL", "Timestamp", "Token", "TopicArn", "Type"];
  return keys
    .filter((k) => msg[k as keyof SnsMessage] !== undefined)
    .map((k) => `${k}\n${msg[k as keyof SnsMessage]}\n`)
    .join("");
}

async function getCert(url: string): Promise<string> {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || !CERT_HOST.test(parsed.hostname) || !parsed.pathname.endsWith(".pem")) {
    throw new Error("SigningCertURL fora da AWS");
  }
  const cached = certCache.get(url);
  if (cached) return cached;
  const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`Certificado SNS indisponível (HTTP ${res.status})`);
  const pem = await res.text();
  certCache.set(url, pem);
  return pem;
}

export async function verifySnsMessage(msg: SnsMessage): Promise<boolean> {
  if (!msg?.Signature || !msg.SigningCertURL || !msg.Type) return false;
  const cert = await getCert(msg.SigningCertURL);
  const verifier = createVerify(msg.SignatureVersion === "2" ? "RSA-SHA256" : "RSA-SHA1");
  verifier.update(signedString(msg), "utf8");
  return verifier.verify(cert, msg.Signature, "base64");
}

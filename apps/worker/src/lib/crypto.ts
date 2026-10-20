// Criptografia via Web Crypto (disponível nativamente no Workers): senha (PBKDF2),
// sessão (JWT HS256), segredos de integração (AES-256-GCM) e assinatura de webhook (HMAC).

const enc = new TextEncoder();
const dec = new TextDecoder();

export function b64(bytes: ArrayBuffer | Uint8Array): string {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (const b of u8) s += String.fromCharCode(b);
  return btoa(s);
}

export function unb64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const b64url = (bytes: ArrayBuffer | Uint8Array) => b64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64url = (s: string) => unb64(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));

export const newId = () => crypto.randomUUID().replace(/-/g, "");

export function randomToken(bytes = 32): string {
  return b64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function hmacSha256Hex(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(body));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ── Senha ──────────────────────────────────────────────────────────────────
// Iterações limitadas pelo orçamento de CPU do plano gratuito do Workers; o número
// fica gravado no hash para poder aumentar no futuro sem invalidar senhas antigas.
const PBKDF2_ITERATIONS = 50_000;

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  return crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256);
}

export async function hashPassword(password: string): Promise<{ hash: string; salt: string }> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const bits = await pbkdf2(password, salt, PBKDF2_ITERATIONS);
  return { hash: `pbkdf2$${PBKDF2_ITERATIONS}$${b64(bits)}`, salt: b64(salt) };
}

export async function verifyPassword(password: string, stored: string, salt: string): Promise<boolean> {
  const [algo, iter, expected] = stored.split("$");
  if (algo !== "pbkdf2" || !expected) return false;
  const bits = b64(await pbkdf2(password, unb64(salt), Number(iter)));
  return timingSafeEqual(bits, expected);
}

function timingSafeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ── JWT (HS256) ────────────────────────────────────────────────────────────
export interface SessionClaims {
  sub: string;
  workspaceId: string;
  email: string;
  exp: number;
}

async function hmacKey(secret: string) {
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export async function signJwt(claims: Omit<SessionClaims, "exp">, secret: string, ttlSeconds = 60 * 60 * 24 * 30) {
  const header = b64url(enc.encode(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const payload = b64url(enc.encode(JSON.stringify({ ...claims, exp: Math.floor(Date.now() / 1000) + ttlSeconds })));
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(secret), enc.encode(`${header}.${payload}`));
  return `${header}.${payload}.${b64url(sig)}`;
}

export async function verifyJwt(token: string, secret: string): Promise<SessionClaims | null> {
  const [header, payload, sig] = token.split(".");
  if (!header || !payload || !sig) return null;
  // Token malformado (base64/JSON inválido) = sessão inválida (401), não erro interno.
  try {
    const ok = await crypto.subtle.verify("HMAC", await hmacKey(secret), unb64url(sig), enc.encode(`${header}.${payload}`));
    if (!ok) return null;
    const claims = JSON.parse(dec.decode(unb64url(payload))) as SessionClaims;
    return claims.exp > Date.now() / 1000 ? claims : null;
  } catch {
    return null;
  }
}

// ── Segredos de integração (AES-256-GCM) ───────────────────────────────────
async function aesKey(keyB64: string) {
  return crypto.subtle.importKey("raw", unb64(keyB64), "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encryptSecret(plain: string, keyB64: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await aesKey(keyB64), enc.encode(plain));
  return `v1:${b64(iv)}:${b64(ct)}`;
}

export async function decryptSecret(value: string, keyB64: string): Promise<string> {
  if (!value.startsWith("v1:")) return value;
  const [, iv, ct] = value.split(":");
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(iv) }, await aesKey(keyB64), unb64(ct));
  return dec.decode(pt);
}

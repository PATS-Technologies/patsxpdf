import "server-only";
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";

const activationHours = Number(process.env.PASSWORD_ACTIVATION_HOURS ?? 24);

export async function createPasswordActivation() {
  const rawCode = randomBytes(8).toString("hex").toUpperCase();
  const code = rawCode.match(/.{1,4}/g)?.join("-") ?? rawCode;
  return {
    code,
    hash: await bcrypt.hash(code, 12),
    expiresAt: new Date(Date.now() + activationHours * 60 * 60 * 1000),
  };
}

export function verifyPasswordActivation(code: string, hash: string) {
  return bcrypt.compare(code.trim().toUpperCase(), hash);
}

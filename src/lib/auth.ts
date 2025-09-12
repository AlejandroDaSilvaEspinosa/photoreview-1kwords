// src/lib/auth.ts
import jwt, { JwtPayload, Secret } from "jsonwebtoken";

export type UserPayload = JwtPayload & { name: string };

export const SESSION_COOKIE_NAME = "session";
export const SESSION_MAX_AGE = 60 * 60 * 8; // 8h

const rawSecret = process.env.JWT_SECRET;
if (!rawSecret) throw new Error("JWT_SECRET no está definido");
const JWT_SECRET: Secret = rawSecret;

export function signToken(payload: UserPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: SESSION_MAX_AGE });
}

export function verifyToken(token: string): UserPayload | null {
  try {
    const dec = jwt.verify(token, JWT_SECRET);
    if (typeof dec === "object" && dec && "name" in dec) {
      return dec as UserPayload;
    }
    return null;
  } catch {
    return null;
  }
}

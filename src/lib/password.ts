import bcrypt from "bcryptjs";
import { bcryptCost } from "./env";

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, bcryptCost());
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

/** A valid bcrypt hash of a random string, compared against when the user does not exist (constant-ish timing). */
export const DUMMY_HASH = "$2b$12$FEC5bX6.G1mroD7OPTsh4u34aDnBHO83lKc4TCm6YCIHG0ysii6Xq";

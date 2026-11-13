import { PrismaClient, Prisma } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

/**
 * Single PrismaClient per process. Uses the Rust-free client with the node-postgres adapter, so there
 * is no native query-engine binary to ship (smaller serverless bundles, faster cold starts).
 */
const globalForPrisma = globalThis as unknown as { __prisma?: PrismaClient };

function createClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set");
  const adapter = new PrismaPg({
    connectionString,
    // Keep the pool small per instance; scale horizontally and put a pooler (e.g. Supabase) in front.
    max: Number(process.env.DB_POOL_MAX ?? 5),
  });
  return new PrismaClient({ adapter });
}

export const db: PrismaClient = globalForPrisma.__prisma ?? createClient();
if (process.env.NODE_ENV !== "production") globalForPrisma.__prisma = db;

export type Tx = Prisma.TransactionClient;
export type DbOrTx = PrismaClient | Prisma.TransactionClient;

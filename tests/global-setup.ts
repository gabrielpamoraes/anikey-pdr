import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { Client } from "pg";

/** Recreates the test database schema from the committed SQL migrations before the suite runs. */
export default async function setup() {
  const url = process.env.TEST_DATABASE_URL ?? "postgresql://postgres@localhost:5433/anikey_test";
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query("DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;");
    const dir = path.resolve(__dirname, "../prisma/migrations");
    const folders = readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
    for (const folder of folders) {
      await client.query(readFileSync(path.join(dir, folder, "migration.sql"), "utf8"));
    }
  } finally {
    await client.end();
  }
}

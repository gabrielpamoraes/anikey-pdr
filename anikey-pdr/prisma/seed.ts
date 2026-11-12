import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { DEFAULT_REMITTANCE, DEFAULT_SERVICE_TYPES, DEFAULT_TERMS_ACCEPTANCE, DEFAULT_TERMS_AUTHORIZATION, DEFAULT_TERMS_INVOICE } from "../src/domain/defaults";

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

async function main() {
  const email = process.env.SEED_ADMIN_EMAIL;
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!email || !password) throw new Error("Set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD");
  if (password.length < 10) throw new Error("SEED_ADMIN_PASSWORD must be at least 10 characters");

  const existing = await db.organization.findFirst();
  const org =
    existing ??
    (await db.organization.create({
      data: {
        name: "ANIKEY LLC",
        email: process.env.SEED_ORG_EMAIL ?? "AnikeyLLC@gmail.com",
        phone: "916-221-8883",
        termsAuthorization: DEFAULT_TERMS_AUTHORIZATION,
        termsAcceptance: DEFAULT_TERMS_ACCEPTANCE,
        termsInvoice: DEFAULT_TERMS_INVOICE,
        remittanceInfo: DEFAULT_REMITTANCE,
        serviceTypes: { create: DEFAULT_SERVICE_TYPES.map((s, i) => ({ ...s, sortOrder: i })) },
      },
    }));

  const users: [string | undefined, string | undefined, string, "ADMIN" | "TECHNICIAN"][] = [
    [email, password, "Administrator", "ADMIN"],
    [process.env.SEED_TECH_EMAIL, process.env.SEED_TECH_PASSWORD, "Technician", "TECHNICIAN"],
  ];
  for (const [e, p, name, role] of users) {
    if (!e || !p) continue;
    const lower = e.trim().toLowerCase();
    if (await db.user.findUnique({ where: { email: lower } })) continue;
    await db.user.create({ data: { orgId: org.id, email: lower, name, role, passwordHash: await bcrypt.hash(p, 12) } });
    console.log(`Created ${role.toLowerCase()} ${lower}`);
  }
  console.log(`Organization: ${org.name}`);
}

main().finally(() => db.$disconnect());

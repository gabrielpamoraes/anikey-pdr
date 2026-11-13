"use server";
import { z } from "zod";
import { db } from "@/lib/db";
import { AppError, assert } from "@/lib/errors";
import { formObject, guard } from "@/lib/flash";
import { currentActor } from "@/lib/session";
import { parseInput } from "@/domain/payloads";
import { auditForUser, recordAudit } from "@/services/audit";
import { createUser } from "@/services/auth";
import { addServiceType, setServiceTypeActive, updateOrgSettings } from "@/services/settings";

export async function saveSettingsAction(form: FormData) {
  await guard("/settings", async () => {
    await updateOrgSettings(await currentActor(), formObject(form));
    return { notice: "Settings saved." };
  });
}

export async function addServiceAction(form: FormData) {
  await guard("/settings", async () => {
    await addServiceType(await currentActor(), formObject(form));
    return { notice: "Service added." };
  });
}

export async function toggleServiceAction(id: string, active: boolean) {
  await guard("/settings", async () => {
    await setServiceTypeActive(await currentActor(), id, active);
  });
}

const userSchema = z.object({
  name: z.string().trim().min(1, "required").max(120),
  email: z.string().trim().toLowerCase().email("enter a valid email address"),
  password: z.string().min(10, "use at least 10 characters").max(200),
  role: z.enum(["ADMIN", "TECHNICIAN"], { errorMap: () => ({ message: "choose a role" }) }),
});

export async function addUserAction(form: FormData) {
  await guard("/settings", async () => {
    const actor = await currentActor();
    assert(actor.role === "ADMIN", "Only an administrator can add users.", "forbidden");
    const input = parseInput(userSchema, formObject(form));
    if (await db.user.findUnique({ where: { email: input.email } })) throw new AppError("A user with that email already exists.", "conflict");
    const user = await createUser({ orgId: actor.orgId, ...input });
    await db.$transaction((tx) => recordAudit(tx, auditForUser(actor, { action: "user.created", entityType: "User", entityId: user.id, metadata: { role: input.role } })));
    return { notice: `${input.name} can now sign in.` };
  });
}

export async function setUserActiveAction(userId: string, active: boolean) {
  await guard("/settings", async () => {
    const actor = await currentActor();
    assert(actor.role === "ADMIN", "Only an administrator can change users.", "forbidden");
    assert(userId !== actor.userId, "You cannot deactivate your own account.", "conflict");
    const target = await db.user.findFirst({ where: { id: userId, orgId: actor.orgId } });
    if (!target) throw new AppError("User not found.", "not_found");
    await db.$transaction(async (tx) => {
      await tx.user.update({ where: { id: userId }, data: { active } });
      await recordAudit(tx, auditForUser(actor, { action: active ? "user.enabled" : "user.disabled", entityType: "User", entityId: userId }));
    });
    return { notice: active ? "User re-enabled." : "User disabled. Their session stops working immediately." };
  });
}

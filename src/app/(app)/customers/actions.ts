"use server";
import { formObject, guard } from "@/lib/flash";
import { currentActor } from "@/lib/session";
import { addContact, createCustomer } from "@/services/customers";

export async function createCustomerAction(form: FormData) {
  await guard("/customers/new", async () => {
    const c = await createCustomer(await currentActor(), formObject(form));
    return { to: `/customers/${c.id}`, notice: "Customer created." };
  });
}

export async function addContactAction(customerId: string, form: FormData) {
  await guard(`/customers/${customerId}`, async () => {
    await addContact(await currentActor(), customerId, formObject(form));
    return { notice: "Contact added." };
  });
}

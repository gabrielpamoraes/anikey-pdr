import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { isoToDateColumn, addDaysISO, todayISO } from "@/lib/dates";
import { currentVersion } from "@/domain/job-status";
import { documentPayloadSchema } from "@/domain/payloads";
import type { Actor, DocType, JobStatus } from "@/domain/types";

/** Read models used by the staff pages. Every query is scoped by orgId. */

export type JobFilter = "ALL" | JobStatus | "OVERDUE";

export interface JobListParams {
  q?: string;
  filter?: JobFilter;
  take?: number;
}

export async function getOrg(orgId: string) {
  const org = await db.organization.findUnique({ where: { id: orgId } });
  if (!org) throw new AppError("Organization not found.", "not_found");
  return org;
}

function jobWhere(orgId: string, timeZone: string, { q, filter }: JobListParams): Prisma.JobWhereInput {
  const where: Prisma.JobWhereInput = { orgId };
  if (filter === "OVERDUE") {
    where.status = "INVOICED";
    where.dueDate = { lt: isoToDateColumn(todayISO(timeZone)) };
  } else if (filter && filter !== "ALL") {
    where.status = filter;
  }
  const term = q?.trim();
  if (term) {
    where.OR = [
      { number: { contains: term, mode: "insensitive" } },
      { referenceNumber: { contains: term, mode: "insensitive" } },
      { customer: { name: { contains: term, mode: "insensitive" } } },
      { vehicle: { vin: { contains: term, mode: "insensitive" } } },
      { vehicle: { licensePlate: { contains: term, mode: "insensitive" } } },
      { vehicle: { model: { contains: term, mode: "insensitive" } } },
      { documents: { some: { number: { contains: term, mode: "insensitive" } } } },
    ];
  }
  return where;
}

export async function listJobs(actor: Actor, params: JobListParams = {}) {
  const org = await getOrg(actor.orgId);
  const jobs = await db.job.findMany({
    where: jobWhere(actor.orgId, org.timezone, params),
    orderBy: { createdAt: "desc" },
    take: params.take ?? 50,
    include: { customer: { select: { name: true } }, vehicle: true },
  });
  return { jobs, timeZone: org.timezone, today: todayISO(org.timezone) };
}

export async function dashboardStats(actor: Actor) {
  const org = await getOrg(actor.orgId);
  const today = todayISO(org.timezone);
  const todayCol = isoToDateColumn(today);
  const [grouped, overdue, dueSoon] = await Promise.all([
    db.job.groupBy({ by: ["status"], where: { orgId: actor.orgId }, _count: { _all: true } }),
    db.job.count({ where: { orgId: actor.orgId, status: "INVOICED", dueDate: { lt: todayCol } } }),
    db.job.count({
      where: { orgId: actor.orgId, status: "INVOICED", dueDate: { gte: todayCol, lte: isoToDateColumn(addDaysISO(today, 3)) } },
    }),
  ]);
  const byStatus = Object.fromEntries(grouped.map((g) => [g.status, g._count._all])) as Partial<Record<JobStatus, number>>;
  const count = (s: JobStatus) => byStatus[s] ?? 0;
  return {
    awaitingSignature: count("AWAITING_AUTHORIZATION") + count("AWAITING_ACCEPTANCE"),
    inProgress: count("IN_PROGRESS"),
    readyToInvoice: count("READY_TO_INVOICE"),
    dueSoon,
    overdue,
  };
}

export async function getJobDetail(actor: Actor, jobId: string) {
  const job = await db.job.findFirst({
    where: { id: jobId, orgId: actor.orgId },
    include: {
      org: true,
      customer: true,
      contact: true,
      vehicle: true,
      technician: { select: { name: true } },
      documents: { include: { versions: { orderBy: { version: "desc" }, include: { signature: true } } } },
      payments: { orderBy: { paidAt: "desc" } },
      photos: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!job) throw new AppError("Job not found.", "not_found");
  const history = await db.auditLog.findMany({ where: { orgId: actor.orgId, jobId }, orderBy: { seq: "desc" }, take: 40 });
  const byType = (type: DocType) => job.documents.find((d) => d.type === type) ?? null;
  const lite = job.documents.flatMap((d) => d.versions.map((v) => ({ type: d.type as DocType, version: v.version, status: v.status })));
  return { job, history, byType, lite, current: (t: DocType) => currentVersion(lite, t) };
}

export async function getDocumentView(actor: Actor, jobId: string, type: DocType, versionNumber?: number) {
  const job = await db.job.findFirst({
    where: { id: jobId, orgId: actor.orgId },
    include: { org: true, customer: true, contact: true, vehicle: true },
  });
  if (!job) throw new AppError("Job not found.", "not_found");
  const document = await db.document.findUnique({
    where: { jobId_type: { jobId, type } },
    include: { versions: { orderBy: { version: "desc" }, include: { signature: true } } },
  });
  if (!document) return { job, document: null, version: null, payload: null, services: [] as { code: string; label: string }[], requests: [] };
  const version = (versionNumber ? document.versions.find((v) => v.version === versionNumber) : undefined) ?? document.versions[0];
  const [services, requests] = await Promise.all([
    db.serviceType.findMany({ where: { orgId: actor.orgId, active: true }, orderBy: [{ sortOrder: "asc" }, { label: "asc" }] }),
    db.signingRequest.findMany({ where: { versionId: version.id }, orderBy: { createdAt: "desc" }, take: 5 }),
  ]);
  return { job, document, version, payload: documentPayloadSchema.parse(version.payload), services, requests };
}

export async function listCustomers(actor: Actor, q?: string) {
  const term = q?.trim();
  return db.customer.findMany({
    where: {
      orgId: actor.orgId,
      ...(term
        ? {
            OR: [
              { name: { contains: term, mode: "insensitive" as const } },
              { email: { contains: term, mode: "insensitive" as const } },
              { contacts: { some: { name: { contains: term, mode: "insensitive" as const } } } },
            ],
          }
        : {}),
    },
    orderBy: { name: "asc" },
    take: 100,
    include: { _count: { select: { jobs: true } } },
  });
}

export async function getCustomer(actor: Actor, customerId: string) {
  const customer = await db.customer.findFirst({
    where: { id: customerId, orgId: actor.orgId },
    include: {
      contacts: { orderBy: { createdAt: "asc" } },
      jobs: { orderBy: { createdAt: "desc" }, take: 25, include: { vehicle: true } },
    },
  });
  if (!customer) throw new AppError("Customer not found.", "not_found");
  return customer;
}

export async function listServiceTypes(orgId: string) {
  return db.serviceType.findMany({ where: { orgId }, orderBy: [{ sortOrder: "asc" }, { label: "asc" }] });
}

export async function listAudit(actor: Actor, take = 200) {
  return db.auditLog.findMany({ where: { orgId: actor.orgId }, orderBy: { seq: "desc" }, take });
}

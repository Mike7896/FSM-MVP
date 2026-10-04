import "server-only";

import { and, asc, eq, ne } from "drizzle-orm";
import { db } from "@/lib/db";
import { changeOrderDetails, changeRequests, customers, documents, drawSchedule, jobs, organizations, shareLinks, scopeNodes, invoiceDetails, documentSends } from "@/lib/db/schema";
import { loadDocument, loadJobDocuments, type Executor } from "@/lib/documents/repository";
import { currentAgreedScope } from "@/lib/documents/operations/agreed-scope";
import { toQuoteRecord } from "@/lib/documents/quote-record";
import { writeScopeTree } from "@/lib/documents/scope-write";
import { scopeTotals } from "@/lib/documents/scope";
import { captureHeader } from "@/lib/documents/header";
import { ensureShareLink } from "@/lib/documents/share-links";
import { DocumentError } from "@/lib/documents/errors";
import { documentHash } from "@/lib/signing/hash";
import { signDocument } from "@/lib/signing/sign";
import { jobMoney } from "@/lib/queries/jobs";
import { heldLink } from "@/lib/share/link";
import type { ChangeOrderSave } from "@/lib/schemas/change-order";
import type { z } from "zod";
import type { changeOrderSendSchema, changeOrderDecisionSchema } from "@/lib/schemas/change-order";
import { changeOrderEmail } from "@/lib/email/change-order-email";
import { enclose } from "@/lib/email/enclosure";
import { letterheadFor } from "@/lib/email/letterhead";
import { emailConfigured, sendEmail } from "@/lib/email/send";
import { withDocumentActivation } from "@/lib/membership/activation";
import { createInvoice } from "@/lib/documents/operations/create-invoice";

export async function readChangeOrder(id: string, organizationId: string, on: Executor = db) {
  const doc = await loadDocument(id, organizationId, on);
  if (!doc || doc.type !== "change_order" || !doc.details) throw new DocumentError("Change order not found.", "not_found");
  const [customer] = doc.customerId ? await on.select({ id: customers.id, name: customers.name }).from(customers).where(eq(customers.id, doc.customerId)) : [];
  // Reuse the editor's tree projection, without creating quote detail rows.
  const record = toQuoteRecord({ ...doc, type: "quote", details: null }, customer ?? null);
  return { doc, record: { ...record, taxRate: doc.details.taxRate }, revision: doc.updatedAt.toISOString(), hash: documentHash(doc) };
}

async function lockJob(on: Executor, jobId: string, organizationId: string) {
  const [job] = await on.select().from(jobs).where(and(eq(jobs.id, jobId), eq(jobs.organizationId, organizationId))).for("update");
  if (!job) throw new DocumentError("Job not found.", "not_found");
  return job;
}

export async function saveChangeOrder(organizationId: string, userId: string | null, input: ChangeOrderSave) {
  return db.transaction(async tx => {
    const parent = await loadDocument(input.parentContractId, organizationId, tx);
    if (!parent || parent.type !== "contract" || parent.status !== "signed") throw new DocumentError("Sign the contract before creating a change order.", "invalid");
    await lockJob(tx, parent.jobId, organizationId);
    if (input.requestId) {
      const [request] = await tx.select().from(changeRequests).where(and(eq(changeRequests.id, input.requestId), eq(changeRequests.contractId, parent.id))).for("update");
      if (!request?.submittedAt) throw new DocumentError("Customer request not found.", "not_found");
      if (request.changeOrderId && request.changeOrderId !== input.id) throw new DocumentError("This request already has a priced change. Open it from the job.");
    }
    const [existing] = await tx.select().from(documents).where(eq(documents.id, input.id)).for("update");
    if (existing) {
      if (existing.organizationId !== organizationId || existing.type !== "change_order" || existing.jobId !== parent.jobId) throw new DocumentError("Change order not found.", "not_found");
      const loaded = await readChangeOrder(input.id, organizationId, tx);
      if (loaded.doc.details!.parentContractId !== parent.id) throw new DocumentError("A change order cannot move to another contract.");
      if (existing.status !== "draft") throw new DocumentError("This change has been sent. Create a new change order to revise it.");
      if (input.revision && input.revision !== loaded.revision) throw new DocumentError("This draft changed in another window. Reload before editing.");
      // A lost response to the first create is safe to retry, but may not overwrite a newer draft.
      if (!input.revision) {
        if (loaded.doc.summary !== input.summary || loaded.doc.title !== input.title || loaded.doc.details!.timeImpactDays !== input.timeImpactDays || loaded.doc.details!.billingMode !== input.billingMode || loaded.doc.scope.length !== input.scope.length || loaded.doc.scope.some((node, i) => node.description !== input.scope[i].description || node.sellPriceCents !== input.scope[i].sellPriceCents || Number(node.quantity) !== input.scope[i].quantity)) throw new DocumentError("This draft already exists. Reload it before editing.");
        return loaded;
      }
    } else {
      // Paid in full, the contract is finished: new work goes on a new quote.
      const [job] = await tx.select({ status: jobs.status }).from(jobs).where(eq(jobs.id, parent.jobId));
      if (job?.status === "paid") throw new DocumentError("This job is paid in full. Quote new work instead of changing this contract.", "invalid");
      await tx.insert(documents).values({ id: input.id, organizationId, jobId: parent.jobId, customerId: parent.customerId, type: "change_order", number: "", status: "draft", createdBy: userId });
      await tx.insert(changeOrderDetails).values({ documentId: input.id, parentContractId: parent.id });
      if (input.requestId) await tx.update(changeRequests).set({ changeOrderId: input.id }).where(eq(changeRequests.id, input.requestId));
    }
    await tx.update(documents).set({ title: input.title, summary: input.summary, updatedAt: new Date() }).where(eq(documents.id, input.id));
    const available = await agreedChangeTargets(parent.id, organizationId, tx);
    const seen = new Set<string>();
    for (const node of input.scope) {
      if (!node.referencesNodeId && !node.referenceKind) continue;
      const target = available.find(n => n.id === node.referencesNodeId);
      if (!target || !node.referenceKind || seen.has(target.id) || node.nodeType !== "item" || node.quantity !== 1 || node.parentIndex !== null) throw new DocumentError("Choose each current scope item once for a removal or allowance settlement.", "invalid");
      seen.add(target.id);
      if (node.referenceKind === "deletes" && node.sellPriceCents !== -target.amountCents) throw new DocumentError("A removed item must credit its current agreed amount.", "invalid");
      if (node.referenceKind === "settles" && (!target.allowance || target.amountCents + node.sellPriceCents < 0)) throw new DocumentError("Select an unsettled allowance and a nonnegative final amount.", "invalid");
    }
    await writeScopeTree(tx, { documentId: input.id, organizationId }, input.scope);
    const doc = await loadDocument(input.id, organizationId, tx);
    const delta = scopeTotals(doc!.scope, input.taxRate).totalCents;
    if (!Number.isSafeInteger(delta) || Math.abs(delta) > 2_000_000_000) throw new DocumentError("The adjustment is too large.", "invalid");
    await tx.update(changeOrderDetails).set({ whatChanged: input.summary, deltaCents: delta, timeImpactDays: input.timeImpactDays, taxRate: input.taxRate === null ? null : String(input.taxRate), billingMode: input.billingMode }).where(eq(changeOrderDetails.documentId, input.id));
    return readChangeOrder(input.id, organizationId, tx);
  });
}

/** Sending a change order activates its job on the Free plan — once (Billing §3.1). */
export async function sendChangeOrder(organizationId: string, id: string, input: z.infer<typeof changeOrderSendSchema>, attribution: { ip: string | null; userAgent: string | null; signerEmail?: string }) {
  return withDocumentActivation({ organizationId, documentId: id, action: "change_order_sent" }, () => sendChangeOrderNow(organizationId, id, input, attribution));
}

async function sendChangeOrderNow(organizationId: string, id: string, input: z.infer<typeof changeOrderSendSchema>, attribution: { ip: string | null; userAgent: string | null; signerEmail?: string }) {
  const result = await db.transaction(async tx => {
    const initial = await readChangeOrder(id, organizationId, tx);
    const job = await lockJob(tx, initial.doc.jobId, organizationId);
    await tx.select({ id: documents.id }).from(documents).where(eq(documents.id, id)).for("update");
    const { doc, revision } = await readChangeOrder(id, organizationId, tx);
    if (job.isDemo) throw new DocumentError("Practice jobs cannot send binding change orders.", "invalid");
    if (doc.status === "sent") return { ...await ensureShareLink(doc, ["view", "sign"], tx), number: doc.number };
    if (doc.status !== "draft" || input.revision !== revision) throw new DocumentError("Reload this change before sending it.");
    if (!doc.summary?.trim()) throw new DocumentError("Describe what is changing before sending.", "invalid");
    const parent = await loadDocument(doc.details!.parentContractId, organizationId, tx);
    if (!parent || parent.type !== "contract" || parent.status !== "signed") throw new DocumentError("The parent contract must be signed.");
    const money = (await jobMoney([doc.jobId], tx)).get(doc.jobId)!;
    await checkDeduction(money, doc.details!.deltaCents);
    const [final] = await tx.select({ id: documents.id }).from(documents).innerJoin(invoiceDetails, eq(invoiceDetails.documentId, documents.id)).where(and(eq(documents.jobId, doc.jobId), eq(invoiceDetails.invoiceType, "final_balance"), ne(documents.status, "void"), ne(documents.status, "draft")));
    if (final && doc.details!.billingMode !== "supplemental" && doc.details!.deltaCents > 0) throw new DocumentError("The final invoice is already issued. Bill added work with a supplemental invoice.", "invalid");
    if (doc.details!.billingMode === "supplemental" && doc.details!.deltaCents <= 0) throw new DocumentError("Use the remaining balance for a deduction or schedule-only change.", "invalid");
    await tx.update(changeOrderDetails).set({ baseAmountCents: money.totalCents }).where(eq(changeOrderDetails.documentId, id));
    await tx.update(documents).set({ header: await captureHeader({ organizationId, jobId: doc.jobId, customerId: doc.customerId, licenseId: parent.details?.licenseId ?? null }, tx) }).where(eq(documents.id, id));
    await signDocument({ documentId: id, organizationId, party: "contractor", printedName: input.printedName, mark: { kind: "typed" }, consented: input.consented, authMethod: "account", ...attribution, on: tx });
    await tx.update(documents).set({ status: "sent", sentAt: new Date(), updatedAt: new Date() }).where(eq(documents.id, id));
    return { ...await ensureShareLink(doc, ["view", "sign"], tx), number: doc.number };
  });
  let deliveryError: string | null = null;
  if (input.email) {
    // Same as the quote and the contract: the business's letterhead and name,
    // and a reply goes to the business — never to our sending address.
    if (!emailConfigured()) {
      deliveryError = "The change is saved and ready to share, but email isn't set up on this server. Copy the link instead.";
    } else {
      try {
        const sent = await loadDocument(id, organizationId);
        const [office] = await db.select({ email: organizations.email }).from(organizations).where(eq(organizations.id, organizationId)).limit(1);
        const [customer] = sent?.customerId ? await db.select({ name: customers.name }).from(customers).where(eq(customers.id, sent.customerId)).limit(1) : [];
        const letterhead = await letterheadFor(organizationId, sent?.header);
        const enclosure = await enclose(id, organizationId, letterhead);
        const email = await changeOrderEmail({
          letterhead,
          paper: enclosure.paper,
          attached: Boolean(enclosure.pdf),
          customerName: customer?.name ?? null,
          number: result.number,
          title: sent?.title ?? null,
          deltaCents: sent?.details && "deltaCents" in sent.details ? Number(sent.details.deltaCents) : 0,
          timeImpactDays: sent?.details && "timeImpactDays" in sent.details ? (sent.details.timeImpactDays as number | null) : null,
          url: result.url,
        });
        await sendEmail({
          to: input.email,
          subject: email.subject,
          html: email.html,
          text: email.text,
          replyTo: office?.email ?? attribution.signerEmail ?? null,
          fromName: letterhead.name,
          attachments: enclosure.pdf ? [enclosure.pdf] : [],
        });
      } catch (error) {
        console.error("[change-order] email failed", error);
        deliveryError = "The change is saved and ready to share, but email failed. Copy the link or retry.";
      }
    }
  }
  // The send, as a fact of its own — what the change order's page reads to
  // say "emailed to …" rather than only "sent". An email that didn't go is a
  // link to copy, and recorded as one.
  const emailed = Boolean(input.email) && deliveryError === null;
  await db.insert(documentSends).values({
    organizationId,
    documentId: id,
    channel: emailed ? "email" : "link",
    recipient: emailed ? input.email! : null,
  }).catch((error) => console.error("[change-order] couldn't record the send", error));
  return { ...result, deliveryError };
}

function checkDeduction(money: { totalCents: number; billedCents: number; collectedCents: number }, delta: number) {
  if (money.totalCents + delta < Math.max(0, money.billedCents, money.collectedCents)) throw new DocumentError("This deduction would reduce the agreement below money already billed or paid. Resolve the existing invoices or payments before approving it.", "invalid");
}

export async function decideChangeOrder(token: string, input: z.infer<typeof changeOrderDecisionSchema>, attribution: { ip: string | null; userAgent: string | null }) {
  const link = await heldLink(token, "change_order", "sign");
  return db.transaction(async tx => {
    await lockJob(tx, link.jobId, link.organizationId);
    const [live] = await tx.select().from(shareLinks).where(eq(shareLinks.token, token)).for("update");
    if (!live || live.revokedAt || (live.expiresAt && live.expiresAt <= new Date()) || !live.scopes.includes("sign")) throw new DocumentError("This link is no longer available.", "not_found");
    await tx.select({ id: documents.id }).from(documents).where(eq(documents.id, link.documentId)).for("update");
    const { doc, hash } = await readChangeOrder(link.documentId, link.organizationId, tx);
    if (hash !== input.hash) throw new DocumentError("This change has been updated. Reload and review it before responding.");
    const targetStatus = input.decision === "approve" ? "approved" : "declined";
    if (doc.status === targetStatus) return { status: doc.status };
    if (doc.status !== "sent") throw new DocumentError("This change has already been answered.");
    if (input.decision === "decline") {
      await tx.update(documents).set({ status: "declined", updatedAt: new Date() }).where(eq(documents.id, doc.id));
      return { status: "declined" };
    }
    if (!doc.signatures.some(s => s.party === "contractor")) throw new DocumentError("The contractor must sign first.");
    if (!input.consented || !input.printedName.trim()) throw new DocumentError("Enter your name and agree to sign electronically before approving.", "invalid");
    const money = (await jobMoney([doc.jobId], tx)).get(doc.jobId)!;
    await checkDeduction(money, doc.details!.deltaCents);
    const targets = await agreedChangeTargets(doc.details!.parentContractId, link.organizationId, tx);
    const [finalInvoice] = await tx.select({ id: documents.id }).from(documents).innerJoin(invoiceDetails, eq(invoiceDetails.documentId, documents.id)).where(and(eq(documents.jobId, doc.jobId), eq(invoiceDetails.invoiceType, "final_balance"), ne(documents.status, "void"), ne(documents.status, "draft")));
    if (finalInvoice && doc.details!.billingMode !== "supplemental" && doc.details!.deltaCents > 0) throw new DocumentError("The final invoice was issued after this change was prepared. Ask the contractor for a revised change with separate billing.");
    for (const node of doc.scope.filter(n => n.referencesNodeId)) {
      const target = targets.find(n => n.id === node.referencesNodeId);
      if (!target || (node.referenceKind === "settles" && !target.allowance)) throw new DocumentError("Another approved change already changed this scope item. Ask the contractor for a revised change.");
      if (node.referenceKind === "deletes" && node.sellPriceCents !== -target.amountCents) throw new DocumentError("The agreed value of this item changed. Ask the contractor for a revised change.");
      if (node.referenceKind === "settles") await tx.update(scopeNodes).set({ allowanceSettledCents: target.amountCents + node.sellPriceCents, allowanceSettledAt: new Date() }).where(eq(scopeNodes.id, target.id));
    }
    // Another approval may have changed the running total, but this signed adjustment stays fixed.
    await signDocument({ documentId: doc.id, organizationId: link.organizationId, party: "customer", printedName: input.printedName, mark: { kind: "typed" }, consented: input.consented, authMethod: "share_link", signerEmail: doc.header.customerEmail ?? null, ...attribution, on: tx });
    await tx.update(changeOrderDetails).set({ approvedAt: new Date() }).where(eq(changeOrderDetails.documentId, doc.id));
    await tx.update(documents).set({ status: "approved", updatedAt: new Date() }).where(eq(documents.id, doc.id));
    if (doc.details!.billingMode === "next_draw") {
      const phases = await tx.select().from(drawSchedule).where(eq(drawSchedule.jobId, doc.jobId)).orderBy(asc(drawSchedule.position)).for("update");
      const pending = phases.filter(p => !p.invoiceId);
      let remaining = doc.details!.deltaCents;
      for (const phase of pending) {
        if (remaining === 0) break;
        const adjustment = remaining > 0 ? remaining : Math.max(remaining, -phase.amountCents);
        await tx.update(drawSchedule).set({ amountCents: phase.amountCents + adjustment, updatedAt: new Date() }).where(eq(drawSchedule.id, phase.id));
        remaining -= adjustment;
      }
      // With no future draw, the approved delta is picked up by the final balance.
    }
    return { status: "approved" };
  });
}

export async function agreedChangeTargets(contractId: string, organizationId: string, on: Executor = db) {
  const contract = await loadDocument(contractId, organizationId, on);
  if (!contract || contract.type !== "contract") throw new DocumentError("Contract not found.", "not_found");
  const docs = await loadJobDocuments(contract.jobId, organizationId, { on, type: "change_order" });
  const changes = docs.filter(d => d.type === "change_order" && d.details?.parentContractId === contract.id);
  const agreed = currentAgreedScope(contract, changes.filter(d => d.type === "change_order"));
  const byId = new Map(agreed.nodes.map(node => [node.id, node]));
  function isOptional(node: (typeof agreed.nodes)[number]): boolean {
    if (node.optional) return true;
    const parent = node.parentNodeId ? byId.get(node.parentNodeId) : undefined;
    return parent ? isOptional(parent) : false;
  }
  return agreed.nodes.filter(n => ["item", "allowance"].includes(n.nodeType) && !isOptional(n)).map(n => ({ id: n.id, description: n.description, amountCents: n.settledCents ?? n.allowanceSettledCents ?? Math.round(Number(n.quantity) * n.sellPriceCents), section: n.section, taxable: n.taxable, allowance: n.nodeType === "allowance" && n.allowanceSettledAt === null }));
}

export async function invoiceChangeOrder(organizationId: string, id: string) {
  return db.transaction(async tx => {
    const { doc } = await readChangeOrder(id, organizationId, tx);
    await lockJob(tx, doc.jobId, organizationId);
    if (doc.status !== "approved" || doc.details!.billingMode !== "supplemental" || doc.details!.deltaCents <= 0) throw new DocumentError("Only approved extra work marked for separate billing can be invoiced here.");
    const [existing] = await tx.select({ id: documents.id }).from(documents).where(and(eq(documents.sourceDocumentId, id), eq(documents.type, "invoice"), ne(documents.status, "void")));
    if (existing) return existing;
    return createInvoice({ organizationId, on: tx, input: { jobId: doc.jobId, sourceChangeOrderId: id, type: "draw", amountDueCents: doc.details!.deltaCents, covers: `${doc.number}: ${doc.summary ?? "Approved change"}`.slice(0, 2000), issue: false } });
  });
}

export async function deleteChangeOrder(organizationId: string, id: string) {
  return db.transaction(async tx => {
    const initial = await readChangeOrder(id, organizationId, tx);
    await lockJob(tx, initial.doc.jobId, organizationId);
    const [doc] = await tx.select().from(documents).where(eq(documents.id, id)).for("update");
    if (doc.status !== "draft") throw new DocumentError("Only an unsent draft can be deleted.");
    await tx.delete(documents).where(eq(documents.id, id));
    return { deleted: true };
  });
}

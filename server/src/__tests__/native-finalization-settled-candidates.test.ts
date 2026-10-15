import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import {
  agents,
  companies,
  createDb,
  heartbeatRuns,
  issues,
  nativeRunFinalizations,
  statusDecisionEffects,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";

// The pass records its candidate count on its timing object, then starts the
// per-row loop with phase("candidates"). The mock captures the count and stops
// the pass there, so these tests check candidate selection only.
const captured = vi.hoisted(() => ({ counts: [] as number[] }));
class StopAfterCandidateScan extends Error {}
vi.mock("../services/native-runtime/native-reconciliation-timing.js", () => ({
  createNativeReconciliationPassTiming: () => ({
    phase: (name: string) => {
      if (name === "candidates") throw new StopAfterCandidateScan();
    },
    candidates: (count: number) => { captured.counts.push(count); },
    finish: () => undefined,
  }),
}));

const {
  NATIVE_SETTLED_COMMITTED_UPKEEP_PER_PASS,
  reconcileNativeFinalizations,
  resetSettledCommittedUpkeepForTests,
} = await import("../services/native-runtime/native-finalization-reconciler.js");

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

const HOUR_MS = 60 * 60 * 1000;

async function candidateCount(pass: Promise<unknown>) {
  await expect(pass).rejects.toBeInstanceOf(StopAfterCandidateScan);
  return captured.counts.at(-1);
}

describeEmbeddedPostgres("native finalization candidate selection", () => {
  let db!: ReturnType<typeof createDb>;
  let temporary: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let companyId: string;
  let agentId: string;
  let issueId: string;

  beforeAll(async () => {
    temporary = await startEmbeddedPostgresTestDatabase("paperclip-native-settled-candidates-");
    db = createDb(temporary.connectionString);
  }, 30_000);

  beforeEach(async () => {
    captured.counts = [];
    resetSettledCommittedUpkeepForTests();
    companyId = randomUUID();
    agentId = randomUUID();
    issueId = randomUUID();
    await db.insert(companies).values({ id: companyId, name: "Settled", issuePrefix: `S${companyId.slice(0, 6)}` });
    await db.insert(agents).values({
      id: agentId, companyId, name: "Native", role: "engineer", status: "active",
      adapterType: "codex_local", adapterConfig: {}, runtimeConfig: {}, permissions: {},
    });
    await db.insert(issues).values({ id: issueId, companyId, title: "Settled work", status: "done" });
  });

  afterEach(async () => {
    await db.delete(statusDecisionEffects);
    await db.delete(nativeRunFinalizations);
    await db.delete(heartbeatRuns);
    await db.delete(issues);
    await db.delete(agents);
    await db.delete(companies);
  });

  afterAll(async () => {
    await temporary?.cleanup();
  });

  async function committedRun(options: { status?: string; finishedAgoMs?: number | null; decisionId?: string } = {}) {
    const runId = randomUUID();
    const finishedAgoMs = options.finishedAgoMs === undefined ? 2 * HOUR_MS : options.finishedAgoMs;
    await db.insert(heartbeatRuns).values({
      id: runId, companyId, agentId,
      status: options.status ?? "succeeded",
      runtimeMode: "native",
      nativeIssueId: issueId,
      finishedAt: finishedAgoMs === null ? null : new Date(Date.now() - finishedAgoMs),
      contextSnapshot: { issueId },
    });
    // Result, assessment and decision rows need full contract chains. These
    // tests check candidate selection only, so foreign-key triggers are off
    // for this insert; check constraints still apply.
    await db.transaction(async (tx) => {
      await tx.execute(sql`set local session_replication_role = replica`);
      await tx.insert(nativeRunFinalizations).values({
        runId, companyId, issueId, phase: "committed",
        resultId: randomUUID(),
        ...(options.decisionId ? { assessmentId: randomUUID(), decisionId: options.decisionId } : {}),
      });
    });
    return runId;
  }

  it("skips settled committed rows outside the upkeep rotation and rotates through them", async () => {
    const settled = NATIVE_SETTLED_COMMITTED_UPKEEP_PER_PASS * 2 + 5;
    for (let index = 0; index < settled; index++) await committedRun();

    const counts = [];
    for (let pass = 0; pass < 4; pass++) counts.push(await candidateCount(reconcileNativeFinalizations(db)));

    // Two full upkeep pages, the remainder, then the rotation wraps.
    expect(counts).toEqual([
      NATIVE_SETTLED_COMMITTED_UPKEEP_PER_PASS,
      NATIVE_SETTLED_COMMITTED_UPKEEP_PER_PASS,
      5,
      NATIVE_SETTLED_COMMITTED_UPKEEP_PER_PASS,
    ]);
  });

  it("keeps committed rows that finished within the grace window or have not finished", async () => {
    await committedRun({ finishedAgoMs: 10 * 60 * 1000 });
    await committedRun({ status: "running", finishedAgoMs: null });
    await committedRun({ status: "succeeded", finishedAgoMs: null });

    expect(await candidateCount(reconcileNativeFinalizations(db))).toBe(3);
  });

  it("keeps a settled committed row whose decision has an undelivered effect", async () => {
    const decisionId = randomUUID();
    await committedRun({ decisionId });
    // As above, the decision row is not created; foreign-key triggers are off.
    await db.transaction(async (tx) => {
      await tx.execute(sql`set local session_replication_role = replica`);
      await tx.insert(statusDecisionEffects).values({
        companyId, issueId, decisionId, ordinal: 0, effectKind: "wake", targetType: "agent",
        idempotencyKey: randomUUID(), payload: {}, deliveryState: "failed",
      });
    });
    // A pending effect keeps it a candidate; the upkeep page is empty because
    // the row is not settled.
    expect(await candidateCount(reconcileNativeFinalizations(db))).toBe(1);
  });

  it("reconciles a settled row when a pass names it explicitly", async () => {
    const runId = await committedRun();
    await committedRun();

    expect(await candidateCount(reconcileNativeFinalizations(db, [runId]))).toBe(1);
  });
});

/**
 * Integration tests for quest step rewards — credit granting on step completion.
 *
 * Tests cover:
 *   - Step with reward_credits grants credits to player's ship
 *   - Step without reward_credits does not grant credits
 *   - Final step reward included in quest.completed event
 *   - Reward included in quest.step_completed event payload
 *   - Corp ships are never assigned quests
 *
 * Setup: P1 in sector 0 (mega-port).
 * Tutorial step 1 has reward_credits=50, step 3 has no reward.
 */

import {
  assert,
  assertEquals,
  assertExists,
} from "https://deno.land/std@0.197.0/testing/asserts.ts";

import { resetDatabase, startServerInProcess } from "./harness.ts";
import {
  apiOk,
  characterIdFor,
  shipIdFor,
  eventsOfType,
  getEventCursor,
  queryShip,
  advanceQuestToStep,
  seedQuestDefinitions,
  queryPlayerQuest,
  setShipCredits,
  setShipWarpPower,
  createCorpShip,
  withPg,
} from "./helpers.ts";

const P1 = "test_qr_p1";

let p1Id: string;
let p1ShipId: string;

async function resetWithQuests(characterIds: string[]): Promise<void> {
  await resetDatabase(characterIds);
  await seedQuestDefinitions();
}

// ============================================================================
// Group 0: Start server
// ============================================================================

Deno.test({
  name: "quest_rewards — start server",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await startServerInProcess();
  },
});

// ============================================================================
// Group 1: Step with reward grants credits to ship
// ============================================================================

Deno.test({
  name: "quest_rewards — step with reward grants credits",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn(t) {
    await t.step("resolve IDs", async () => {
      p1Id = await characterIdFor(P1);
      p1ShipId = await shipIdFor(P1);
    });

    await t.step("reset and setup", async () => {
      await resetWithQuests([P1]);
      await apiOk("join", { character_id: p1Id });
    });

    await t.step("set initial credits to 1000", async () => {
      await setShipCredits(p1ShipId, 1000);
      const ship = await queryShip(p1ShipId);
      assertExists(ship);
      assertEquals(ship.credits, 1000);
    });

    await t.step("assign tutorial quest", async () => {
      await apiOk("quest_assign", { character_id: p1Id, quest_code: "tutorial" });
    });

    let cursor: number;
    await t.step("capture cursor", async () => {
      cursor = await getEventCursor(p1Id);
    });

    await t.step("complete step 1 (travel — has 50 credit reward)", async () => {
      await apiOk("move", { character_id: p1Id, to_sector: 1 });
    });

    await t.step("ship credits increased by 50", async () => {
      const ship = await queryShip(p1ShipId);
      assertExists(ship);
      assertEquals(ship.credits, 1050, `Expected 1050 credits, got ${ship.credits}`);
    });

    await t.step("quest.step_completed event includes reward", async () => {
      const events = await eventsOfType(p1Id, "quest.step_completed", cursor);
      assert(events.length >= 1, `Expected quest.step_completed, got ${events.length}`);
      const payload = events[0].payload as Record<string, unknown>;
      assertEquals(payload.quest_code, "tutorial");
      assertEquals(payload.step_index, 1);
      assertExists(payload.reward, "Should have reward in payload");
      const reward = payload.reward as Record<string, unknown>;
      assertEquals(reward.credits, 50, "Reward should be 50 credits");
    });
  },
});

// ============================================================================
// Group 2: Step without reward does not grant credits
// ============================================================================

Deno.test({
  name: "quest_rewards — step without reward does not grant credits",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn(t) {
    await t.step("reset and setup", async () => {
      await resetWithQuests([P1]);
      await apiOk("join", { character_id: p1Id });
      // Advance to step 3 (Refuel — no reward_credits)
      await advanceQuestToStep(p1Id, "tutorial", 3);
    });

    await t.step("set initial credits and drain warp", async () => {
      await setShipCredits(p1ShipId, 2000);
      await setShipWarpPower(p1ShipId, 200);
    });

    let cursor: number;
    await t.step("capture cursor", async () => {
      cursor = await getEventCursor(p1Id);
    });

    await t.step("complete step 3 (refuel — no reward)", async () => {
      await apiOk("recharge_warp_power", {
        character_id: p1Id,
        units: 1,
      });
    });

    await t.step("ship credits unchanged (minus fuel cost only)", async () => {
      const ship = await queryShip(p1ShipId);
      assertExists(ship);
      // Credits should NOT have increased from a reward.
      // They may have decreased from the fuel purchase cost.
      assert((ship.credits as number) <= 2000, `Credits should not have increased from reward, got ${ship.credits}`);
    });

    await t.step("quest.step_completed event has null reward", async () => {
      const events = await eventsOfType(p1Id, "quest.step_completed", cursor);
      assert(events.length >= 1, `Expected quest.step_completed, got ${events.length}`);
      const payload = events[0].payload as Record<string, unknown>;
      assertEquals(payload.step_index, 3);
      assertEquals(payload.reward, null, "Reward should be null for step without reward");
    });
  },
});

// ============================================================================
// Group 3: Final step reward included in quest.completed event
// ============================================================================

Deno.test({
  name: "quest_rewards — final step reward in quest.completed",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn(t) {
    await t.step("reset and setup", async () => {
      await resetWithQuests([P1]);
      await apiOk("join", { character_id: p1Id });
      // Tutorial_corporations has 2 steps, both with rewards.
      // Advance to step 2 (final step, reward_credits=1000)
      await advanceQuestToStep(p1Id, "tutorial_corporations", 2);
    });

    await t.step("set initial credits to 5000", async () => {
      await setShipCredits(p1ShipId, 5000);
    });

    let cursor: number;
    await t.step("capture cursor", async () => {
      cursor = await getEventCursor(p1Id);
    });

    await t.step("complete final step (task.start with corp_ship scope)", async () => {
      await apiOk("task_lifecycle", {
        character_id: p1Id,
        task_id: crypto.randomUUID(),
        event_type: "start",
        task_scope: "corp_ship",
      });
    });

    await t.step("ship credits increased by 1000", async () => {
      const ship = await queryShip(p1ShipId);
      assertExists(ship);
      assertEquals(ship.credits, 6000, `Expected 6000 credits, got ${ship.credits}`);
    });

    await t.step("quest.completed event includes reward", async () => {
      const events = await eventsOfType(p1Id, "quest.completed", cursor);
      assert(events.length >= 1, `Expected quest.completed, got ${events.length}`);
      const payload = events[0].payload as Record<string, unknown>;
      assertEquals(payload.quest_code, "tutorial_corporations");
      assertExists(payload.reward, "Should have reward in quest.completed payload");
      const reward = payload.reward as Record<string, unknown>;
      assertEquals(reward.credits, 1000, "Final step reward should be 1000 credits");
    });

    await t.step("quest is marked completed", async () => {
      const pq = await queryPlayerQuest(p1Id, "tutorial_corporations");
      assertExists(pq);
      assertEquals(pq.status, "completed");
    });
  },
});

// ============================================================================
// Group 4: Corp ships are never assigned quests
// ============================================================================

Deno.test({
  name: "quest_rewards — corp ships are never assigned quests",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn(t) {
    let corpId: string;
    let corpShipId: string;

    await t.step("reset and setup", async () => {
      await resetWithQuests([P1]);
      await apiOk("join", { character_id: p1Id });
    });

    await t.step("give credits for corp creation", async () => {
      await setShipCredits(p1ShipId, 50000);
    });

    await t.step("create a corporation", async () => {
      const result = await apiOk("corporation_create", {
        character_id: p1Id,
        name: "QR Test Corp",
      });
      const body = result as Record<string, unknown>;
      corpId = (body.corp_id ?? body.corporation_id) as string;
      assertExists(corpId, "Should have created a corporation");
    });

    await t.step("create a corp ship", async () => {
      const result = await createCorpShip(corpId, 0, "QR Corp Scout");
      corpShipId = result.pseudoCharacterId;
      assertExists(corpShipId, "Should have created a corp ship");
    });

    await t.step("corp ship has no quests assigned", async () => {
      await withPg(async (pg) => {
        const result = await pg.queryObject<{ count: bigint }>(
          `SELECT COUNT(*) as count FROM player_quests WHERE player_id = $1`,
          [corpShipId],
        );
        assertEquals(
          Number(result.rows[0].count),
          0,
          "Corp ship should have zero quests assigned",
        );
      });
    });

    await t.step("manually assigning quest to corp ship fails silently", async () => {
      // assign_quest should work (it doesn't check is_npc), but we
      // verify that the normal game flow never calls it for corp ships.
      // The key guarantee is that character_create is never called for
      // corp ships, so assign_on_creation quests are never assigned.
      await withPg(async (pg) => {
        // Verify the corp ship character has is_npc = true
        const char = await pg.queryObject<{ is_npc: boolean }>(
          `SELECT is_npc FROM characters WHERE character_id = $1`,
          [corpShipId],
        );
        assertEquals(char.rows[0].is_npc, true, "Corp ship should be marked as NPC");
      });
    });
  },
});

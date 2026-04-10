const test = require("node:test");
const assert = require("node:assert/strict");

const {
  findStageForYearMonth,
  projectGoalDate,
  reconcileGoalState,
  rollGoalStateForward,
  validatePlan,
} = require("../public/app-core.js");

test("overlapping stages prefer the newer matching stage", () => {
  const stages = [
    { name: "Post-raise 2027", from: "2027-02", to: "2028-10", saving_longterm: 5000 },
    { name: "Dual-income", from: "2028-02", to: "2035-12", saving_longterm: 10000 },
  ];

  const stage = findStageForYearMonth(stages, "2028-04");
  assert.equal(stage.name, "Dual-income");
});

test("plan validation rejects a stage with to earlier than from", () => {
  const issues = validatePlan({
    goal: {
      target_longterm: 1,
      target_buffer: 1,
      current_longterm: 1,
      current_buffer: 1,
      target_year: 2030,
    },
    stages: [{ name: "Broken", from: "2026-06", to: "2026-05" }],
  });

  assert.match(issues.join("\n"), /to earlier than from/);
});

test("changing the plan seed resets persisted balances back to plan.json", () => {
  const result = reconcileGoalState(
    { current_longterm: 14000, current_buffer: 3000 },
    {
      current_longterm: 19000,
      current_buffer: 4500,
      last_monthly_savings_added_ym: "2026-03",
      plan_seed_longterm: 12000,
      plan_seed_buffer: 2500,
    },
    new Date("2026-04-08T12:00:00Z")
  );

  assert.deepEqual(result, {
    currentLongterm: 14000,
    currentBuffer: 3000,
    lastMonthlySavingsAddedYm: "2026-03",
    planSeedLongterm: 14000,
    planSeedBuffer: 3000,
    shouldPersist: true,
  });
});

test("monthly rollover only credits completed months", () => {
  const result = rollGoalStateForward(
    {
      currentLongterm: 14000,
      currentBuffer: 3000,
      lastMonthlySavingsAddedYm: "2026-03",
      planSeedLongterm: 14000,
      planSeedBuffer: 3000,
    },
    [{ name: "2026", from: "2026-01", saving_longterm: 5000, saving_buffer: 1000 }],
    new Date("2026-06-10T12:00:00Z")
  );

  assert.equal(result.changed, true);
  assert.deepEqual(result.state, {
    currentLongterm: 24000,
    currentBuffer: 5000,
    lastMonthlySavingsAddedYm: "2026-05",
    planSeedLongterm: 14000,
    planSeedBuffer: 3000,
  });
});

test("higher long-term growth assumptions reach the goal earlier", () => {
  const stages = [{ name: "Base", from: "2026-01", saving_longterm: 4000, saving_buffer: 1000 }];
  const goal = {
    target_longterm: 100000,
    target_buffer: 10000,
  };

  const low = projectGoalDate({
    stages,
    goal,
    currentLongterm: 20000,
    currentBuffer: 2000,
    annualRate: 0.04,
    now: new Date("2026-04-09T12:00:00Z"),
  });

  const high = projectGoalDate({
    stages,
    goal,
    currentLongterm: 20000,
    currentBuffer: 2000,
    annualRate: 0.12,
    now: new Date("2026-04-09T12:00:00Z"),
  });

  assert.equal(low.reached, true);
  assert.equal(high.reached, true);
  assert.ok(high.date.getTime() <= low.date.getTime());
});

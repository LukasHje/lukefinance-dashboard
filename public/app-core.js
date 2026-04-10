(function (root, factory) {
  const api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.DashboardCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const safeNumber = (value) => (typeof value === "number" ? value : null);

  const getCurrentYearMonth = (date = new Date()) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    return `${year}-${month}`;
  };

  const getPreviousYearMonth = (date = new Date()) =>
    getCurrentYearMonth(new Date(date.getFullYear(), date.getMonth() - 1, 1, 0, 0, 0, 0));

  const addMonths = (date, months) => {
    const next = new Date(date);
    next.setMonth(next.getMonth() + months);
    return next;
  };

  const isValidYearMonth = (value) => {
    if (typeof value !== "string") return false;
    const match = value.match(/^(\d{4})-(\d{2})$/);
    if (!match) return false;
    const month = Number(match[2]);
    return month >= 1 && month <= 12;
  };

  const validatePlan = (plan) => {
    const issues = [];

    if (!plan || !Array.isArray(plan.stages) || plan.stages.length === 0) {
      issues.push("Plan must include a non-empty stages array.");
      return issues;
    }

    plan.stages.forEach((stage, index) => {
      if (!stage || typeof stage.name !== "string" || stage.name.trim() === "") {
        issues.push(`Stage ${index + 1} is missing a name.`);
      }

      if (!isValidYearMonth(stage?.from)) {
        issues.push(`Stage ${index + 1} must include a valid from (YYYY-MM).`);
      }

      if (stage?.to && !isValidYearMonth(stage.to)) {
        issues.push(`Stage ${index + 1} has an invalid to (YYYY-MM).`);
      }

      if (isValidYearMonth(stage?.from) && isValidYearMonth(stage?.to) && stage.to < stage.from) {
        issues.push(`Stage ${index + 1} has to earlier than from.`);
      }
    });

    if (plan.goal) {
      const required = [
        "target_longterm",
        "target_buffer",
        "current_longterm",
        "current_buffer",
        "target_year",
      ];

      required.forEach((key) => {
        if (!Object.prototype.hasOwnProperty.call(plan.goal, key)) {
          issues.push(`Goal must include ${key}.`);
        }
      });
    }

    return issues;
  };

  const findStageForYearMonth = (stages, ym) => {
    if (!Array.isArray(stages) || stages.length === 0) return null;

    const candidates = stages.filter((stage) => {
      if (!stage?.from) return false;
      const startsOk = stage.from <= ym;
      const endsOk = stage.to ? ym <= stage.to : true;
      return startsOk && endsOk;
    });

    if (candidates.length > 0) {
      candidates.sort((a, b) => b.from.localeCompare(a.from));
      return candidates[0];
    }

    const prior = stages
      .filter((stage) => stage?.from && stage.from <= ym)
      .sort((a, b) => b.from.localeCompare(a.from));
    if (prior.length > 0) return prior[0];

    const earliest = [...stages].sort((a, b) => a.from.localeCompare(b.from));
    return earliest[0] || null;
  };

  const createSeedState = (planGoal, now) => {
    const seedLong = safeNumber(planGoal?.current_longterm) ?? 0;
    const seedBuffer = safeNumber(planGoal?.current_buffer) ?? 0;

    return {
      currentLongterm: seedLong,
      currentBuffer: seedBuffer,
      // The balances in plan.json are treated as "current right now", so the latest
      // fully completed savings month is the previous month, not the current one.
      lastMonthlySavingsAddedYm: getPreviousYearMonth(now),
      planSeedLongterm: seedLong,
      planSeedBuffer: seedBuffer,
    };
  };

  const reconcileGoalState = (planGoal, storedState, now = new Date()) => {
    const seedState = createSeedState(planGoal, now);
    const storedLong = safeNumber(storedState?.current_longterm);
    const storedBuffer = safeNumber(storedState?.current_buffer);
    const storedLastAddedYm = isValidYearMonth(storedState?.last_monthly_savings_added_ym)
      ? storedState.last_monthly_savings_added_ym
      : null;
    const storedSeedLong = safeNumber(storedState?.plan_seed_longterm);
    const storedSeedBuffer = safeNumber(storedState?.plan_seed_buffer);

    const planChanged =
      storedSeedLong !== seedState.planSeedLongterm || storedSeedBuffer !== seedState.planSeedBuffer;

    const missingSnapshot =
      typeof storedLong !== "number" ||
      typeof storedBuffer !== "number" ||
      typeof storedLastAddedYm !== "string";

    if (planChanged || missingSnapshot) {
      return {
        ...seedState,
        shouldPersist: true,
      };
    }

    return {
      currentLongterm: storedLong,
      currentBuffer: storedBuffer,
      lastMonthlySavingsAddedYm: storedLastAddedYm,
      planSeedLongterm: seedState.planSeedLongterm,
      planSeedBuffer: seedState.planSeedBuffer,
      shouldPersist: false,
    };
  };

  const rollGoalStateForward = (state, stages, now = new Date()) => {
    const nextState = {
      currentLongterm: safeNumber(state?.currentLongterm) ?? 0,
      currentBuffer: safeNumber(state?.currentBuffer) ?? 0,
      lastMonthlySavingsAddedYm:
        isValidYearMonth(state?.lastMonthlySavingsAddedYm) ? state.lastMonthlySavingsAddedYm : null,
      planSeedLongterm: safeNumber(state?.planSeedLongterm) ?? 0,
      planSeedBuffer: safeNumber(state?.planSeedBuffer) ?? 0,
    };

    const targetYm = getPreviousYearMonth(now);

    if (!nextState.lastMonthlySavingsAddedYm) {
      nextState.lastMonthlySavingsAddedYm = targetYm;
      return { state: nextState, changed: false };
    }

    if (targetYm <= nextState.lastMonthlySavingsAddedYm) {
      return { state: nextState, changed: false };
    }

    let cursor = addMonths(
      new Date(`${nextState.lastMonthlySavingsAddedYm}-01T00:00:00`),
      1
    );
    let changed = false;

    while (getCurrentYearMonth(cursor) <= targetYm) {
      const ym = getCurrentYearMonth(cursor);
      const stage = findStageForYearMonth(stages, ym);
      const addLong = safeNumber(stage?.saving_longterm);
      const addBuffer = safeNumber(stage?.saving_buffer);

      if (typeof addLong === "number") {
        nextState.currentLongterm += addLong;
        changed = true;
      }

      if (typeof addBuffer === "number") {
        nextState.currentBuffer += addBuffer;
        changed = true;
      }

      nextState.lastMonthlySavingsAddedYm = ym;
      cursor = addMonths(cursor, 1);
    }

    return { state: nextState, changed };
  };

  const projectGoalDate = ({
    stages,
    goal,
    currentLongterm,
    currentBuffer,
    annualRate = 0.08,
    now = new Date(),
  }) => {
    const targetLT = safeNumber(goal?.target_longterm);
    const targetBuf = safeNumber(goal?.target_buffer);
    const seedLong = safeNumber(currentLongterm);
    const seedBuf = safeNumber(currentBuffer);

    if (typeof targetLT !== "number" || targetLT <= 0) return { reached: false };
    if (typeof targetBuf !== "number" || targetBuf < 0) return { reached: false };
    if (typeof seedLong !== "number" || typeof seedBuf !== "number") return { reached: false };
    if (typeof annualRate !== "number" || annualRate < 0) return { reached: false };

    let longTermBalance = seedLong;
    let bufferBalance = seedBuf;

    if (longTermBalance >= targetLT && bufferBalance >= targetBuf) {
      return { reached: true, date: now };
    }

    const monthlyRate = Math.pow(1 + annualRate, 1 / 12) - 1;
    let cursor = new Date(now.getFullYear(), now.getMonth() + 1, 1, 0, 0, 0, 0);

    // At the first instant of a new month we credit the month that just finished.
    for (let i = 0; i < 600; i += 1) {
      const ym = getPreviousYearMonth(cursor);
      const stage = findStageForYearMonth(stages, ym);

      longTermBalance *= 1 + monthlyRate;

      const addLong = safeNumber(stage?.saving_longterm);
      const addBuf = safeNumber(stage?.saving_buffer);

      if (typeof addLong === "number") longTermBalance += addLong;
      if (typeof addBuf === "number") bufferBalance += addBuf;

      if (longTermBalance >= targetLT && bufferBalance >= targetBuf) {
        return { reached: true, date: cursor };
      }

      cursor = addMonths(cursor, 1);
    }

    return { reached: false };
  };

  const projectBufferDate = ({ stages, goal, currentBuffer, now = new Date() }) => {
    const targetBuf = safeNumber(goal?.target_buffer);
    const seedBuf = safeNumber(currentBuffer);

    if (typeof targetBuf !== "number" || targetBuf <= 0) return { reached: false };
    if (typeof seedBuf !== "number") return { reached: false };

    let bufferBalance = seedBuf;

    if (bufferBalance >= targetBuf) {
      return { reached: true, date: now };
    }

    let cursor = new Date(now.getFullYear(), now.getMonth() + 1, 1, 0, 0, 0, 0);

    for (let i = 0; i < 600; i += 1) {
      const ym = getPreviousYearMonth(cursor);
      const stage = findStageForYearMonth(stages, ym);
      const addBuf = safeNumber(stage?.saving_buffer);

      if (typeof addBuf === "number") bufferBalance += addBuf;

      if (bufferBalance >= targetBuf) {
        return { reached: true, date: cursor };
      }

      cursor = addMonths(cursor, 1);
    }

    return { reached: false };
  };

  return {
    addMonths,
    findStageForYearMonth,
    getCurrentYearMonth,
    getPreviousYearMonth,
    isValidYearMonth,
    projectBufferDate,
    projectGoalDate,
    reconcileGoalState,
    rollGoalStateForward,
    safeNumber,
    validatePlan,
  };
});

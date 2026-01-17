const app = document.getElementById("app");

/* =========================
   Formatting helpers
   ========================= */
const SEK = (n) =>
  typeof n === "number"
    ? n.toLocaleString("sv-SE", { maximumFractionDigits: 0 })
    : "N/A";

const renderStatus = (message, isError = false) => {
  if (!app) return;
  app.textContent = message;
  app.style.color = isError ? "#fb7185" : "#eef2ff";
};

const safeNumber = (v) => (typeof v === "number" ? v : null);
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

/* =========================
   Date helpers
   ========================= */
const getCurrentYearMonth = (d = new Date()) => {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
};

const parseYearMonth = (ym) => {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m - 1, 1, 0, 0, 0, 0);
};

const addMonths = (date, months) => {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
};

const formatCountdown = (ms) => {
  if (ms <= 0) return "0d 00:00:00";
  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const mins = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;
  return `${days}d ${String(hours).padStart(2, "0")}:${String(mins).padStart(
    2,
    "0"
  )}:${String(secs).padStart(2, "0")}`;
};

/* =========================
   Plan validation
   ========================= */
const isValidYearMonth = (value) => {
  if (typeof value !== "string") return false;
  const m = value.match(/^(\d{4})-(\d{2})$/);
  if (!m) return false;
  const month = Number(m[2]);
  return month >= 1 && month <= 12;
};

const validatePlan = (plan) => {
  const issues = [];

  if (!plan || !Array.isArray(plan.stages) || plan.stages.length === 0) {
    issues.push("Plan must include a non-empty stages array.");
    return issues;
  }

  plan.stages.forEach((stage, i) => {
    if (!stage || typeof stage.name !== "string" || stage.name.trim() === "") {
      issues.push(`Stage ${i + 1} is missing a name.`);
    }
    if (!isValidYearMonth(stage?.from)) {
      issues.push(`Stage ${i + 1} must include a valid from (YYYY-MM).`);
    }
    if (stage?.to && !isValidYearMonth(stage.to)) {
      issues.push(`Stage ${i + 1} has an invalid to (YYYY-MM).`);
    }
  });

  if (plan.goal) {
    const g = plan.goal;
    const required = [
      "target_longterm",
      "target_buffer",
      "current_longterm",
      "current_buffer",
      "target_year",
    ];
    required.forEach((k) => {
      if (!Object.prototype.hasOwnProperty.call(g, k)) {
        issues.push(`Goal must include ${k}.`);
      }
    });
  }

  return issues;
};

/* =========================
   Stage selection (handles gaps)
   ========================= */
const findStageForYearMonth = (stages, ym) => {
  if (!Array.isArray(stages) || stages.length === 0) return null;

  // 1) Exact match: from <= ym <= to/open
  const candidates = stages.filter((s) => {
    if (!s?.from) return false;
    const startsOk = s.from <= ym;
    const endsOk = s.to ? ym <= s.to : true;
    return startsOk && endsOk;
  });

  if (candidates.length) {
    candidates.sort((a, b) => b.from.localeCompare(a.from));
    return candidates[0];
  }

  // 2) Gap fallback: most recent stage that started before ym
  const prior = stages
    .filter((s) => s?.from && s.from <= ym)
    .sort((a, b) => b.from.localeCompare(a.from));
  if (prior.length) return prior[0];

  // 3) ym is before all stages: pick earliest
  const earliest = [...stages].sort((a, b) => a.from.localeCompare(b.from));
  return earliest[0] || null;
};

/* =========================
   Computation for month view
   ========================= */
const computeViewModel = (stage) => {
  const incomePreTax = safeNumber(stage?.income);
  const netIncome = safeNumber(stage?.net_income);

  const fixedCosts = safeNumber(stage?.fixed_costs);
  const household = safeNumber(stage?.household);

  const savingsLong = safeNumber(stage?.saving_longterm);
  const savingsBuffer = safeNumber(stage?.saving_buffer);

  const savingsTotal =
    typeof savingsLong === "number" && typeof savingsBuffer === "number"
      ? savingsLong + savingsBuffer
      : null;

  const totalOut =
    typeof fixedCosts === "number" && typeof household === "number"
      ? fixedCosts + household
      : null;

  const leftover =
    typeof netIncome === "number" &&
    typeof totalOut === "number" &&
    typeof savingsTotal === "number"
      ? netIncome - totalOut - savingsTotal
      : null;

  const tax =
    typeof incomePreTax === "number" && typeof netIncome === "number"
      ? incomePreTax - netIncome
      : null;

  return {
    stageName: stage?.name || "Unknown stage",
    incomePreTax,
    netIncome,
    tax,
    fixedCosts,
    household,
    totalOut,
    savingsLong,
    savingsBuffer,
    savingsTotal,
    leftover,
  };
};

/* =========================
   DOM helpers
   ========================= */
const createCard = ({ title, value, details = "", variant = "", extra = "" }) => {
  const card = document.createElement("article");
  card.className = `card ${variant}`.trim();

  const heading = document.createElement("h2");
  heading.className = "card-title";
  heading.textContent = title;

  const valueEl = document.createElement("p");
  valueEl.className = "card-value";
  valueEl.textContent = value;

  card.appendChild(heading);
  card.appendChild(valueEl);

  if (details) {
    const d = document.createElement("p");
    d.className = "card-details";
    d.textContent = details;
    card.appendChild(d);
  }

  if (extra) {
    const e = document.createElement("div");
    e.innerHTML = extra;
    card.appendChild(e);
  }

  return card;
};

const createFooter = () => {
  const footer = document.createElement("footer");
  footer.className = "app-footer";
  footer.textContent = `Last loaded: ${new Date().toLocaleString("sv-SE")}`;
  return footer;
};

const renderValidationErrors = (issues) => {
  if (!app) return;
  app.innerHTML = "";

  const panel = document.createElement("section");
  panel.className = "card";
  panel.innerHTML = `
    <h2 class="card-title">Plan validation errors</h2>
    <p class="card-details">${issues.map((i) => `• ${i}`).join("<br>")}</p>
  `;

  app.appendChild(panel);
  app.appendChild(createFooter());
};

/* =========================
   Goal state (persisted via local API when available)
   ========================= */
const goalState = {
  currentLongterm: 0,
  currentBuffer: 0,
  lastRolloverYm: null,
};

let stateWarning = "";

const loadState = async () => {
  try {
    const res = await fetch("/api/state", { cache: "no-store" });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || Object.keys(data).length === 0) return null;
    return data;
  } catch {
    return null;
  }
};

const saveState = async () => {
  const payload = {
    current_longterm: goalState.currentLongterm,
    current_buffer: goalState.currentBuffer,
    last_rollover_ym: goalState.lastRolloverYm,
  };

  try {
    const res = await fetch("/api/state", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      stateWarning = "State not saved (server offline)";
      return false;
    }
    await res.json().catch(() => null);
    stateWarning = "";
    return true;
  } catch {
    stateWarning = "State not saved (server offline)";
    return false;
  }
};

const initGoalState = (plan) => {
  const seedLong = safeNumber(plan?.goal?.current_longterm);
  const seedBuf = safeNumber(plan?.goal?.current_buffer);

  goalState.currentLongterm = typeof seedLong === "number" ? seedLong : 0;
  goalState.currentBuffer = typeof seedBuf === "number" ? seedBuf : 0;

  // Avoid adding savings immediately on first run
  goalState.lastRolloverYm = getCurrentYearMonth(new Date());
};

const applyMonthlyRolloverIfNeeded = (stages) => {
  const now = new Date();
  const currentYm = getCurrentYearMonth(now);

  if (!goalState.lastRolloverYm) {
    goalState.lastRolloverYm = currentYm;
    return false;
  }

  if (currentYm <= goalState.lastRolloverYm) return false;

  let changed = false;

  let cursor = parseYearMonth(goalState.lastRolloverYm);
  cursor = addMonths(cursor, 1);

  while (getCurrentYearMonth(cursor) <= currentYm) {
    const ym = getCurrentYearMonth(cursor);
    const stage = findStageForYearMonth(stages, ym);

    const addLong = safeNumber(stage?.saving_longterm);
    const addBuf = safeNumber(stage?.saving_buffer);

    if (typeof addLong === "number") {
      goalState.currentLongterm += addLong;
      changed = true;
    }
    if (typeof addBuf === "number") {
      goalState.currentBuffer += addBuf;
      changed = true;
    }

    goalState.lastRolloverYm = ym;
    cursor = addMonths(cursor, 1);
  }

  return changed;
};

/* =========================
   Goal projection (8% annual growth on longterm ONLY)
   Target reached when BOTH:
   - longterm >= target_longterm
   - buffer >= target_buffer
   Deposits happen at month start (YYYY-MM-01 00:00)
   ========================= */
const projectGoalDate = (stages, goal) => {
  const targetLT = safeNumber(goal?.target_longterm);
  const targetBuf = safeNumber(goal?.target_buffer);

  const seedLong = safeNumber(goalState.currentLongterm);
  const seedBuf = safeNumber(goalState.currentBuffer);

  if (typeof targetLT !== "number" || targetLT <= 0) return { reached: false };
  if (typeof targetBuf !== "number" || targetBuf < 0) return { reached: false };
  if (typeof seedLong !== "number" || typeof seedBuf !== "number") return { reached: false };

  let longTermBalance = seedLong;
  let bufferBalance = seedBuf;

  if (longTermBalance >= targetLT && bufferBalance >= targetBuf) {
    return { reached: true, date: new Date() };
  }

  const annualRate = 0.08;
  const monthlyRate = Math.pow(1 + annualRate, 1 / 12) - 1;

  const now = new Date();
  let cursor = new Date(now.getFullYear(), now.getMonth() + 1, 1, 0, 0, 0, 0);

  for (let i = 0; i < 600; i++) {
    const ym = getCurrentYearMonth(cursor);
    const stage = findStageForYearMonth(stages, ym);

    const addLong = safeNumber(stage?.saving_longterm);
    const addBuf = safeNumber(stage?.saving_buffer);

    if (typeof addLong === "number") longTermBalance += addLong;
    if (typeof addBuf === "number") bufferBalance += addBuf;

    longTermBalance *= 1 + monthlyRate;

    if (longTermBalance >= targetLT && bufferBalance >= targetBuf) {
      return { reached: true, date: cursor };
    }

    cursor = addMonths(cursor, 1);
  }

  return { reached: false };
};

/* =========================
   Hero with TWO bars:
   - LT: thick, yellow gradient (inline style)
   - Buffer: thin, blue
   Meta: LT % main, buffer % secondary
   ========================= */
let liveCountdownUpdater = null;

const createGoalHero = (goal, stages) => {
  const hero = document.createElement("section");
  hero.className = "hero";

  const targetLT = safeNumber(goal?.target_longterm);
  const targetBuf = safeNumber(goal?.target_buffer);
  const targetYear = goal?.target_year ?? null;

  const lt = goalState.currentLongterm ?? 0;
  const buf = goalState.currentBuffer ?? 0;

  const pctLT =
    typeof targetLT === "number" && targetLT > 0 ? clamp((lt / targetLT) * 100, 0, 100) : 0;
  const pctBuf =
    typeof targetBuf === "number" && targetBuf > 0 ? clamp((buf / targetBuf) * 100, 0, 100) : 0;

  // Title row
  const row = document.createElement("div");
  row.className = "hero-title-row";

  const title = document.createElement("div");
  title.className = "hero-title";
  title.textContent = "Goal progress";

  const meta = document.createElement("div");
  meta.className = "hero-meta";

  if (typeof targetLT === "number" && typeof targetBuf === "number") {
    meta.textContent =
      `LT: ${pctLT.toFixed(1)}%` +
      `  •  Buf: ${pctBuf.toFixed(1)}%` +
      (targetYear ? `  •  ${targetYear}` : "");
  } else {
    meta.textContent =
      "Add goal.target_longterm/target_buffer + current_longterm/current_buffer in plan.json";
  }

  row.appendChild(title);
  row.appendChild(meta);

  // Bar container
  const bars = document.createElement("div");
  bars.style.display = "grid";
  bars.style.gap = "10px";

  // LT bar (thick, yellow gradient)
  const barLT = document.createElement("div");
  barLT.className = "hero-bar";
  barLT.style.height = "28px";

  const fillLT = document.createElement("div");
  fillLT.className = "hero-fill";
  fillLT.style.width = `${pctLT}%`;
  fillLT.style.background =
    "linear-gradient(90deg, rgba(250,204,21,.95), rgba(251,191,36,.95), rgba(253,224,71,.95))";

  const labelLT = document.createElement("div");
  labelLT.className = "hero-label";
  labelLT.textContent = `Long-term: ${SEK(lt)} / ${SEK(targetLT)}  •  ${pctLT.toFixed(1)}%`;

  barLT.appendChild(fillLT);
  barLT.appendChild(labelLT);

  // Buffer bar (thin, blue)
  const barBuf = document.createElement("div");
  barBuf.className = "hero-bar";
  barBuf.style.height = "16px";
  barBuf.style.opacity = "0.95";

  const fillBuf = document.createElement("div");
  fillBuf.className = "hero-fill";
  fillBuf.style.width = `${pctBuf}%`;
  fillBuf.style.background =
    "linear-gradient(90deg, rgba(125,211,252,.92), rgba(167,139,250,.92))";

  const labelBuf = document.createElement("div");
  labelBuf.className = "hero-label";
  labelBuf.style.fontSize = "11px";
  labelBuf.textContent = `Buffer: ${SEK(buf)} / ${SEK(targetBuf)}  •  ${pctBuf.toFixed(1)}%`;

  barBuf.appendChild(fillBuf);
  barBuf.appendChild(labelBuf);

  bars.appendChild(barLT);
  bars.appendChild(barBuf);

  // Countdown line
  const countdown = document.createElement("div");
  countdown.className = "hero-countdown";

  const projection = projectGoalDate(stages, goal);
  if (projection.reached && projection.date) {
    const goalTime = projection.date.getTime();

    const updateCountdown = () => {
      const ms = goalTime - Date.now();
      countdown.textContent = `Estimated goal date: ${projection.date.toLocaleDateString(
        "sv-SE"
      )}  •  Countdown: ${formatCountdown(ms)}`;
    };

    updateCountdown();
    hero._updateCountdown = updateCountdown;
  } else {
    countdown.textContent =
      "Goal date can't be estimated (missing target values, or savings are zero).";
    hero._updateCountdown = null;
  }

  hero.appendChild(row);
  hero.appendChild(bars);
  hero.appendChild(countdown);

  return hero;
};

/* =========================
   Render
   ========================= */
const renderDashboard = ({ yearMonth, stage, warning, goal, stages }) => {
  if (!app) return;

  app.innerHTML = "";
  const vm = computeViewModel(stage);

  // Top header
  const header = document.createElement("header");
  header.className = "top";

  const ym = document.createElement("div");
  ym.className = "ym";
  ym.innerHTML = `
    <div class="ym-title">${yearMonth}</div>
    <div class="ym-sub">${vm.stageName}</div>
  `;
  header.appendChild(ym);

  const right = document.createElement("div");
  right.className = "top-right";
  if (warning) {
    const w = document.createElement("div");
    w.className = "warning-pill";
    w.textContent = warning;
    right.appendChild(w);
  }
  header.appendChild(right);

  // Hero
  const hero = createGoalHero(goal, stages);
  liveCountdownUpdater = hero._updateCountdown || null;

  // Main grid
  const grid = document.createElement("section");
  grid.className = "card-grid";

  // Net income (prominent) with pretax + tax details
  const incomeDetails = `Pre-tax: ${SEK(vm.incomePreTax)} • Tax: ${SEK(vm.tax)}`;
  grid.appendChild(
    createCard({
      title: "Net income",
      value: SEK(vm.netIncome),
      details: incomeDetails,
    })
  );

  // Money out
  grid.appendChild(
    createCard({
      title: "Money out",
      value: SEK(vm.totalOut),
      details: `Fixed: ${SEK(vm.fixedCosts)} • Household: ${SEK(vm.household)}`,
    })
  );

  // Savings
  grid.appendChild(
    createCard({
      title: "Savings",
      value: SEK(vm.savingsTotal),
      details: `Long-term: ${SEK(vm.savingsLong)} • Buffer: ${SEK(vm.savingsBuffer)}`,
    })
  );

  // Left in pocket (+/=/- based on 3000 threshold)
  const leftover = vm.leftover;
  let variant = "";

  if (typeof leftover === "number") {
    if (leftover >= 3000) {
      variant = "variant-good";
    } else if (leftover >= 0) {
      variant = "variant-warn";
    } else {
      variant = "variant-bad";
    }
  }

  grid.appendChild(
    createCard({
      title: "Left in pocket",
      value: SEK(leftover),
      details: "After out + savings",
      variant,
    })
  );

  app.appendChild(header);
  app.appendChild(hero);
  app.appendChild(grid);
  app.appendChild(createFooter());
};

/* =========================
   Fetch plan.json
   ========================= */
const tryFetchPlan = async () => {
  const urls = ["./plan.json", "plan.json", "/plan.json"];
  for (const url of urls) {
    const res = await fetch(url, { cache: "no-store" }).catch(() => null);
    if (res && res.ok) return res;
  }
  throw new Error("Could not find plan.json (tried ./plan.json, plan.json, /plan.json)");
};

let cachedPlan = null;

const loadPlan = async () => {
  try {
    const response = await tryFetchPlan();
    const plan = await response.json();
    cachedPlan = plan;

    const issues = validatePlan(plan);
    if (issues.length) {
      renderValidationErrors(issues);
      return;
    }

    const stages = Array.isArray(plan.stages) ? plan.stages : [];

    const storedState = await loadState();
    const storedLong = safeNumber(storedState?.current_longterm);
    const storedBuf = safeNumber(storedState?.current_buffer);
    const storedYm = storedState?.last_rollover_ym;

    if (typeof storedLong === "number" && typeof storedBuf === "number") {
      goalState.currentLongterm = storedLong;
      goalState.currentBuffer = storedBuf;
      goalState.lastRolloverYm = isValidYearMonth(storedYm)
        ? storedYm
        : getCurrentYearMonth(new Date());
    } else {
      initGoalState(plan);
      await saveState();
    }

    // Apply rollover if we crossed into new months while tab stayed open
    const rolloverChanged = applyMonthlyRolloverIfNeeded(stages);
    if (rolloverChanged) {
      await saveState();
    }

    const yearMonth = getCurrentYearMonth(new Date());
    const stage = findStageForYearMonth(stages, yearMonth);

    renderDashboard({
      yearMonth,
      stage,
      warning: stateWarning,
      goal: plan.goal || {},
      stages,
    });

    // Live ticking: countdown each second
    setInterval(() => {
      if (liveCountdownUpdater) liveCountdownUpdater();
    }, 1000);

    // Check rollover every minute; only re-render if state changed
    setInterval(() => {
      if (!cachedPlan) return;
      const stages2 = Array.isArray(cachedPlan.stages) ? cachedPlan.stages : [];
      const changed = applyMonthlyRolloverIfNeeded(stages2);
      if (!changed) return;

      saveState().finally(() => {
        const ym = getCurrentYearMonth(new Date());
        const st = findStageForYearMonth(stages2, ym);

        renderDashboard({
          yearMonth: ym,
          stage: st,
          warning: stateWarning,
          goal: cachedPlan.goal || {},
          stages: stages2,
        });
      });
    }, 60_000);
  } catch (err) {
    renderStatus(`Error loading plan: ${err.message}`, true);
  }
};

renderStatus("Loading...");
loadPlan();

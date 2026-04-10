const app = document.getElementById("app");

/* =========================
   Formatting helpers
   ========================= */
const SEK = (n) =>
  typeof n === "number"
    ? n.toLocaleString("sv-SE", { maximumFractionDigits: 0 })
    : "N/A";

const formatAmount = (value, mode = "monthly") => {
  if (typeof value !== "number") return "N/A";
  const factor = mode === "yearly" ? 12 : 1;
  return SEK(value * factor);
};

const renderStatus = (message, isError = false) => {
  if (!app) return;
  app.textContent = message;
  app.style.color = isError ? "#fb7185" : "#eef2ff";
};

const core = globalThis.DashboardCore;
if (!core) {
  renderStatus("Error loading shared dashboard logic.", true);
  throw new Error("DashboardCore failed to load.");
}

const {
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
} = core;

const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

const formatClockTime = (date) =>
  new Intl.DateTimeFormat("sv-SE", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);

const formatCountdown = (ms) => {
  if (ms <= 0) return "0mo 00d 00:00";
  const totalSeconds = Math.floor(ms / 1000);
  const totalDays = Math.floor(totalSeconds / 86400);
  const months = Math.floor(totalDays / 30);
  const days = totalDays % 30;
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const mins = Math.floor((totalSeconds % 3600) / 60);
  return `${months}mo ${String(days).padStart(2, "0")}d ${String(hours).padStart(
    2,
    "0"
  )}:${String(mins).padStart(2, "0")}`;
};

const formatSavingsAppliedStatus = (lastAppliedYm) =>
  `Savings added when month closes. Last completed month applied: ${lastAppliedYm || "N/A"}`;

const getLatestStageEndInfo = (stages) => {
  if (!Array.isArray(stages) || stages.length === 0) return null;

  const latestTo = stages
    .map((stage) => stage?.to)
    .filter((value) => isValidYearMonth(value))
    .sort((a, b) => b.localeCompare(a))[0];

  if (!latestTo) return null;

  const [year, month] = latestTo.split("-").map(Number);
  const endDate = new Date(year, month, 0, 23, 59, 59, 999);

  return {
    yearMonth: latestTo,
    endDate,
  };
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

const createFooter = ({ lastAppliedYm = null } = {}) => {
  const footer = document.createElement("footer");
  footer.className = "app-footer";

  const loaded = document.createElement("span");
  loaded.className = "app-footer-chip";
  loaded.textContent = `Last loaded ${formatClockTime(new Date())}`;
  footer.appendChild(loaded);

  if (lastAppliedYm) {
    const applied = document.createElement("span");
    applied.className = "app-footer-chip";
    applied.textContent = formatSavingsAppliedStatus(lastAppliedYm);
    footer.appendChild(applied);
  }

  return footer;
};

const getNextStage = (stages, currentYm) => {
  if (!Array.isArray(stages)) return null;
  const upcoming = stages
    .filter((s) => s?.from && s.from > currentYm)
    .sort((a, b) => a.from.localeCompare(b.from));
  return upcoming[0] || null;
};

const createAssumptionsNote = () => {
  const note = document.createElement("div");
  note.className = "assumptions-note";
  note.textContent = "Assumptions: Long-term grows at 8% annually (monthly compounding).";
  return note;
};

const createStageTimeline = (stages, currentYm) => {
  const wrapper = document.createElement("section");
  wrapper.className = "timeline";

  const label = document.createElement("div");
  label.className = "timeline-label";
  label.textContent = "Stages";
  wrapper.appendChild(label);

  const rail = document.createElement("div");
  rail.className = "timeline-rail";

  const ordered = Array.isArray(stages)
    ? [...stages].sort((a, b) => (a?.from || "").localeCompare(b?.from || ""))
    : [];

  const currentIndex = ordered.findIndex(
    (stage) => stage?.from && stage.from <= currentYm && (!stage.to || currentYm <= stage.to)
  );

  if (ordered.length === 0) {
    wrapper.appendChild(rail);
    return wrapper;
  }

  let startIndex = 0;
  if (currentIndex > 0) {
    startIndex = currentIndex - 1;
  }
  let endIndex = Math.min(startIndex + 2, ordered.length - 1);
  startIndex = Math.max(0, endIndex - 2);

  const visible = ordered.slice(startIndex, endIndex + 1);

  const showLeftHint = startIndex > 0;
  const showRightHint = endIndex < ordered.length - 1;

  if (showLeftHint) {
    const hint = document.createElement("div");
    hint.className = "timeline-hint left";
    hint.setAttribute("aria-hidden", "true");
    rail.appendChild(hint);
  }

  visible.forEach((stage) => {
    const node = document.createElement("div");
    node.className = "timeline-node";

    const name = document.createElement("div");
    name.className = "timeline-name";
    name.textContent = stage?.name || "Stage";

    const dot = document.createElement("div");
    dot.className = "timeline-dot";
    if (stage?.from && stage.from <= currentYm && (!stage.to || currentYm <= stage.to)) {
      dot.classList.add("is-active");
    }

    const dates = document.createElement("div");
    dates.className = "timeline-dates";
    const from = stage?.from || "YYYY-MM";
    dates.textContent = `${from}${stage?.to ? `–${stage.to}` : ""}`;

    node.appendChild(name);
    node.appendChild(dot);
    node.appendChild(dates);
    rail.appendChild(node);
  });

  if (showRightHint) {
    const hint = document.createElement("div");
    hint.className = "timeline-hint right";
    hint.setAttribute("aria-hidden", "true");
    rail.appendChild(hint);
  }

  wrapper.appendChild(rail);
  return wrapper;
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
  lastMonthlySavingsAddedYm: null,
  planSeedLongterm: 0,
  planSeedBuffer: 0,
};

let stateWarning = "";
let currentGoalSaveStatus = "";
let isSavingCurrentGoal = false;
let backendCapabilities = {
  checked: false,
  saveCurrentValuesToPlan: false,
};

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
    last_monthly_savings_added_ym: goalState.lastMonthlySavingsAddedYm,
    plan_seed_longterm: goalState.planSeedLongterm,
    plan_seed_buffer: goalState.planSeedBuffer,
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

const loadBackendCapabilities = async () => {
  try {
    const response = await fetch("/api/meta", { cache: "no-store" });
    if (!response.ok) throw new Error("meta failed");
    const data = await response.json();
    backendCapabilities = {
      checked: true,
      saveCurrentValuesToPlan: Boolean(data?.capabilities?.save_current_values_to_plan),
    };
  } catch {
    backendCapabilities = {
      checked: true,
      saveCurrentValuesToPlan: false,
    };
  }
};

const applyGoalState = (nextState) => {
  goalState.currentLongterm = nextState.currentLongterm;
  goalState.currentBuffer = nextState.currentBuffer;
  goalState.lastMonthlySavingsAddedYm = nextState.lastMonthlySavingsAddedYm;
  goalState.planSeedLongterm = nextState.planSeedLongterm;
  goalState.planSeedBuffer = nextState.planSeedBuffer;
};

const snapshotGoalState = () => ({
  currentLongterm: goalState.currentLongterm,
  currentBuffer: goalState.currentBuffer,
  lastMonthlySavingsAddedYm: goalState.lastMonthlySavingsAddedYm,
  planSeedLongterm: goalState.planSeedLongterm,
  planSeedBuffer: goalState.planSeedBuffer,
});

const applyMonthlyRolloverIfNeeded = (stages) => {
  // Persisted state tracks the latest fully completed month already folded into the
  // current balances. On each rollover we only add months that finished since then.
  const result = rollGoalStateForward(snapshotGoalState(), stages, new Date());
  applyGoalState(result.state);
  return result.changed;
};

/* =========================
   Hero with TWO bars:
   - LT: thick, yellow gradient (inline style)
   - Buffer: thin, blue
   Meta: LT % main, buffer % secondary
   ========================= */
let liveCountdownUpdater = null;
let displayMode = "monthly";
let activeGoalPanel = null;

const sensitivityScenarios = [
  { label: "Low", rate: 0.04 },
  { label: "Base", rate: 0.08 },
  { label: "High", rate: 0.12 },
];

const formatProjectionSummary = (projection) => {
  if (!projection.reached || !projection.date) return "Not enough data";
  return projection.date.toLocaleDateString("sv-SE");
};

const saveCurrentGoalValues = async ({ currentLongterm, currentBuffer }) => {
  if (!cachedPlan) return;
  if (!backendCapabilities.saveCurrentValuesToPlan) {
    currentGoalSaveStatus =
      "This server needs a restart before the current-balances editor can save into plan.json.";
    renderCurrentDashboard();
    return;
  }

  isSavingCurrentGoal = true;
  currentGoalSaveStatus = "";
  renderCurrentDashboard();

  try {
    const response = await fetch("/api/plan/current-values", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        current_longterm: currentLongterm,
        current_buffer: currentBuffer,
      }),
    });

    if (!response.ok) {
      let detail =
        response.status === 404
          ? "The running server does not expose /api/plan/current-values. Restart `npm run start` so the updated backend route is loaded."
          : "Could not save balances to plan.json";
      try {
        const errorData = await response.json();
        if (errorData?.error) detail = errorData.error;
      } catch {}
      throw new Error(detail);
    }

    const data = await response.json();
    cachedPlan.goal = {
      ...(cachedPlan.goal || {}),
      ...(data.goal || {}),
    };

    // Manual edits become the new source-of-truth seed. We reseed the rollover
    // snapshot immediately so the app does not need a restart and future month
    // closings continue from the right base balances.
    const resolvedState = reconcileGoalState(cachedPlan.goal, null, new Date());
    applyGoalState(resolvedState);

    const stateSaved = await saveState();
    currentGoalSaveStatus = stateSaved
      ? "Saved current balances to plan.json."
      : "Saved to plan.json, but the rollover snapshot could not be saved.";
  } catch (err) {
    currentGoalSaveStatus = `Save failed: ${err.message}`;
  } finally {
    isSavingCurrentGoal = false;
    renderCurrentDashboard();
  }
};

const toggleGoalPanel = (panelName) => {
  activeGoalPanel = activeGoalPanel === panelName ? null : panelName;
  renderCurrentDashboard();
};

const createCurrentBalancesEditor = () => {
  const form = document.createElement("form");
  form.className = "goal-adjuster";

  const intro = document.createElement("div");
  intro.className = "goal-adjuster-copy";
  intro.innerHTML =
    '<div class="goal-adjuster-text">Edit the live balances and save them straight back to plan.json without restarting the app.</div>';
  form.appendChild(intro);

  const fields = document.createElement("div");
  fields.className = "goal-adjuster-fields";

  const createField = (labelText, name, value) => {
    const label = document.createElement("label");
    label.className = "goal-adjuster-field";

    const caption = document.createElement("span");
    caption.className = "goal-adjuster-label";
    caption.textContent = labelText;

    const input = document.createElement("input");
    input.className = "goal-adjuster-input";
    input.type = "number";
    input.name = name;
    input.inputMode = "numeric";
    input.step = "100";
    input.min = "0";
    input.value = String(value ?? 0);

    label.appendChild(caption);
    label.appendChild(input);
    return label;
  };

  fields.appendChild(
    createField("Long-term", "current_longterm", goalState.currentLongterm ?? 0)
  );
  fields.appendChild(createField("Buffer", "current_buffer", goalState.currentBuffer ?? 0));
  form.appendChild(fields);

  const actions = document.createElement("div");
  actions.className = "goal-adjuster-actions";

  const saveButton = document.createElement("button");
  saveButton.type = "submit";
  saveButton.className = "goal-adjuster-save";
  saveButton.disabled = isSavingCurrentGoal || !backendCapabilities.saveCurrentValuesToPlan;
  saveButton.textContent = isSavingCurrentGoal ? "Saving..." : "Save balances";
  actions.appendChild(saveButton);

  const status = document.createElement("div");
  status.className = "goal-adjuster-status";
  status.textContent =
    currentGoalSaveStatus ||
    (!backendCapabilities.saveCurrentValuesToPlan
      ? "Backend needs restart before this editor can write to plan.json."
      : formatSavingsAppliedStatus(goalState.lastMonthlySavingsAddedYm));
  actions.appendChild(status);

  form.appendChild(actions);

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const nextLongterm = Number(data.get("current_longterm"));
    const nextBuffer = Number(data.get("current_buffer"));

    saveCurrentGoalValues({
      currentLongterm: Number.isFinite(nextLongterm) ? nextLongterm : 0,
      currentBuffer: Number.isFinite(nextBuffer) ? nextBuffer : 0,
    });
  });

  return form;
};

const createSensitivityPanel = (goal, stages) => {
  const panel = document.createElement("section");
  panel.className = "sensitivity";

  const now = new Date();
  const currentYm = getCurrentYearMonth(now);
  const currentStage = findStageForYearMonth(stages, currentYm);
  const currentLongtermSaving = safeNumber(currentStage?.saving_longterm);
  const currentLongtermText =
    typeof currentLongtermSaving === "number"
      ? `${SEK(currentLongtermSaving)}/month`
      : "the current stage's monthly Long-term amount";
  const baseProjection = projectGoalDate({
    stages,
    goal,
    currentLongterm: goalState.currentLongterm,
    currentBuffer: goalState.currentBuffer,
    annualRate: 0.08,
    now,
  });
  const latestStageEnd = getLatestStageEndInfo(stages);

  const subtitle = document.createElement("div");
  subtitle.className = "sensitivity-subtitle";
  subtitle.innerHTML = baseProjection.reached && baseProjection.date
    ? `<strong>Projection based on your current savings plan</strong>
This estimate assumes you continue saving according to your plan with an annual return of 8%.

<strong>Estimated goal date:</strong> ${baseProjection.date.toLocaleDateString("sv-SE")}

<em>Below, you can see how different return rates affect your timeline.</em>`
    : `<strong>Projection based on your current savings plan</strong>
	This estimate uses your current monthly Long-term savings and the selected annual return rate.
	
	<em>Below, you can see how different return rates affect your timeline.</em>`;
  panel.appendChild(subtitle);

  if (
    latestStageEnd &&
    baseProjection.reached &&
    baseProjection.date &&
    baseProjection.date.getTime() > latestStageEnd.endDate.getTime()
  ) {
    const warning = document.createElement("div");
    warning.className = "sensitivity-warning";
    warning.textContent = `Projection extends the last plan stage beyond ${latestStageEnd.yearMonth}.`;
    panel.appendChild(warning);
  }

  const grid = document.createElement("div");
  grid.className = "sensitivity-grid";

  sensitivityScenarios.forEach((scenario) => {
    const projection = projectGoalDate({
      stages,
      goal,
      currentLongterm: goalState.currentLongterm,
      currentBuffer: goalState.currentBuffer,
      annualRate: scenario.rate,
      now: new Date(),
    });

    const card = document.createElement("div");
    card.className = "sensitivity-card";
    card.innerHTML = `
      <div class="sensitivity-label">${scenario.label}</div>
      <div class="sensitivity-rate">${(scenario.rate * 100).toFixed(0)}% annual</div>
      <div class="sensitivity-date">${formatProjectionSummary(projection)}</div>
    `;
    grid.appendChild(card);
  });

  panel.appendChild(grid);
  return panel;
};

const createGoalPanelToggle = (goal, stages) => {
  const wrapper = document.createElement("section");
  wrapper.className = "hero-tools";

  const toggle = document.createElement("div");
  toggle.className = "hero-panel-toggle";

  const buttons = [
    { key: "balances", label: "Current balances" },
    { key: "sensitivity", label: "Target-date sensitivity" },
  ];

  buttons.forEach((item) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `hero-panel-btn ${activeGoalPanel === item.key ? "is-active" : ""}`.trim();
    button.setAttribute("aria-pressed", activeGoalPanel === item.key ? "true" : "false");
    button.textContent = item.label;
    button.addEventListener("click", () => {
      toggleGoalPanel(item.key);
    });
    toggle.appendChild(button);
  });

  wrapper.appendChild(toggle);

  if (!activeGoalPanel) {
    return wrapper;
  }

  const panelShell = document.createElement("div");
  panelShell.className = "hero-panel-shell";

  if (activeGoalPanel === "balances") {
    panelShell.appendChild(createCurrentBalancesEditor());
  } else if (activeGoalPanel === "sensitivity") {
    panelShell.appendChild(createSensitivityPanel(goal, stages));
  }

  wrapper.appendChild(panelShell);
  return wrapper;
};

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
  labelLT.textContent = `${pctLT.toFixed(0)}%`;

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
  labelBuf.textContent = `${pctBuf.toFixed(0)}%`;

  barBuf.appendChild(fillBuf);
  barBuf.appendChild(labelBuf);

  bars.appendChild(barLT);
  bars.appendChild(barBuf);

  const barDetails = document.createElement("div");
  barDetails.className = "hero-bar-details";
  barDetails.innerHTML = `
    <div>Long-term: ${SEK(lt)} / ${SEK(targetLT)}</div>
    <div>Buffer: ${SEK(buf)} / ${SEK(targetBuf)}</div>
  `;

  // Countdown line
  const countdownRow = document.createElement("div");
  countdownRow.className = "hero-countdowns";

  const bufferCountdown = document.createElement("div");
  bufferCountdown.className = "hero-countdown buffer";

  const ltCountdown = document.createElement("div");
  ltCountdown.className = "hero-countdown lt";

  const projection = projectGoalDate({
    stages,
    goal,
    currentLongterm: goalState.currentLongterm,
    currentBuffer: goalState.currentBuffer,
    annualRate: 0.08,
    now: new Date(),
  });
  const bufferProjection = projectBufferDate({
    stages,
    goal,
    currentBuffer: goalState.currentBuffer,
    now: new Date(),
  });

  const updateCountdowns = () => {
    if (projection.reached && projection.date) {
      const ms = projection.date.getTime() - Date.now();
      ltCountdown.textContent = `LT goal: ${projection.date.toLocaleDateString(
        "sv-SE"
      )} • ${formatCountdown(ms)}`;
    } else {
      ltCountdown.textContent = "LT goal: Not enough data";
    }

    if (bufferProjection.reached && bufferProjection.date) {
      const ms = bufferProjection.date.getTime() - Date.now();
      bufferCountdown.textContent = `Buffer: ${bufferProjection.date.toLocaleDateString(
        "sv-SE"
      )} • ${formatCountdown(ms)}`;
    } else {
      bufferCountdown.textContent = "Buffer: Not enough data";
    }
  };

  if (projection.reached && projection.date) {
    updateCountdowns();
    hero._updateCountdown = updateCountdowns;
  } else {
    updateCountdowns();
    hero._updateCountdown = updateCountdowns;
  }

  hero.appendChild(row);
  hero.appendChild(bars);
  hero.appendChild(barDetails);
  countdownRow.appendChild(ltCountdown);
  countdownRow.appendChild(bufferCountdown);
  hero.appendChild(countdownRow);
  hero.appendChild(createAssumptionsNote());
  hero.appendChild(createGoalPanelToggle(goal, stages));

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

  const toggle = document.createElement("div");
  toggle.className = "mode-toggle";
  const monthlyBtn = document.createElement("button");
  monthlyBtn.type = "button";
  monthlyBtn.className = `mode-btn ${displayMode === "monthly" ? "is-active" : ""}`.trim();
  monthlyBtn.textContent = "Monthly";
  monthlyBtn.addEventListener("click", () => {
    if (displayMode === "monthly") return;
    displayMode = "monthly";
    renderCurrentDashboard();
  });
  const yearlyBtn = document.createElement("button");
  yearlyBtn.type = "button";
  yearlyBtn.className = `mode-btn ${displayMode === "yearly" ? "is-active" : ""}`.trim();
  yearlyBtn.textContent = "Yearly";
  yearlyBtn.addEventListener("click", () => {
    if (displayMode === "yearly") return;
    displayMode = "yearly";
    renderCurrentDashboard();
  });
  toggle.appendChild(monthlyBtn);
  toggle.appendChild(yearlyBtn);
  header.appendChild(toggle);

  // Hero
  const hero = createGoalHero(goal, stages);
  liveCountdownUpdater = hero._updateCountdown || null;

  // Main grid
  const grid = document.createElement("section");
  grid.className = "card-grid";

  // Net income (prominent) with pretax + tax details
  const incomeDetails = `Pre-tax: ${formatAmount(vm.incomePreTax, displayMode)} • Tax: ${formatAmount(
    vm.tax,
    displayMode
  )}`;
  grid.appendChild(
    createCard({
      title: "Net income",
      value: formatAmount(vm.netIncome, displayMode),
      details: incomeDetails,
    })
  );

  const availableBeforeSavings =
    typeof vm.netIncome === "number" && typeof vm.totalOut === "number"
      ? vm.netIncome - vm.totalOut
      : null;

  // Money out
  grid.appendChild(
    createCard({
      title: "Money out",
      value: formatAmount(vm.totalOut, displayMode),
      details: `Fixed: ${formatAmount(vm.fixedCosts, displayMode)} • Household: ${formatAmount(
        vm.household,
        displayMode
      )} • Available before savings: ${formatAmount(availableBeforeSavings, displayMode)}`,
    })
  );

  // Savings
  const savingsTotal = vm.savingsTotal;
  const savingsLong = vm.savingsLong;
  const savingsBuffer = vm.savingsBuffer;
  const savingsBar =
    typeof savingsTotal === "number" && savingsTotal > 0
      ? `<div class="stacked-bar">
           <span class="stacked-seg long" style="width:${clamp(
             ((typeof savingsLong === "number" ? savingsLong : 0) / savingsTotal) * 100,
             0,
             100
           )}%"></span>
           <span class="stacked-seg buffer" style="width:${clamp(
             ((typeof savingsBuffer === "number" ? savingsBuffer : 0) / savingsTotal) * 100,
             0,
             100
           )}%"></span>
         </div>`
      : "";
  grid.appendChild(
    createCard({
      title: "Savings",
      value: formatAmount(savingsTotal, displayMode),
      details: `Long-term: ${formatAmount(savingsLong, displayMode)} • Buffer: ${formatAmount(
        savingsBuffer,
        displayMode
      )}`,
      extra: savingsBar,
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
      value: formatAmount(leftover, displayMode),
      details: "After out + savings",
      variant,
    })
  );

  app.appendChild(header);
  app.appendChild(createStageTimeline(stages, yearMonth));
  app.appendChild(hero);
  app.appendChild(grid);
  app.appendChild(
    createFooter({
      lastAppliedYm: goalState.lastMonthlySavingsAddedYm,
    })
  );
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

const renderCurrentDashboard = () => {
  if (!cachedPlan) return;
  const stages = Array.isArray(cachedPlan.stages) ? cachedPlan.stages : [];
  const yearMonth = getCurrentYearMonth(new Date());
  const stage = findStageForYearMonth(stages, yearMonth);
  renderDashboard({
    yearMonth,
    stage,
    warning: stateWarning,
    goal: cachedPlan.goal || {},
    stages,
  });
};

const loadPlan = async () => {
  try {
    await loadBackendCapabilities();
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
    const resolvedState = reconcileGoalState(plan.goal || {}, storedState, new Date());
    applyGoalState(resolvedState);

    let shouldPersist = resolvedState.shouldPersist;
    const rolloverChanged = applyMonthlyRolloverIfNeeded(stages);
    if (rolloverChanged) {
      shouldPersist = true;
    }

    if (shouldPersist) {
      await saveState();
    }

    renderCurrentDashboard();

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
        renderCurrentDashboard();
      });
    }, 60_000);
  } catch (err) {
    renderStatus(`Error loading plan: ${err.message}`, true);
  }
};

renderStatus("Loading...");
loadPlan();

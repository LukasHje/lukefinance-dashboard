const express = require("express");
const fs = require("fs");
const path = require("path");


const app = express();
const PORT = process.env.PORT || 4173;
const API_VERSION = "2026-04-10";

app.use(express.json({ limit: "1mb" }));

const toFiniteNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

// Serve static files
const publicDir = path.join(__dirname, "public");
app.use(express.static(publicDir, { etag: false, maxAge: 0 }));
const planPath = path.join(publicDir, "plan.json");

// Persistent state file (stored on disk)
const statePath = path.join(__dirname, "state.json");

const readJsonFile = (filePath) => {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
};

const readState = () => {
  if (!fs.existsSync(statePath)) return null;
  return readJsonFile(statePath);
};

const writeState = (obj) => {
  fs.writeFileSync(statePath, JSON.stringify(obj, null, 2), "utf8");
};

const readPlan = () => {
  if (!fs.existsSync(planPath)) return null;
  return readJsonFile(planPath);
};

const writePlan = (plan) => {
  fs.writeFileSync(planPath, JSON.stringify(plan, null, 2), "utf8");
};

app.get("/api/meta", (_req, res) => {
  res.json({
    api_version: API_VERSION,
    capabilities: {
      save_current_values_to_plan: true,
    },
  });
});

// GET state
app.get("/api/state", (_req, res) => {
  const s = readState();
  if (!s) return res.json({}); // empty if not created yet
  res.json(s);
});

// PUT state
app.put("/api/state", (req, res) => {
  const body = req.body || {};
  // Keep a tiny persisted snapshot so monthly rollovers survive restarts.
  const out = {
    current_longterm: toFiniteNumber(body.current_longterm),
    current_buffer: toFiniteNumber(body.current_buffer),
    last_monthly_savings_added_ym:
      typeof body.last_monthly_savings_added_ym === "string"
        ? body.last_monthly_savings_added_ym
        : null,
    plan_seed_longterm: toFiniteNumber(body.plan_seed_longterm),
    plan_seed_buffer: toFiniteNumber(body.plan_seed_buffer),
    updated_at: new Date().toISOString(),
  };
  writeState(out);
  res.json(out);
});

app.put("/api/plan/current-values", (req, res) => {
  const plan = readPlan();
  if (!plan || typeof plan !== "object") {
    return res.status(500).json({ error: "Could not read public/plan.json" });
  }

  const body = req.body || {};
  const currentLongterm = toFiniteNumber(body.current_longterm);
  const currentBuffer = toFiniteNumber(body.current_buffer);

  const nextPlan = {
    ...plan,
    goal: {
      ...(plan.goal || {}),
      current_longterm: currentLongterm,
      current_buffer: currentBuffer,
    },
  };

  try {
    writePlan(nextPlan);
  } catch {
    return res.status(500).json({ error: "Could not write public/plan.json" });
  }

  return res.json({
    goal: nextPlan.goal,
    saved_at: new Date().toISOString(),
  });
});

app.listen(PORT, "127.0.0.1", () => {
  console.log(`Dashboard running on http://127.0.0.1:${PORT}`);
});

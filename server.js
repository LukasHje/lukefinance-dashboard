const express = require("express");
const fs = require("fs");
const path = require("path");


const app = express();
const PORT = process.env.PORT || 4173;

app.use(express.json({ limit: "1mb" }));

// Serve static files
const publicDir = path.join(__dirname, "public");
app.use(express.static(publicDir, { etag: false, maxAge: 0 }));

// Persistent state file (stored on disk)
const statePath = path.join(__dirname, "state.json");

const readState = () => {
  try {
    if (!fs.existsSync(statePath)) return null;
    return JSON.parse(fs.readFileSync(statePath, "utf8"));
  } catch {
    return null;
  }
};

const writeState = (obj) => {
  fs.writeFileSync(statePath, JSON.stringify(obj, null, 2), "utf8");
};

// GET state
app.get("/api/state", (_req, res) => {
  const s = readState();
  if (!s) return res.json({}); // empty if not created yet
  res.json(s);
});

// PUT state
app.put("/api/state", (req, res) => {
  const body = req.body || {};
  // very small validation
  const out = {
    current_longterm: Number(body.current_longterm) || 0,
    current_buffer: Number(body.current_buffer) || 0,
    last_rollover_ym: typeof body.last_rollover_ym === "string" ? body.last_rollover_ym : null,
    updated_at: new Date().toISOString(),
  };
  writeState(out);
  res.json(out);
});

app.listen(PORT, "127.0.0.1", () => {
  console.log(`Dashboard running on http://127.0.0.1:${PORT}`);
});

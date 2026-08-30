/* =========================================================
   ATMOSPHERIC WATER GENERATION SYSTEM — DASHBOARD LOGIC
   ---------------------------------------------------------
   Structured in 4 clearly separated layers so the simulated
   data source can be swapped for a real backend REST API
   without touching the rendering or chart code:

     1. DATA LAYER        — simulation now, fetch() later
     2. DASHBOARD RENDER  — DOM updates from systemData
     3. CHART LAYER       — Chart.js instances + updates
     4. RECOMMENDATION    — rule-based advisory engine
   ========================================================= */

const UPDATE_INTERVAL_MS = 4000;
const HISTORY_LENGTH = 16;

/* =========================================================
   1. DATA LAYER
   To connect a real backend: replace fetchLatestReading()
   with a call like `await fetch('/api/system/latest')`
   and keep the same return shape.
   ========================================================= */

const systemData = {
  temperature: 28.5,      // °C
  humidity: 72,           // %
  dewPoint: 22.9,         // °C
  tankLevel: 64,          // %
  waterProduced: 1.8,     // L (cumulative, session)
  productionRate: 0.3,    // L/hr
  energyConsumed: 42,     // Wh (cumulative, session)
  efficiency: 23.3,       // Wh/L
  fanStatus: "ON",
  coolingStatus: "ON",
  collectionStatus: "ACTIVE",
  systemStatus: "RUNNING",
};

// Rolling history buffers for the two trend charts
const history = {
  labels: [],
  waterProduced: [],
  energyConsumed: [],
};

function seedHistory() {
  const now = new Date();
  let water = Math.max(0, systemData.waterProduced - systemData.productionRate * (HISTORY_LENGTH - 1) / 4);
  let energy = Math.max(0, systemData.energyConsumed - 8 * (HISTORY_LENGTH - 1));

  for (let i = HISTORY_LENGTH - 1; i >= 0; i--) {
    const t = new Date(now.getTime() - i * UPDATE_INTERVAL_MS * 3);
    history.labels.push(formatTime(t));
    water += systemData.productionRate / 4 + randomJitter(0.02);
    energy += 8 + randomJitter(2);
    history.waterProduced.push(round(Math.max(0, water), 2));
    history.energyConsumed.push(round(Math.max(0, energy), 1));
  }
  // Snap the last point to the true current values
  history.waterProduced[history.waterProduced.length - 1] = systemData.waterProduced;
  history.energyConsumed[history.energyConsumed.length - 1] = systemData.energyConsumed;
}

/**
 * Simulates a new sensor/system reading.
 * Replace the body of this function with a real API call when
 * a backend becomes available — keep the same field names so
 * renderDashboard() / updateCharts() / getRecommendation()
 * continue to work unchanged.
 */
function fetchLatestReading() {
  systemData.temperature = clamp(systemData.temperature + randomJitter(0.3), 18, 40);
  systemData.humidity = clamp(systemData.humidity + randomJitter(1.5), 30, 95);
  systemData.dewPoint = round(systemData.temperature - ((100 - systemData.humidity) / 5), 1);

  systemData.productionRate = clamp(systemData.productionRate + randomJitter(0.03), 0.05, 0.9);
  systemData.waterProduced = round(systemData.waterProduced + systemData.productionRate / (3600 / (UPDATE_INTERVAL_MS / 1000)), 2);

  const energyDelta = clamp(7 + randomJitter(2.5), 2, 14);
  systemData.energyConsumed = round(systemData.energyConsumed + energyDelta, 1);

  systemData.tankLevel = clamp(systemData.tankLevel + systemData.productionRate * 1.2 + randomJitter(0.4), 0, 100);

  systemData.efficiency = systemData.waterProduced > 0
    ? round(systemData.energyConsumed / systemData.waterProduced, 1)
    : systemData.efficiency;

  // Subsystem states follow simple operational rules
  systemData.coolingStatus = systemData.tankLevel >= 97 ? "OFF" : "ON";
  systemData.fanStatus = systemData.humidity < 35 ? "OFF" : "ON";
  systemData.collectionStatus = systemData.tankLevel >= 97 ? "PAUSED" : "ACTIVE";
  systemData.systemStatus = "RUNNING";

  return systemData;
}

function randomJitter(magnitude) {
  return (Math.random() * 2 - 1) * magnitude;
}
function clamp(v, min, max) { return Math.min(max, Math.max(min, v)); }
function round(v, decimals) { const f = 10 ** decimals; return Math.round(v * f) / f; }
function formatTime(d) {
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/* =========================================================
   2. DASHBOARD RENDER LAYER
   Pure DOM updates driven entirely by systemData.
   ========================================================= */

function renderDashboard() {
  // Environmental conditions
  setText("temperatureValue", `${systemData.temperature.toFixed(1)} <small>°C</small>`, true);
  setText("humidityValue", `${Math.round(systemData.humidity)}<small>%</small>`, true);
  setText("dewPointValue", `${systemData.dewPoint.toFixed(1)} <small>°C</small>`, true);

  // Tank level
  const tankPct = Math.round(systemData.tankLevel);
  document.getElementById("tankLiquid").style.height = `${tankPct}%`;
  setText("tankLevelValue", `${tankPct}<small>%</small>`, true);
  const tankStatusEl = document.getElementById("tankLevelStatus");
  if (tankPct >= 90) {
    tankStatusEl.textContent = "Nearing capacity";
    tankStatusEl.style.color = "var(--amber)";
  } else if (tankPct <= 10) {
    tankStatusEl.textContent = "Low reserve";
    tankStatusEl.style.color = "var(--amber)";
  } else {
    tankStatusEl.textContent = "Normal range";
    tankStatusEl.style.color = "var(--green)";
  }

  // Water produced / rate
  setText("waterProducedValue", `${systemData.waterProduced.toFixed(1)}<small>L</small>`, true);
  setText("productionRateValue", `${systemData.productionRate.toFixed(1)} L/hr`);

  // Energy consumed
  setText("energyConsumedValue", `${Math.round(systemData.energyConsumed)}<small>Wh</small>`, true);

  // Efficiency ring + tag
  renderEfficiency();

  // Status indicators
  renderStatusIndicator("systemStatusIndicator", systemData.systemStatus, "running");
  renderStatusIndicator("fanStatusIndicator", systemData.fanStatus, systemData.fanStatus === "ON" ? "on" : "off");
  renderStatusIndicator("coolingStatusIndicator", systemData.coolingStatus, systemData.coolingStatus === "ON" ? "on" : "off");
  renderStatusIndicator("collectionStatusIndicator", systemData.collectionStatus, systemData.collectionStatus === "ACTIVE" ? "on" : "warning");

  // Summary strip
  const rec = getRecommendation();
  setSummaryValue("summaryConditions", rec.conditionsLabel, rec.conditionsClass);
  setSummaryValue("summaryGeneration", systemData.collectionStatus === "ACTIVE" ? "ACTIVE" : "PAUSED", systemData.collectionStatus === "ACTIVE" ? "good" : "warning");
  setSummaryValue("summaryEfficiency", rec.efficiencyTag, rec.efficiencyClass);
  setSummaryValue("summaryHealth", rec.healthLabel, rec.healthClass);

  // Recommendation panel
  document.getElementById("recommendationText").textContent = rec.message;
  document.getElementById("recommendedAction").textContent = rec.action;

  // Timestamps
  const now = new Date();
  document.getElementById("lastUpdated").textContent = now.toLocaleTimeString();
}

function renderEfficiency() {
  const eff = systemData.efficiency;
  const rec = classifyEfficiency(eff);

  setText("efficiencyValue", eff.toFixed(1));
  setText("efficiencyInlineValue", `${eff.toFixed(1)} Wh/L`);

  const CIRCUMFERENCE = 314.159; // 2 * PI * 50
  const MIN_EFF = 10, MAX_EFF = 42; // best..worst bounds for the ring fill
  const fillPct = clamp((MAX_EFF - eff) / (MAX_EFF - MIN_EFF), 0, 1);
  const ringEl = document.getElementById("efficiencyRingProgress");
  ringEl.style.strokeDashoffset = String(CIRCUMFERENCE * (1 - fillPct));
  ringEl.style.stroke = rec.color;

  const tagEl = document.getElementById("efficiencyTag");
  tagEl.textContent = rec.label;
  tagEl.className = `efficiency-tag ${rec.cssClass}`;

  const badgeEl = document.getElementById("efficiencyBadge");
  badgeEl.textContent = rec.label;
  badgeEl.className = `efficiency-badge ${rec.cssClass}`;
}

function classifyEfficiency(eff) {
  if (eff <= 26) return { label: "OPTIMAL", cssClass: "", color: "var(--green)" };
  if (eff <= 33) return { label: "MODERATE", cssClass: "moderate", color: "var(--amber)" };
  return { label: "HIGH CONSUMPTION", cssClass: "high", color: "var(--red)" };
}

function renderStatusIndicator(elId, text, stateClass) {
  const el = document.getElementById(elId);
  el.className = `status-indicator ${stateClass}`;
  el.innerHTML = `<span class="dot"></span> ${text}`;
}

function setSummaryValue(elId, text, cssClass) {
  const el = document.getElementById(elId);
  el.textContent = text;
  el.className = `summary-value ${cssClass}`;
}

function setText(elId, html, isHtml) {
  const el = document.getElementById(elId);
  if (!el) return;
  if (isHtml) el.innerHTML = html; else el.textContent = html;
}

/* =========================================================
   3. CHART LAYER
   ========================================================= */

let waterChart, energyChart;

function initCharts() {
  const sharedGrid = { color: "rgba(255,255,255,0.06)" };
  const sharedTicks = { color: "#9aa7b5", font: { family: "JetBrains Mono", size: 10.5 } };

  const waterCtx = document.getElementById("waterChart").getContext("2d");
  const waterGradient = waterCtx.createLinearGradient(0, 0, 0, 260);
  waterGradient.addColorStop(0, "rgba(34, 211, 238, 0.35)");
  waterGradient.addColorStop(1, "rgba(34, 211, 238, 0.0)");

  waterChart = new Chart(waterCtx, {
    type: "line",
    data: {
      labels: history.labels,
      datasets: [{
        label: "Water Produced (L)",
        data: history.waterProduced,
        borderColor: "#22d3ee",
        backgroundColor: waterGradient,
        borderWidth: 2,
        pointRadius: 0,
        pointHoverRadius: 4,
        pointHoverBackgroundColor: "#22d3ee",
        tension: 0.35,
        fill: true,
      }],
    },
    options: chartOptions(sharedGrid, sharedTicks, "Litres"),
  });

  const energyCtx = document.getElementById("energyChart").getContext("2d");
  const energyGradient = energyCtx.createLinearGradient(0, 0, 0, 260);
  energyGradient.addColorStop(0, "rgba(52, 211, 153, 0.30)");
  energyGradient.addColorStop(1, "rgba(52, 211, 153, 0.0)");

  energyChart = new Chart(energyCtx, {
    type: "line",
    data: {
      labels: history.labels,
      datasets: [{
        label: "Energy Consumed (Wh)",
        data: history.energyConsumed,
        borderColor: "#34d399",
        backgroundColor: energyGradient,
        borderWidth: 2,
        pointRadius: 0,
        pointHoverRadius: 4,
        pointHoverBackgroundColor: "#34d399",
        tension: 0.35,
        fill: true,
      }],
    },
    options: chartOptions(sharedGrid, sharedTicks, "Watt-hours"),
  });
}

function chartOptions(grid, ticks, yLabel) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: "index", intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: "#141b25",
        borderColor: "rgba(255,255,255,0.1)",
        borderWidth: 1,
        titleColor: "#9aa7b5",
        bodyColor: "#e7edf3",
        padding: 10,
        titleFont: { family: "Inter", size: 11 },
        bodyFont: { family: "JetBrains Mono", size: 12 },
      },
    },
    scales: {
      x: { grid: { display: false }, ticks },
      y: {
        grid,
        ticks,
        title: { display: true, text: yLabel, color: "#616e7c", font: { family: "Inter", size: 11 } },
      },
    },
  };
}

function updateCharts() {
  const now = new Date();
  history.labels.push(formatTime(now));
  history.waterProduced.push(systemData.waterProduced);
  history.energyConsumed.push(systemData.energyConsumed);

  if (history.labels.length > HISTORY_LENGTH) {
    history.labels.shift();
    history.waterProduced.shift();
    history.energyConsumed.shift();
  }

  waterChart.data.labels = history.labels;
  waterChart.data.datasets[0].data = history.waterProduced;
  waterChart.update("none");

  energyChart.data.labels = history.labels;
  energyChart.data.datasets[0].data = history.energyConsumed;
  energyChart.update("none");
}

/* =========================================================
   4. RECOMMENDATION ENGINE
   Rule-based, evaluated from the live systemData snapshot.
   ========================================================= */

function getRecommendation() {
  const { humidity, tankLevel, efficiency, temperature } = systemData;
  const eff = classifyEfficiency(efficiency);

  let message, action, conditionsLabel, conditionsClass;

  if (tankLevel >= 90) {
    message = "Tank capacity is nearly full. Reduce or pause water generation to avoid overflow.";
    action = "Pause Water Generation";
    conditionsLabel = "TANK NEAR FULL";
    conditionsClass = "warning";
  } else if (humidity < 40) {
    message = "Humidity is currently low. Reduce cooling intensity to avoid unnecessary energy consumption.";
    action = "Reduce Cooling Intensity";
    conditionsLabel = "LOW HUMIDITY";
    conditionsClass = "warning";
  } else if (eff.label === "HIGH CONSUMPTION") {
    message = "Energy consumption per litre is high. Optimize cooling operation to bring efficiency back into range.";
    action = "Optimize Cooling Operation";
    conditionsLabel = "ENERGY INEFFICIENT";
    conditionsClass = "warning";
  } else if (eff.label === "MODERATE") {
    message = "Conditions are acceptable but efficiency has drifted from optimal. Monitor cooling load over the next interval.";
    action = "Monitor Cooling Load";
    conditionsLabel = "ACCEPTABLE";
    conditionsClass = "warning";
  } else {
    message = "Atmospheric conditions are favorable for water generation. Maintain the current cooling operation to achieve optimal water production while maintaining energy efficiency.";
    action = "Maintain Current Operation";
    conditionsLabel = "FAVORABLE";
    conditionsClass = "good";
  }

  const healthPoor = tankLevel >= 97 || eff.label === "HIGH CONSUMPTION";
  const healthWatch = tankLevel >= 90 || humidity < 40 || eff.label === "MODERATE";

  return {
    message,
    action,
    conditionsLabel,
    conditionsClass,
    efficiencyTag: eff.label,
    efficiencyClass: eff.cssClass === "" ? "good" : eff.cssClass === "moderate" ? "warning" : "critical",
    healthLabel: healthPoor ? "NEEDS ATTENTION" : healthWatch ? "MONITOR" : "HEALTHY",
    healthClass: healthPoor ? "critical" : healthWatch ? "warning" : "good",
  };
}

/* =========================================================
   HEADER CLOCK
   ========================================================= */

function tickClock() {
  const now = new Date();
  document.getElementById("clockTime").textContent = now.toLocaleTimeString();
  document.getElementById("clockDate").textContent = now.toLocaleDateString(undefined, {
    weekday: "short", year: "numeric", month: "short", day: "numeric",
  });
}

/* =========================================================
   BOOTSTRAP
   ========================================================= */

function tickDashboard() {
  fetchLatestReading();
  renderDashboard();
  updateCharts();
}

document.addEventListener("DOMContentLoaded", () => {
  seedHistory();
  initCharts();
  renderDashboard();
  tickClock();

  setInterval(tickClock, 1000);
  setInterval(tickDashboard, UPDATE_INTERVAL_MS);
});

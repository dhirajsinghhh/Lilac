"use strict";

const DB_NAME = "lilac-study-db";
const DB_VERSION = 1;
const STORE_NAME = "kv";
const STATE_KEY = "app-state";
const TIMER_KEY = "lilac-study-focus-start";

const views = ["planner", "history", "insights", "notes", "data"];

let state = createDefaultState();
let activeView = "planner";
let historyRange = 30;
let hasScrolledToToday = false;
let saveTimer = 0;
let timerInterval = 0;
let installPrompt = null;
let drawingActive = false;
let lastPoint = null;

const els = {};

document.addEventListener("DOMContentLoaded", init);

function createDefaultState() {
  return {
    version: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    theme: "lilac",
    tasks: [],
    events: [],
    studyByDate: {},
    notesHtml: "",
    drawingData: ""
  };
}

async function init() {
  cacheElements();
  bindEvents();
  await loadInitialState();
  applyTheme(state.theme);
  hydrateNotes();
  hydrateDrawing();
  renderAll();
  startTimerTicker();
  registerServiceWorker();
}

function cacheElements() {
  els.timerNow = document.getElementById("timerNow");
  els.timerTotal = document.getElementById("timerTotal");
  els.timerToggle = document.getElementById("timerToggle");
  els.themeSelect = document.getElementById("themeSelect");
  els.installButton = document.getElementById("installButton");
  els.taskForm = document.getElementById("taskForm");
  els.taskTitle = document.getElementById("taskTitle");
  els.taskKind = document.getElementById("taskKind");
  els.taskDate = document.getElementById("taskDate");
  els.dateField = document.getElementById("dateField");
  els.taskFeedback = document.getElementById("taskFeedback");
  els.todaySummary = document.getElementById("todaySummary");
  els.statGrid = document.getElementById("statGrid");
  els.queueCount = document.getElementById("queueCount");
  els.dueQueue = document.getElementById("dueQueue");
  els.calendarScroller = document.getElementById("calendarScroller");
  els.scrollOlder = document.getElementById("scrollOlder");
  els.scrollToday = document.getElementById("scrollToday");
  els.scrollNewer = document.getElementById("scrollNewer");
  els.historyList = document.getElementById("historyList");
  els.insightGrid = document.getElementById("insightGrid");
  els.studyChart = document.getElementById("studyChart");
  els.chartTotal = document.getElementById("chartTotal");
  els.completedCount = document.getElementById("completedCount");
  els.completedList = document.getElementById("completedList");
  els.notesEditor = document.getElementById("notesEditor");
  els.noteLink = document.getElementById("noteLink");
  els.noteImage = document.getElementById("noteImage");
  els.drawingCanvas = document.getElementById("drawingCanvas");
  els.clearDrawing = document.getElementById("clearDrawing");
  els.exportData = document.getElementById("exportData");
  els.importData = document.getElementById("importData");
  els.resetData = document.getElementById("resetData");
  els.storageStatus = document.getElementById("storageStatus");
}

function bindEvents() {
  document.querySelectorAll(".tab-button").forEach((button) => {
    button.addEventListener("click", () => switchView(button.dataset.view));
  });

  els.timerToggle.addEventListener("click", toggleTimer);
  document.addEventListener("visibilitychange", updateTimerDisplay);
  window.addEventListener("focus", updateTimerDisplay);
  window.addEventListener("storage", (event) => {
    if (event.key === TIMER_KEY) updateTimerDisplay();
  });

  els.themeSelect.addEventListener("change", () => {
    commit((draft) => {
      draft.theme = els.themeSelect.value;
    });
    applyTheme(state.theme);
  });

  els.taskKind.addEventListener("change", updateDateField);
  els.taskForm.addEventListener("submit", handleTaskSubmit);

  els.dueQueue.addEventListener("click", handleTaskActionClick);
  els.calendarScroller.addEventListener("click", handleCalendarClick);
  els.calendarScroller.addEventListener("wheel", handleCalendarWheel, { passive: false });

  els.scrollOlder.addEventListener("click", () => scrollCalendarBy(-1));
  els.scrollNewer.addEventListener("click", () => scrollCalendarBy(1));
  els.scrollToday.addEventListener("click", () => scrollTodayIntoView(true));

  document.querySelectorAll("[data-range]").forEach((button) => {
    button.addEventListener("click", () => {
      historyRange = Number(button.dataset.range);
      document.querySelectorAll("[data-range]").forEach((item) => item.classList.toggle("is-active", item === button));
      renderHistory();
    });
  });

  document.querySelectorAll("[data-command]").forEach((button) => {
    button.addEventListener("click", () => formatNote(button.dataset.command));
  });
  els.noteLink.addEventListener("click", addNoteLink);
  els.noteImage.addEventListener("change", handleNoteImage);
  els.notesEditor.addEventListener("input", () => {
    state.notesHtml = els.notesEditor.innerHTML;
    queueSave();
  });

  els.clearDrawing.addEventListener("click", clearDrawing);
  bindCanvasEvents();

  els.exportData.addEventListener("click", exportData);
  els.importData.addEventListener("change", importData);
  els.resetData.addEventListener("click", resetData);

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    installPrompt = event;
    els.installButton.classList.remove("hidden");
  });

  els.installButton.addEventListener("click", async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    await installPrompt.userChoice;
    installPrompt = null;
    els.installButton.classList.add("hidden");
  });
}

async function loadInitialState() {
  try {
    const saved = await idbGet(STATE_KEY);
    if (saved) {
      state = migrateState(saved);
      setStorageStatus("Local database ready.");
      return;
    }

    const legacy = await loadLegacyState();
    if (legacy) {
      state = migrateLegacyState(legacy);
      await idbSet(STATE_KEY, state);
      setStorageStatus("Imported earlier local study data.");
      return;
    }

    state = createDefaultState();
    await idbSet(STATE_KEY, state);
    setStorageStatus("Local database ready.");
  } catch (error) {
    console.error(error);
    state = createDefaultState();
    setStorageStatus("Local database could not be opened. Changes may not persist.");
  }
}

function migrateState(input) {
  const next = { ...createDefaultState(), ...input };
  next.tasks = Array.isArray(input.tasks) ? input.tasks.map(normalizeTask).filter(Boolean) : [];
  next.events = Array.isArray(input.events) ? input.events.map(normalizeEvent).filter(Boolean) : [];
  next.studyByDate = input.studyByDate && typeof input.studyByDate === "object" ? input.studyByDate : {};
  next.theme = ["lilac", "graphite", "mint", "rose"].includes(input.theme) ? input.theme : "lilac";
  next.notesHtml = typeof input.notesHtml === "string" ? input.notesHtml : "";
  next.drawingData = typeof input.drawingData === "string" ? input.drawingData : "";
  return next;
}

function normalizeTask(task) {
  if (!task || !task.title) return null;
  const now = new Date().toISOString();
  const kind = task.kind === "once" ? "once" : "review";
  const status = ["active", "completed", "abandoned"].includes(task.status) ? task.status : "active";
  const base = {
    id: task.id || makeId("task"),
    kind,
    title: String(task.title).trim(),
    createdAt: task.createdAt || now,
    originDate: task.originDate || todayKey(),
    status,
    completedDate: task.completedDate || null,
    abandonedDate: task.abandonedDate || null
  };

  if (kind === "once") {
    return {
      ...base,
      scheduledDate: task.scheduledDate || task.originDate || todayKey()
    };
  }

  const review = task.review || {};
  return {
    ...base,
    review: {
      nextReviewDate: review.nextReviewDate || task.originDate || todayKey(),
      repetitions: Number.isFinite(review.repetitions) ? review.repetitions : 0,
      ease: Number.isFinite(review.ease) ? review.ease : 2.5,
      interval: Number.isFinite(review.interval) ? review.interval : 0,
      frozen: Boolean(review.frozen)
    }
  };
}

function normalizeEvent(event) {
  if (!event || !event.taskTitle) return null;
  return {
    id: event.id || makeId("event"),
    date: event.date || todayKey(),
    createdAt: event.createdAt || new Date().toISOString(),
    taskId: event.taskId || null,
    taskTitle: String(event.taskTitle),
    kind: event.kind === "once" ? "once" : "review",
    action: event.action || "completed",
    detail: event.detail || "",
    nextReviewDate: event.nextReviewDate || null
  };
}

function migrateLegacyState(legacy) {
  const next = createDefaultState();
  next.notesHtml = legacy.notesHtml || "";
  next.drawingData = legacy.drawingData || "";
  const reviews = Array.isArray(legacy.reviews) ? legacy.reviews : [];
  const tasks = Array.isArray(legacy.tasks) ? legacy.tasks : [];

  next.tasks = tasks.map((task) => {
    const review = reviews.find((item) => item.taskId === task.id);
    const origin = keyFromUnknownDate(task.dateOfOrigin || task.date || review?.nextReview);
    const status = task.abandoned ? "abandoned" : task.done ? "completed" : "active";

    if (task.type === "scheduled") {
      return normalizeTask({
        id: String(task.id),
        kind: "once",
        title: task.topic || "Imported task",
        originDate: origin,
        scheduledDate: keyFromUnknownDate(task.date || origin),
        status,
        completedDate: task.done ? origin : null,
        abandonedDate: task.abandoned ? origin : null
      });
    }

    return normalizeTask({
      id: String(task.id),
      kind: "review",
      title: task.topic || "Imported revision",
      originDate: origin,
      status,
      completedDate: task.done ? origin : null,
      abandonedDate: task.abandoned ? origin : null,
      review: {
        nextReviewDate: keyFromUnknownDate(review?.nextReview || origin),
        repetitions: review?.repetitions || 0,
        ease: review?.ease || 2.5,
        interval: review?.interval || 0,
        frozen: Boolean(review?.frozen || task.done || task.abandoned)
      }
    });
  }).filter(Boolean);

  next.events = next.tasks
    .filter((task) => task.status !== "active")
    .map((task) => normalizeEvent({
      taskId: task.id,
      taskTitle: task.title,
      kind: task.kind,
      date: task.completedDate || task.abandonedDate || task.originDate,
      action: task.status === "completed" ? "imported-completed" : "imported-abandoned",
      detail: "Imported from earlier study system"
    }));

  return next;
}

function idbOpen(dbName = DB_NAME, version = DB_VERSION, storeName = STORE_NAME) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, version);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(storeName)) {
        request.result.createObjectStore(storeName);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function idbGet(key) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const request = tx.objectStore(STORE_NAME).get(key);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
  });
}

async function idbSet(key, value) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(value, key);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => reject(tx.error);
  });
}

async function idbDelete(key) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(key);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => reject(tx.error);
  });
}

async function loadLegacyState() {
  try {
    const db = await idbOpen("plannerDB", 1, "store");
    return await new Promise((resolve) => {
      const tx = db.transaction("store", "readonly");
      const request = tx.objectStore("store").get("app");
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => resolve(null);
      tx.oncomplete = () => db.close();
    });
  } catch (error) {
    return null;
  }
}

function commit(mutator) {
  mutator(state);
  state.updatedAt = new Date().toISOString();
  renderAll();
  queueSave();
}

function queueSave() {
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(async () => {
    try {
      await idbSet(STATE_KEY, state);
      setStorageStatus(`Saved locally at ${formatClock(new Date())}.`);
    } catch (error) {
      console.error(error);
      setStorageStatus("Save failed. Export a backup before closing.");
    }
  }, 180);
}

function setStorageStatus(text) {
  if (els.storageStatus) els.storageStatus.textContent = text;
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  els.themeSelect.value = theme;
  const metaTheme = document.querySelector('meta[name="theme-color"]');
  const themeColors = {
    lilac: "#f7f3fb",
    graphite: "#f4f5f6",
    mint: "#eff8f5",
    rose: "#fbf2f4"
  };
  if (metaTheme) metaTheme.setAttribute("content", themeColors[theme] || themeColors.lilac);
}

function renderAll() {
  applyTheme(state.theme);
  updateDateField();
  updateTimerDisplay();
  renderTabs();
  renderPlanner();
  renderHistory();
  renderInsights();
}

function renderTabs() {
  views.forEach((view) => {
    const section = document.getElementById(`${view}View`);
    if (section) section.classList.toggle("is-active", view === activeView);
  });
  document.querySelectorAll(".tab-button").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.view === activeView);
  });
}

function switchView(view) {
  if (!views.includes(view)) return;
  activeView = view;
  renderTabs();
  if (view === "planner") window.setTimeout(() => scrollTodayIntoView(false), 40);
  if (view === "notes") {
    hydrateNotes();
    hydrateDrawing();
  }
}

function updateDateField() {
  const isOnce = els.taskKind.value === "once";
  els.dateField.classList.toggle("hidden", !isOnce);
  els.taskDate.min = todayKey();
  if (!els.taskDate.value) els.taskDate.value = todayKey();
}

function handleTaskSubmit(event) {
  event.preventDefault();
  setTaskFeedback("");
  const title = els.taskTitle.value.trim();
  if (!title) {
    els.taskTitle.focus();
    return;
  }

  const kind = els.taskKind.value;
  const chosenDate = els.taskDate.value || todayKey();
  const now = new Date().toISOString();

  if (kind === "once" && chosenDate < todayKey()) {
    setTaskFeedback("Past days are read-only. Pick today or a future date.");
    els.taskDate.value = todayKey();
    els.taskDate.focus();
    return;
  }

  commit((draft) => {
    if (kind === "once") {
      draft.tasks.push(normalizeTask({
        id: makeId("task"),
        kind: "once",
        title,
        createdAt: now,
        originDate: todayKey(),
        scheduledDate: chosenDate,
        status: "active"
      }));
    } else {
      draft.tasks.push(normalizeTask({
        id: makeId("task"),
        kind: "review",
        title,
        createdAt: now,
        originDate: todayKey(),
        status: "active",
        review: {
          nextReviewDate: todayKey(),
          repetitions: 0,
          ease: 2.5,
          interval: 0,
          frozen: false
        }
      }));
    }
  });

  els.taskTitle.value = "";
  els.taskTitle.focus();
}

function setTaskFeedback(message) {
  if (els.taskFeedback) els.taskFeedback.textContent = message;
}

function renderPlanner() {
  const today = todayKey();
  const stats = calculateStats();
  els.todaySummary.textContent = `${stats.dueNow} due now, ${formatHours(totalStudySeconds())} total`;

  els.statGrid.innerHTML = [
    statMarkup("Active", stats.active),
    statMarkup("Due now", stats.dueNow),
    statMarkup("Overdue", stats.overdue),
    statMarkup("Done", stats.completed)
  ].join("");

  renderDueQueue();
  renderCalendar(today);
}

function renderDueQueue() {
  const due = getDueNowTasks();
  els.queueCount.textContent = due.length ? `${due.length} item${due.length === 1 ? "" : "s"}` : "Clear";
  if (!due.length) {
    els.dueQueue.innerHTML = `<div class="empty-copy">Nothing is waiting right now.</div>`;
    return;
  }
  els.dueQueue.innerHTML = due.map((task) => taskRowMarkup(task, { compact: false })).join("");
}

function renderCalendar(today) {
  const previousScrollLeft = els.calendarScroller.scrollLeft;
  const start = addDays(parseDateKey(today), -365);
  const days = Array.from({ length: 731 }, (_, index) => addDays(start, index));
  els.calendarScroller.innerHTML = days.map((day) => dayColumnMarkup(dateKey(day), today)).join("");

  if (!hasScrolledToToday && activeView === "planner") {
    hasScrolledToToday = true;
    window.setTimeout(() => scrollTodayIntoView(false), 40);
  } else {
    els.calendarScroller.scrollLeft = previousScrollLeft;
  }
}

function dayColumnMarkup(key, today) {
  const date = parseDateKey(key);
  const isToday = key === today;
  const isPast = key < today;
  const dueTasks = getTasksForDate(key);
  const events = getEventsForDate(key);
  const study = state.studyByDate[key] || 0;
  const title = isToday ? "Today" : isPast ? "Past" : "Future";
  const planButton = isPast
    ? `<button type="button" class="ghost-button plan-date-button" disabled>Read only</button>`
    : `<button type="button" class="ghost-button plan-date-button" data-action="plan-date" data-date="${escapeHtml(key)}">Plan here</button>`;

  const dueMarkup = dueTasks.length
    ? dueTasks.map((task) => dayTaskMarkup(task, key)).join("")
    : `<div class="empty-copy">No planned work.</div>`;
  const eventMarkup = events.length
    ? events.map(dayEventMarkup).join("")
    : `<div class="empty-copy">No completions logged.</div>`;

  return `
    <article class="day-column ${isToday ? "is-today" : ""}" data-date="${escapeHtml(key)}">
      <div class="day-header">
        <div class="day-header-top">
          <div>
            <div class="day-name">${escapeHtml(formatWeekday(date))}</div>
            <div class="day-date">${escapeHtml(formatMonthDay(date))}</div>
          </div>
          <span class="status-tag ${isToday ? "waiting" : isPast ? "done" : "waiting"}">${title}</span>
        </div>
        ${planButton}
      </div>
      <div class="day-block">
        <h4>Due</h4>
        ${dueMarkup}
      </div>
      <div class="day-block">
        <h4>Done</h4>
        ${eventMarkup}
      </div>
      ${study ? `<div class="day-block"><h4>Focus</h4><div class="empty-copy">${formatHours(study)}</div></div>` : ""}
    </article>
  `;
}

function dayTaskMarkup(task, key) {
  const meta = taskMeta(task, key);
  const typeClass = task.kind === "review" ? "review" : "once";
  const label = task.kind === "review" ? "Revision" : "One-time";
  const doneTag = task.status === "completed" ? `<span class="status-tag done">Done</span>` : "";
  const missedTag = meta.overdueDays > 0 ? `<span class="status-tag missed">${meta.overdueDays}d late</span>` : "";
  const actions = task.status === "active" ? actionButtons(task) : "";

  return `
    <div class="day-task">
      <div class="tag-line">
        <span class="type-tag ${typeClass}">${label}</span>
        ${doneTag}
        ${missedTag}
      </div>
      <strong>${escapeHtml(task.title)}</strong>
      <div class="task-meta">${escapeHtml(meta.text)}</div>
      ${actions ? `<div class="day-actions">${actions}</div>` : ""}
    </div>
  `;
}

function dayEventMarkup(event) {
  const typeClass = event.kind === "review" ? "review" : "once";
  const label = event.kind === "review" ? "Revision" : "One-time";
  return `
    <div class="day-event">
      <div class="tag-line">
        <span class="type-tag ${typeClass}">${label}</span>
        <span class="status-tag done">${escapeHtml(actionLabel(event.action))}</span>
      </div>
      <strong>${escapeHtml(event.taskTitle)}</strong>
      ${event.detail ? `<div class="history-meta">${escapeHtml(event.detail)}</div>` : ""}
    </div>
  `;
}

function taskRowMarkup(task) {
  const meta = taskMeta(task, todayKey());
  const typeClass = task.kind === "review" ? "review" : "once";
  const label = task.kind === "review" ? "Revision" : "One-time";
  const overdue = meta.overdueDays > 0 ? `<span class="status-tag missed">${meta.overdueDays}d late</span>` : "";
  return `
    <div class="task-row" data-task-id="${escapeHtml(task.id)}">
      <div class="task-main">
        <div class="tag-line">
          <span class="type-tag ${typeClass}">${label}</span>
          ${overdue}
        </div>
        <strong>${escapeHtml(task.title)}</strong>
        <div class="task-meta">${escapeHtml(meta.text)}</div>
      </div>
      <div class="task-actions">${actionButtons(task)}</div>
    </div>
  `;
}

function actionButtons(task) {
  if (task.kind === "once") {
    return `
      <button type="button" class="task-action good" data-action="complete-once" data-task-id="${escapeHtml(task.id)}">Done</button>
      <button type="button" class="task-action skip" data-action="abandon" data-task-id="${escapeHtml(task.id)}">Skip</button>
    `;
  }

  return `
    <button type="button" class="task-action good" data-action="review-good" data-task-id="${escapeHtml(task.id)}">Done</button>
    <button type="button" class="task-action again" data-action="review-again" data-task-id="${escapeHtml(task.id)}">Again</button>
    <button type="button" class="task-action finish" data-action="finish-review" data-task-id="${escapeHtml(task.id)}">Finish</button>
  `;
}

function handleCalendarClick(event) {
  const button = event.target.closest("button");
  if (!button) return;

  if (button.dataset.action === "plan-date") {
    if (button.dataset.date < todayKey()) {
      setTaskFeedback("Past days are read-only. Pick today or a future date.");
      return;
    }
    els.taskKind.value = "once";
    els.taskDate.value = button.dataset.date;
    updateDateField();
    els.taskTitle.focus();
    return;
  }

  handleTaskActionClick(event);
}

function handleTaskActionClick(event) {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const taskId = button.dataset.taskId;
  const action = button.dataset.action;
  if (!taskId) return;

  if (action === "complete-once") completeOnce(taskId);
  if (action === "abandon") abandonTask(taskId);
  if (action === "review-good") completeReview(taskId, "good");
  if (action === "review-again") completeReview(taskId, "again");
  if (action === "finish-review") finishReview(taskId);
}

function completeOnce(taskId) {
  commit((draft) => {
    const task = draft.tasks.find((item) => item.id === taskId && item.kind === "once");
    if (!task || task.status !== "active") return;
    task.status = "completed";
    task.completedDate = todayKey();
    draft.events.push(normalizeEvent({
      taskId: task.id,
      taskTitle: task.title,
      kind: "once",
      date: todayKey(),
      action: "completed",
      detail: task.scheduledDate === todayKey() ? "Completed on schedule" : `Scheduled for ${formatShortDate(parseDateKey(task.scheduledDate))}`
    }));
  });
}

function abandonTask(taskId) {
  commit((draft) => {
    const task = draft.tasks.find((item) => item.id === taskId);
    if (!task || task.status !== "active") return;
    task.status = "abandoned";
    task.abandonedDate = todayKey();
    if (task.review) task.review.frozen = true;
    draft.events.push(normalizeEvent({
      taskId: task.id,
      taskTitle: task.title,
      kind: task.kind,
      date: todayKey(),
      action: "abandoned",
      detail: "Skipped"
    }));
  });
}

function completeReview(taskId, rating) {
  commit((draft) => {
    const task = draft.tasks.find((item) => item.id === taskId && item.kind === "review");
    if (!task || task.status !== "active") return;

    const before = task.review.repetitions || 0;
    task.review = scheduleReview(task.review, rating, todayKey());
    const after = task.review.repetitions || 0;
    const action = rating === "again" ? "again" : "reviewed";
    const detail = rating === "again"
      ? "Repeat again today"
      : `Rep ${before} to ${after}. Next ${formatShortDate(parseDateKey(task.review.nextReviewDate))}`;

    draft.events.push(normalizeEvent({
      taskId: task.id,
      taskTitle: task.title,
      kind: "review",
      date: todayKey(),
      action,
      detail,
      nextReviewDate: task.review.nextReviewDate
    }));
  });
}

function finishReview(taskId) {
  commit((draft) => {
    const task = draft.tasks.find((item) => item.id === taskId && item.kind === "review");
    if (!task || task.status !== "active") return;
    task.status = "completed";
    task.completedDate = todayKey();
    task.review.frozen = true;
    draft.events.push(normalizeEvent({
      taskId: task.id,
      taskTitle: task.title,
      kind: "review",
      date: todayKey(),
      action: "completed",
      detail: "Revision completed"
    }));
  });
}

function scheduleReview(review, rating, baseKey) {
  let ease = Number(review.ease) || 2.5;
  let repetitions = Number(review.repetitions) || 0;
  let interval = Number(review.interval) || 0;

  if (rating === "again") {
    ease = Math.max(1.3, ease - 0.2);
    repetitions = 0;
    interval = 0;
    return {
      ...review,
      ease,
      repetitions,
      interval,
      nextReviewDate: baseKey,
      frozen: false
    };
  }

  repetitions += 1;
  if (repetitions === 1) interval = 1;
  else if (repetitions === 2) interval = 6;
  else interval = Math.max(1, Math.round(Math.max(interval, 1) * ease));
  ease = Math.min(3.2, ease + 0.04);

  return {
    ...review,
    ease,
    repetitions,
    interval,
    nextReviewDate: dateKey(addDays(parseDateKey(baseKey), interval)),
    frozen: false
  };
}

function getDueNowTasks() {
  const today = todayKey();
  return state.tasks
    .filter((task) => task.status === "active")
    .filter((task) => {
      if (task.kind === "once") return task.scheduledDate <= today;
      return !task.review.frozen && task.review.nextReviewDate <= today;
    })
    .sort(compareTasksByDueDate);
}

function getTasksForDate(key) {
  const today = todayKey();
  return state.tasks
    .filter((task) => {
      if (task.kind === "once") {
        if (task.status !== "active") return false;
        if (task.scheduledDate < today) return key === today;
        return task.scheduledDate === key;
      }
      if (task.status !== "active" || task.review.frozen) return false;
      if (key === today) return task.review.nextReviewDate <= today;
      return task.review.nextReviewDate === key;
    })
    .sort(compareTasksByDueDate);
}

function getEventsForDate(key) {
  return state.events
    .filter((event) => event.date === key)
    .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
}

function compareTasksByDueDate(a, b) {
  return dueDateForTask(a).localeCompare(dueDateForTask(b)) || a.title.localeCompare(b.title);
}

function dueDateForTask(task) {
  return task.kind === "once" ? task.scheduledDate : task.review.nextReviewDate;
}

function taskMeta(task, contextKey) {
  const today = todayKey();
  const due = dueDateForTask(task);
  const overdueDays = task.status === "active" && due < today ? diffDays(parseDateKey(due), parseDateKey(today)) : 0;

  if (task.kind === "once") {
    if (task.status === "completed") {
      return { overdueDays: 0, text: `Done ${formatShortDate(parseDateKey(task.completedDate || today))}` };
    }
    if (task.status === "abandoned") {
      return { overdueDays: 0, text: `Skipped ${formatShortDate(parseDateKey(task.abandonedDate || today))}` };
    }
    if (overdueDays > 0 && contextKey === today) {
      return { overdueDays, text: `Scheduled ${formatShortDate(parseDateKey(due))}` };
    }
    return { overdueDays, text: `Scheduled ${formatShortDate(parseDateKey(due))}` };
  }

  const reps = task.review.repetitions || 0;
  if (task.status === "completed") {
    return { overdueDays: 0, text: `Finished after ${reps} rep${reps === 1 ? "" : "s"}` };
  }
  if (task.status === "abandoned") {
    return { overdueDays: 0, text: "Skipped" };
  }
  if (overdueDays > 0 && contextKey === today) {
    return { overdueDays, text: `Rep ${reps}. Due ${formatShortDate(parseDateKey(due))}` };
  }
  return { overdueDays, text: `Rep ${reps}. Due ${formatShortDate(parseDateKey(due))}` };
}

function calculateStats() {
  const dueNow = getDueNowTasks();
  return {
    active: state.tasks.filter((task) => task.status === "active").length,
    dueNow: dueNow.length,
    overdue: dueNow.filter((task) => dueDateForTask(task) < todayKey()).length,
    completed: state.tasks.filter((task) => task.status === "completed").length
  };
}

function renderHistory() {
  const start = parseDateKey(todayKey());
  const days = Array.from({ length: historyRange }, (_, index) => dateKey(addDays(start, -index)));
  els.historyList.innerHTML = days.map((key) => {
    const events = getEventsForDate(key);
    const focus = state.studyByDate[key] || 0;
    const scheduled = state.tasks.filter((task) => task.kind === "once" && task.scheduledDate === key);
    const plannedMarkup = scheduled.length
      ? scheduled.map((task) => `<div class="history-row"><strong>${escapeHtml(task.title)}</strong><div class="history-meta">One-time task planned for this day. ${escapeHtml(statusText(task))}</div></div>`).join("")
      : "";
    const eventMarkup = events.length
      ? events.map((event) => `
        <div class="history-row">
          <div class="tag-line">
            <span class="type-tag ${event.kind === "review" ? "review" : "once"}">${event.kind === "review" ? "Revision" : "One-time"}</span>
            <span class="status-tag done">${escapeHtml(actionLabel(event.action))}</span>
          </div>
          <strong>${escapeHtml(event.taskTitle)}</strong>
          ${event.detail ? `<div class="history-meta">${escapeHtml(event.detail)}</div>` : ""}
        </div>
      `).join("")
      : "";
    const body = [eventMarkup, plannedMarkup].filter(Boolean).join("") || `<div class="empty-copy">No study activity logged.</div>`;

    return `
      <article class="history-day">
        <div class="history-day-header">
          <h3>${escapeHtml(formatFullDate(parseDateKey(key)))}</h3>
          <span class="history-meta">${focus ? formatHours(focus) : "0.00h"}</span>
        </div>
        ${body}
      </article>
    `;
  }).join("");
}

function renderInsights() {
  const stats = calculateStats();
  const activeReviews = state.tasks.filter((task) => task.kind === "review" && task.status === "active").length;
  const activeOnce = state.tasks.filter((task) => task.kind === "once" && task.status === "active").length;

  els.insightGrid.innerHTML = [
    statMarkup("Study time", formatHours(totalStudySeconds())),
    statMarkup("Review topics", activeReviews),
    statMarkup("One-time active", activeOnce),
    statMarkup("Overdue", stats.overdue)
  ].join("");

  const chartDays = Array.from({ length: 30 }, (_, index) => {
    const key = dateKey(addDays(parseDateKey(todayKey()), index - 29));
    return { key, seconds: state.studyByDate[key] || 0 };
  });
  const maxSeconds = Math.max(1, ...chartDays.map((item) => item.seconds));
  const total = chartDays.reduce((sum, item) => sum + item.seconds, 0);
  els.chartTotal.textContent = formatHours(total);
  els.studyChart.innerHTML = chartDays.map((item) => {
    const height = Math.max(6, Math.round((item.seconds / maxSeconds) * 160));
    return `<div class="chart-bar" style="height:${height}px" title="${escapeHtml(formatShortDate(parseDateKey(item.key)))}: ${formatHours(item.seconds)}"><span>${parseDateKey(item.key).getDate()}</span></div>`;
  }).join("");

  const completed = state.tasks.filter((task) => task.status === "completed").sort((a, b) => (b.completedDate || "").localeCompare(a.completedDate || ""));
  els.completedCount.textContent = `${completed.length} item${completed.length === 1 ? "" : "s"}`;
  els.completedList.innerHTML = completed.length
    ? completed.slice(0, 40).map((task) => `
      <div class="history-row">
        <div class="tag-line">
          <span class="type-tag ${task.kind === "review" ? "review" : "once"}">${task.kind === "review" ? "Revision" : "One-time"}</span>
          <span class="status-tag done">Done</span>
        </div>
        <strong>${escapeHtml(task.title)}</strong>
        <div class="history-meta">${escapeHtml(formatShortDate(parseDateKey(task.completedDate || task.originDate)))}</div>
      </div>
    `).join("")
    : `<div class="empty-copy">Completed tasks will collect here.</div>`;
}

function statusText(task) {
  if (task.status === "completed") return `Done ${formatShortDate(parseDateKey(task.completedDate || task.scheduledDate))}.`;
  if (task.status === "abandoned") return `Skipped ${formatShortDate(parseDateKey(task.abandonedDate || task.scheduledDate))}.`;
  if (task.scheduledDate < todayKey()) return "Still overdue.";
  return "Still active.";
}

function statMarkup(label, value) {
  return `<div class="stat-item"><span>${escapeHtml(label)}</span><strong>${escapeHtml(String(value))}</strong></div>`;
}

function handleCalendarWheel(event) {
  if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
  event.preventDefault();
  els.calendarScroller.scrollBy({ left: event.deltaY, behavior: "auto" });
}

function scrollCalendarBy(direction) {
  const distance = Math.max(260, Math.round(els.calendarScroller.clientWidth * 0.85));
  els.calendarScroller.scrollBy({ left: direction * distance, behavior: "smooth" });
}

function scrollTodayIntoView(smooth) {
  const todayColumn = els.calendarScroller.querySelector(`[data-date="${todayKey()}"]`);
  if (todayColumn) todayColumn.scrollIntoView({ inline: "center", block: "nearest", behavior: smooth ? "smooth" : "auto" });
}

function toggleTimer() {
  const started = currentTimerStart();
  if (started) stopTimer(started);
  else startTimer();
}

function startTimer() {
  localStorage.setItem(TIMER_KEY, String(Date.now()));
  updateTimerDisplay();
}

function stopTimer(started) {
  const ended = Date.now();
  localStorage.removeItem(TIMER_KEY);
  const segments = splitSessionByDay(started, ended);
  commit((draft) => {
    Object.entries(segments).forEach(([key, seconds]) => {
      draft.studyByDate[key] = (draft.studyByDate[key] || 0) + seconds;
    });
  });
  updateTimerDisplay();
}

function startTimerTicker() {
  clearInterval(timerInterval);
  timerInterval = window.setInterval(updateTimerDisplay, 1000);
  updateTimerDisplay();
}

function updateTimerDisplay() {
  const started = currentTimerStart();
  const elapsed = started ? Math.floor((Date.now() - started) / 1000) : 0;
  els.timerNow.textContent = formatDuration(elapsed);
  els.timerTotal.textContent = `Total ${formatHours(totalStudySeconds() + elapsed)}`;
  els.timerToggle.textContent = started ? "Stop" : "Start";
  els.timerToggle.classList.toggle("danger-button", Boolean(started));
  els.timerToggle.classList.toggle("primary-button", !started);
}

function currentTimerStart() {
  const value = Number(localStorage.getItem(TIMER_KEY) || 0);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function splitSessionByDay(startMs, endMs) {
  const result = {};
  let cursor = startMs;

  while (cursor < endMs) {
    const date = new Date(cursor);
    const nextMidnight = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1).getTime();
    const segmentEnd = Math.min(endMs, nextMidnight);
    const seconds = Math.max(0, Math.floor((segmentEnd - cursor) / 1000));
    const key = dateKey(date);
    result[key] = (result[key] || 0) + seconds;
    cursor = segmentEnd;
  }

  return result;
}

function totalStudySeconds() {
  return Object.values(state.studyByDate || {}).reduce((sum, value) => sum + Number(value || 0), 0);
}

function hydrateNotes() {
  if (document.activeElement === els.notesEditor) return;
  if (els.notesEditor.innerHTML !== state.notesHtml) {
    els.notesEditor.innerHTML = state.notesHtml || "";
  }
}

function formatNote(command, value = null) {
  els.notesEditor.focus();
  document.execCommand(command, false, value);
  state.notesHtml = els.notesEditor.innerHTML;
  queueSave();
}

function addNoteLink() {
  const url = window.prompt("Paste a link");
  if (!url) return;
  formatNote("createLink", url);
}

function handleNoteImage(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = () => {
    els.notesEditor.focus();
    document.execCommand("insertImage", false, reader.result);
    state.notesHtml = els.notesEditor.innerHTML;
    queueSave();
  };
  reader.readAsDataURL(file);
  event.target.value = "";
}

function bindCanvasEvents() {
  const canvas = els.drawingCanvas;
  canvas.addEventListener("pointerdown", startDrawing);
  canvas.addEventListener("pointermove", drawLine);
  canvas.addEventListener("pointerup", stopDrawing);
  canvas.addEventListener("pointercancel", stopDrawing);
  canvas.addEventListener("pointerleave", stopDrawing);
}

function hydrateDrawing() {
  const canvas = els.drawingCanvas;
  const context = canvas.getContext("2d");
  context.clearRect(0, 0, canvas.width, canvas.height);
  if (!state.drawingData) return;

  const image = new Image();
  image.onload = () => {
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
  };
  image.src = state.drawingData;
}

function startDrawing(event) {
  drawingActive = true;
  lastPoint = canvasPoint(event);
  els.drawingCanvas.setPointerCapture(event.pointerId);
}

function drawLine(event) {
  if (!drawingActive || !lastPoint) return;
  const point = canvasPoint(event);
  const context = els.drawingCanvas.getContext("2d");
  context.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue("--ink").trim() || "#24212b";
  context.lineWidth = 3;
  context.lineCap = "round";
  context.lineJoin = "round";
  context.beginPath();
  context.moveTo(lastPoint.x, lastPoint.y);
  context.lineTo(point.x, point.y);
  context.stroke();
  lastPoint = point;
}

function stopDrawing() {
  if (!drawingActive) return;
  drawingActive = false;
  lastPoint = null;
  state.drawingData = els.drawingCanvas.toDataURL("image/png");
  queueSave();
}

function clearDrawing() {
  const context = els.drawingCanvas.getContext("2d");
  context.clearRect(0, 0, els.drawingCanvas.width, els.drawingCanvas.height);
  state.drawingData = "";
  queueSave();
}

function canvasPoint(event) {
  const rect = els.drawingCanvas.getBoundingClientRect();
  const scaleX = els.drawingCanvas.width / rect.width;
  const scaleY = els.drawingCanvas.height / rect.height;
  return {
    x: (event.clientX - rect.left) * scaleX,
    y: (event.clientY - rect.top) * scaleY
  };
}

function exportData() {
  const data = JSON.stringify({ ...state, exportedAt: new Date().toISOString() }, null, 2);
  const blob = new Blob([data], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `lilac-study-backup-${todayKey()}.json`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function importData(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const imported = JSON.parse(String(reader.result || "{}"));
      state = migrateState(imported);
      renderAll();
      hydrateNotes();
      hydrateDrawing();
      queueSave();
      setStorageStatus("Imported backup and saved locally.");
    } catch (error) {
      console.error(error);
      setStorageStatus("Import failed. Choose a Lilac Study JSON backup.");
    }
  };
  reader.readAsText(file);
  event.target.value = "";
}

async function resetData() {
  const confirmed = window.confirm("Reset all local study data on this device?");
  if (!confirmed) return;
  localStorage.removeItem(TIMER_KEY);
  state = createDefaultState();
  await idbDelete(STATE_KEY);
  await idbSet(STATE_KEY, state);
  hasScrolledToToday = false;
  renderAll();
  hydrateNotes();
  hydrateDrawing();
  setStorageStatus("Local data reset.");
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  try {
    await navigator.serviceWorker.register("./sw.js");
  } catch (error) {
    console.warn("Service worker registration failed", error);
  }
}

function actionLabel(action) {
  const labels = {
    completed: "Done",
    reviewed: "Reviewed",
    again: "Again",
    abandoned: "Skipped",
    "imported-completed": "Imported",
    "imported-abandoned": "Imported"
  };
  return labels[action] || "Done";
}

function makeId(prefix) {
  if (window.crypto && window.crypto.randomUUID) return `${prefix}-${window.crypto.randomUUID()}`;
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function todayKey() {
  return dateKey(new Date());
}

function dateKey(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function parseDateKey(key) {
  const [year, month, day] = String(key || todayKey()).split("-").map(Number);
  return new Date(year, (month || 1) - 1, day || 1);
}

function keyFromUnknownDate(value) {
  if (!value) return todayKey();
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return String(value);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return todayKey();
  return dateKey(parsed);
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function diffDays(from, to) {
  const start = new Date(from.getFullYear(), from.getMonth(), from.getDate()).getTime();
  const end = new Date(to.getFullYear(), to.getMonth(), to.getDate()).getTime();
  return Math.round((end - start) / 86400000);
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function formatDuration(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  return `${hours}:${pad(minutes)}:${pad(rest)}`;
}

function formatHours(seconds) {
  return `${(Number(seconds || 0) / 3600).toFixed(2)}h`;
}

function formatWeekday(date) {
  return date.toLocaleDateString(undefined, { weekday: "short" });
}

function formatMonthDay(date) {
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatShortDate(date) {
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatFullDate(date) {
  return date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}

function formatClock(date) {
  return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

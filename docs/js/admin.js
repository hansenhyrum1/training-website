import {
  auth,
  db,
  defaultDb,
  collection,
  doc,
  getDoc,
  getDocs,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  orderBy,
  limit,
  startAfter,
  where,
  serverTimestamp,
} from "./firebase.js";
import { requireAuth, wireSignOut } from "./auth.js";

const adminGuard = document.querySelector("#admin-guard");
const tabButtons = document.querySelectorAll(".tab-button");
const tabPanels = document.querySelectorAll(".tab-panel");

const sectionStatusText = document.querySelector("#section-status-text");
const sectionList = document.querySelector("#section-list");
const newSectionBtn = document.querySelector("#new-section");
const newModuleBtn = document.querySelector("#new-module");
const contractList = document.querySelector("#contract-list");

const adminForm = document.querySelector("#admin-form");
const adminStatus = document.querySelector("#admin-status");
const adminList = document.querySelector("#admin-list");
const userSearch = document.querySelector("#user-search");
const userResults = document.querySelector("#user-results");
const refreshUsers = document.querySelector("#refresh-users");
const addAdminToggle = document.querySelector("#add-admin-toggle");

const progressSearch = document.querySelector("#progress-search");
const progressUserList = document.querySelector("#progress-user-list");
const progressDetail = document.querySelector("#progress-detail");
const progressUserTitle = document.querySelector("#progress-user-title");
const progressSort = document.querySelector("#progress-sort");
const progressFilter = document.querySelector("#progress-filter");

let sections = [];
let modules = [];
let users = [];
const progressSummaryByUser = new Map();
let progressRenderToken = 0;
let draggedSectionId = null;
let draggedModuleId = null;
let draggedModuleSectionId = null;

const USER_PAGE_SIZE = 200;
let userCursor = null;
let loadingUsers = false;
let userHasMore = false;

wireSignOut("#sign-out");

function setStatus(el, message, isError = false) {
  if (!el) return;
  el.textContent = message;
  el.style.color = isError ? "#b54747" : "#4a4a44";
}

function showTab(tabId) {
  tabButtons.forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.tab === tabId);
  });
  tabPanels.forEach((panel) => {
    panel.classList.toggle("hidden", panel.id !== `tab-${tabId}`);
  });
}

function initTabs() {
  tabButtons.forEach((btn) => {
    btn.addEventListener("click", () => showTab(btn.dataset.tab));
  });
}

function statusLabel(status) {
  return status === "published" ? "Published" : "Unpublished";
}

function promptSectionData(initial = {}) {
  const title = window.prompt("Section title", initial.title || "");
  if (!title) return null;
  const summary = window.prompt("Section summary (optional)", initial.summary || "") || "";
  return {
    title: title.trim(),
    summary: summary.trim(),
    order: Number.isFinite(initial.order) ? initial.order : 0,
  };
}

function renderModuleRow(module) {
  const row = document.createElement("div");
  row.className = "module-row";
  row.dataset.moduleId = module.id;
  row.dataset.sectionId = module.sectionId || "";
  row.setAttribute("draggable", "true");
  const typeLabel = module.type === "quiz" ? "Quiz" : module.type === "contract" ? "Contract" : "Page";
  const statusClass = module.status === "published" ? "badge-success" : "badge-danger";
  row.innerHTML = `
    <div class="module-info">
      <strong>${module.title || "Untitled module"}</strong>
      <div class="module-meta">
        <span class="badge">${typeLabel}</span>
        <span class="badge ${statusClass}">${statusLabel(module.status)}</span>
      </div>
    </div>
    <div class="actions">
      <button class="secondary" data-action="toggle">${module.status === "published" ? "Unpublish" : "Publish"}</button>
      <button class="secondary" data-action="edit">Edit</button>
      <button class="danger" data-action="delete">Delete</button>
    </div>
  `;

  row.querySelector("[data-action='toggle']").addEventListener("click", async () => {
    await updateDoc(doc(db, "modules", module.id), {
      status: module.status === "published" ? "draft" : "published",
      updatedAt: serverTimestamp(),
    });
    await loadModules();
    renderSections();
  });

  row.querySelector("[data-action='edit']").addEventListener("click", () => {
    window.location.href = `./admin-module.html?id=${module.id}`;
  });

  row.querySelector("[data-action='delete']").addEventListener("click", async () => {
    const confirmed = window.confirm("Delete this module?");
    if (!confirmed) return;
    await deleteDoc(doc(db, "modules", module.id));
    await loadModules();
    renderSections();
  });

  return row;
}

function renderContracts() {
  if (!contractList) return;
  contractList.innerHTML = "";
  const contracts = modules.filter((module) => module.type === "contract");
  if (!contracts.length) {
    contractList.innerHTML = "<p class=\"status\">No contracts yet.</p>";
    return;
  }

  contracts.forEach((contract) => {
    const section = sections.find((s) => s.id === contract.sectionId);
    const card = document.createElement("div");
    card.className = "section-admin";
    card.innerHTML = `
      <div class="section-admin-header">
        <div>
          <h3>${contract.title || "Untitled contract"}</h3>
          <p class="status">${section ? section.title : "No section"} · ${statusLabel(contract.status)}</p>
        </div>
        <div class="section-admin-actions">
          <button class="secondary" data-action="toggle">Toggle users</button>
          <a class="secondary" target="_blank" rel="noopener" href="./contract-print.html?contractId=${contract.id}&mode=roster">Print roster</a>
        </div>
      </div>
      <div class="contract-users hidden"></div>
    `;

    const usersWrap = card.querySelector(".contract-users");
    card.querySelector("[data-action='toggle']").addEventListener("click", async () => {
      usersWrap.classList.toggle("hidden");
      if (!usersWrap.dataset.loaded) {
        usersWrap.innerHTML = "<p class=\"status\">Loading users…</p>";
        const rows = await buildContractUserRows(contract);
        usersWrap.innerHTML = "";
        rows.forEach((row) => usersWrap.appendChild(row));
        usersWrap.dataset.loaded = "true";
      }
    });

    contractList.appendChild(card);
  });
}

async function buildContractUserRows(contract) {
  const rows = [];
  const userRows = users.length ? users : [];
  if (!userRows.length) {
    const empty = document.createElement("p");
    empty.className = "status";
    empty.textContent = "No users found.";
    return [empty];
  }

  const progressDocs = await Promise.all(
    userRows.map((user) => getDoc(doc(db, "progress", user.uid, "modules", contract.id)))
  );

  userRows.forEach((user, index) => {
    const progressSnap = progressDocs[index];
    const progress = progressSnap.exists() ? progressSnap.data() : null;
    const signed = progress?.status === "completed";
    const signedAt = progress?.signedAt?.toDate ? progress.signedAt.toDate() : null;
    const row = document.createElement("div");
    row.className = "module-row";
    row.innerHTML = `
      <div class="module-meta spaced">
        <strong>${user.fullName || user.email || "User"}</strong>
        <span class="status">${signed ? `Signed ${signedAt ? signedAt.toLocaleString() : ""}` : "Unsigned"}</span>
      </div>
      <div class="actions">
        <a class="secondary" target="_blank" rel="noopener" href="./contract-print.html?contractId=${contract.id}&userId=${user.uid}">Print</a>
      </div>
    `;
    rows.push(row);
  });

  return rows;
}

function renderSectionCard(section, sectionModules) {
  const card = document.createElement("div");
  card.className = "section-admin";
  card.dataset.sectionId = section.id;
  const statusClass = section.status === "published" ? "badge-success" : "badge-danger";
  card.innerHTML = `
    <div class="section-admin-header">
      <div>
        <h3>${section.title || "Untitled"}</h3>
        <p class="status">${section.summary || ""}</p>
      </div>
      <div class="section-admin-actions">
        <span class="badge ${statusClass}">${statusLabel(section.status)}</span>
        ${section.status === "published"
          ? "<button class=\"secondary\" data-action=\"unpublish\">Unpublish</button>"
          : "<button class=\"secondary\" data-action=\"publish\">Publish</button>"}
        <button class="secondary" data-action="add-module">Add module</button>
        <button class="secondary" data-action="edit">Edit</button>
        <button class="danger" data-action="delete">Delete</button>
      </div>
    </div>
    <div class="section-modules"></div>
  `;

  const header = card.querySelector(".section-admin-header");
  header.setAttribute("draggable", "true");
  header.addEventListener("dragstart", (event) => {
    draggedSectionId = section.id;
    event.dataTransfer.effectAllowed = "move";
  });
  card.addEventListener("dragover", (event) => {
    event.preventDefault();
    card.classList.add("section-drop-target");
  });
  card.addEventListener("dragleave", () => {
    card.classList.remove("section-drop-target");
  });
  card.addEventListener("drop", async (event) => {
    event.preventDefault();
    card.classList.remove("section-drop-target");
    const targetId = card.dataset.sectionId;
    if (!draggedSectionId || !targetId || draggedSectionId === targetId) return;
    const next = sections.slice();
    const fromIndex = next.findIndex((s) => s.id === draggedSectionId);
    const toIndex = next.findIndex((s) => s.id === targetId);
    if (fromIndex === -1 || toIndex === -1) return;
    const [moved] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, moved);
    await Promise.all(next.map((s, index) => updateDoc(doc(db, "sections", s.id), {
      order: index,
      updatedAt: serverTimestamp(),
    })));
    await loadSections();
    renderSections();
  });

  const publishBtn = card.querySelector("[data-action='publish']");
  if (publishBtn) {
    publishBtn.addEventListener("click", async () => {
      await updateDoc(doc(db, "sections", section.id), {
        status: "published",
        updatedAt: serverTimestamp(),
      });
      await loadSections();
      renderSections();
    });
  }
  const unpublishBtn = card.querySelector("[data-action='unpublish']");
  if (unpublishBtn) {
    unpublishBtn.addEventListener("click", async () => {
      await updateDoc(doc(db, "sections", section.id), {
        status: "draft",
        updatedAt: serverTimestamp(),
      });
      await loadSections();
      renderSections();
    });
  }

  card.querySelector("[data-action='add-module']").addEventListener("click", () => {
    window.location.href = `./admin-module.html?sectionId=${section.id}`;
  });

  card.querySelector("[data-action='edit']").addEventListener("click", async () => {
    const next = promptSectionData({
      title: section.title || "",
      summary: section.summary || "",
      order: section.order ?? 0,
    });
    if (!next) return;
    await updateDoc(doc(db, "sections", section.id), {
      ...next,
      updatedAt: serverTimestamp(),
    });
    setStatus(sectionStatusText, "Section updated.");
    await loadSections();
    renderSections();
    showTab("content");
  });

  card.querySelector("[data-action='delete']").addEventListener("click", async () => {
    const confirmed = window.confirm("Delete this section? Modules will remain but be unassigned.");
    if (!confirmed) return;
    await deleteDoc(doc(db, "sections", section.id));
    await loadSections();
    renderSections();
  });

  const moduleWrap = card.querySelector(".section-modules");
  moduleWrap.dataset.sectionId = section.id;
  moduleWrap.addEventListener("dragover", (event) => {
    event.preventDefault();
    moduleWrap.classList.add("drop-target");
  });
  moduleWrap.addEventListener("dragleave", () => {
    moduleWrap.classList.remove("drop-target");
  });
  moduleWrap.addEventListener("drop", async (event) => {
    event.preventDefault();
    moduleWrap.classList.remove("drop-target");
    const targetSectionId = moduleWrap.dataset.sectionId || "";
    if (!draggedModuleId) return;
    const rows = [...moduleWrap.querySelectorAll(".module-row[data-module-id]")];
    const orderedIds = rows.map((row) => row.dataset.moduleId);
    await updateDoc(doc(db, "modules", draggedModuleId), {
      sectionId: targetSectionId || null,
      updatedAt: serverTimestamp(),
    });
    await Promise.all(orderedIds.map((id, index) => updateDoc(doc(db, "modules", id), {
      order: index,
      updatedAt: serverTimestamp(),
    })));
    await loadModules();
    renderSections();
  });
  if (!sectionModules.length) {
    moduleWrap.innerHTML = "<p class=\"status\">No modules in this section yet.</p>";
  } else {
    sectionModules.forEach((mod) => {
      const row = renderModuleRow(mod);
      row.addEventListener("dragstart", (event) => {
        draggedModuleId = mod.id;
        draggedModuleSectionId = mod.sectionId || "";
        event.dataTransfer.effectAllowed = "move";
      });
      moduleWrap.appendChild(row);
    });
  }

  sectionList.appendChild(card);
}

function renderUnassigned(modList) {
  const card = document.createElement("div");
  card.className = "section-admin";
  card.innerHTML = `
    <div class="section-admin-header">
      <div>
        <h3>Unassigned modules</h3>
        <p class="status">Modules without a section.</p>
      </div>
    </div>
    <div class="section-modules"></div>
  `;
  const moduleWrap = card.querySelector(".section-modules");
  moduleWrap.dataset.sectionId = "";
  moduleWrap.addEventListener("dragover", (event) => {
    event.preventDefault();
    moduleWrap.classList.add("drop-target");
  });
  moduleWrap.addEventListener("dragleave", () => {
    moduleWrap.classList.remove("drop-target");
  });
  moduleWrap.addEventListener("drop", async (event) => {
    event.preventDefault();
    moduleWrap.classList.remove("drop-target");
    if (!draggedModuleId) return;
    const rows = [...moduleWrap.querySelectorAll(".module-row[data-module-id]")];
    const orderedIds = rows.map((row) => row.dataset.moduleId);
    await updateDoc(doc(db, "modules", draggedModuleId), {
      sectionId: null,
      updatedAt: serverTimestamp(),
    });
    await Promise.all(orderedIds.map((id, index) => updateDoc(doc(db, "modules", id), {
      order: index,
      updatedAt: serverTimestamp(),
    })));
    await loadModules();
    renderSections();
  });
  modList.forEach((mod) => {
    const row = renderModuleRow(mod);
    row.addEventListener("dragstart", (event) => {
      draggedModuleId = mod.id;
      draggedModuleSectionId = mod.sectionId || "";
      event.dataTransfer.effectAllowed = "move";
    });
    moduleWrap.appendChild(row);
  });
  sectionList.appendChild(card);
}

function renderSections() {
  sectionList.innerHTML = "";
  if (!sections.length && !modules.length) {
    sectionList.innerHTML = "<p class=\"status\">No sections or modules yet.</p>";
    return;
  }

  const modulesBySection = new Map();
  sections.forEach((section) => modulesBySection.set(section.id, []));
  const unassigned = [];

  modules.forEach((mod) => {
    if (mod.sectionId && modulesBySection.has(mod.sectionId)) {
      modulesBySection.get(mod.sectionId).push(mod);
    } else {
      unassigned.push(mod);
    }
  });

  sections.forEach((section) => {
    renderSectionCard(section, modulesBySection.get(section.id) || []);
  });

  if (unassigned.length) {
    renderUnassigned(unassigned);
  }
}

async function loadSections() {
const snap = await getDocs(query(collection(db, "sections"), orderBy("order", "asc")));
  sections = snap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
  progressSummaryByUser.clear();
}

async function loadModules() {
  const snap = await getDocs(query(collection(db, "modules"), orderBy("order", "asc")));
  modules = snap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
  progressSummaryByUser.clear();
}

async function loadAdmins() {
  adminList.innerHTML = "";
  const snapshot = await getDocs(collection(db, "admins"));
  if (snapshot.empty) {
    adminList.innerHTML = "<p class=\"status\">No admins found.</p>";
    return;
  }

  snapshot.forEach((docSnap) => {
    const data = docSnap.data();
    const name = data.fullName || "";
    const label = name || data.email || "Admin";
    const sub = name && data.email ? data.email : "";
    const row = document.createElement("div");
    row.className = "user-row";
    row.innerHTML = `
      <div class="user-meta">
        <strong>${label}</strong>
        ${sub ? `<span>${sub}</span>` : ""}
        <span class="status">UID: ${docSnap.id}</span>
      </div>
      <button class="danger" data-action="remove">Remove</button>
    `;

    row.querySelector("[data-action='remove']").addEventListener("click", async () => {
      const confirmed = window.confirm("Remove this admin?");
      if (!confirmed) return;
      await deleteDoc(doc(db, "admins", docSnap.id));
      loadAdmins();
    });

    adminList.appendChild(row);
  });
}

function renderUserResults(targetEl, filterValue, onSelect) {
  const q = filterValue.trim().toLowerCase();
  const filtered = q
    ? users.filter((row) => {
        const name = (row.fullName || "").toLowerCase();
        const email = (row.email || "").toLowerCase();
        return name.includes(q) || email.includes(q);
      })
    : users.slice(0, 25);

  if (!filtered.length) {
    targetEl.innerHTML = "<p class=\"status\">No matches.</p>";
    return;
  }

  targetEl.innerHTML = "";
  filtered.forEach((row) => {
    const userRow = document.createElement("div");
    userRow.className = "user-row";
    userRow.innerHTML = `
      <div class="user-meta">
        <strong>${row.fullName || row.email || "User"}</strong>
        <span>${row.email || ""}</span>
        <span class="status">UID: ${row.uid}</span>
      </div>
      <button class="secondary" data-action="select">${onSelect.label}</button>
    `;

    userRow.querySelector("[data-action='select']").addEventListener("click", () => onSelect.action(row));
    targetEl.appendChild(userRow);
  });
}

function buildSectionModules() {
  const map = new Map();
  sections.forEach((section) => map.set(section.id, []));
  modules.forEach((module) => {
    if (module.sectionId && map.has(module.sectionId)) {
      map.get(module.sectionId).push(module);
    }
  });
  const sectionIds = [...map.entries()]
    .filter(([, mods]) => mods.length)
    .map(([id]) => id);
  return { map, sectionIds };
}

async function fetchProgressSummary(user) {
  if (progressSummaryByUser.has(user.uid)) {
    return progressSummaryByUser.get(user.uid);
  }
  const progressSnap = await getDocs(collection(db, "progress", user.uid, "modules"));
  const progressMap = {};
  progressSnap.forEach((docSnap) => {
    progressMap[docSnap.id] = docSnap.data();
  });

  const { map, sectionIds } = buildSectionModules();
  let completed = 0;
  let modulesCompleted = 0;
  let modulesTotal = 0;
  sectionIds.forEach((sectionId) => {
    const sectionModules = map.get(sectionId) || [];
    modulesTotal += sectionModules.length;
    sectionModules.forEach((module) => {
      if (progressMap[module.id]?.status === "completed") {
        modulesCompleted += 1;
      }
    });
    const isComplete = sectionModules.length
      ? sectionModules.every((module) => progressMap[module.id]?.status === "completed")
      : false;
    if (isComplete) completed += 1;
  });
  const summary = {
    completed,
    total: sectionIds.length,
    modulesCompleted,
    modulesTotal,
  };
  progressSummaryByUser.set(user.uid, summary);
  return summary;
}

async function renderProgressUsers() {
  const renderToken = ++progressRenderToken;
  const q = progressSearch.value.trim().toLowerCase();
  const filtered = q
    ? users.filter((row) => {
        const name = (row.fullName || "").toLowerCase();
        const email = (row.email || "").toLowerCase();
        return name.includes(q) || email.includes(q);
      })
    : users.slice(0, 25);

  if (!filtered.length) {
    progressUserList.innerHTML = "<p class=\"status\">No matches.</p>";
    return;
  }

  progressUserList.innerHTML = "<p class=\"status\">Loading progress…</p>";
  const summaries = await Promise.all(
    filtered.map((row) => fetchProgressSummary(row).catch(() => null))
  );
  if (renderToken !== progressRenderToken) return;

  let rows = filtered.map((row, index) => ({ row, summary: summaries[index] }));
  const filterValue = progressFilter?.value || "all";
  if (filterValue !== "all") {
    rows = rows.filter(({ summary }) => {
      if (!summary) return filterValue === "no_progress";
      const hasSections = summary.total > 0;
      const isComplete = hasSections && summary.completed === summary.total;
      const isIncomplete = hasSections && summary.completed < summary.total;
      const noProgress = !hasSections;
      if (filterValue === "completed") return isComplete;
      if (filterValue === "incomplete") return isIncomplete;
      if (filterValue === "no_progress") return noProgress;
      return true;
    });
  }

  const sortValue = progressSort?.value || "completion_desc";
  rows.sort((a, b) => {
    const nameA = (a.row.fullName || a.row.email || "").toLowerCase();
    const nameB = (b.row.fullName || b.row.email || "").toLowerCase();
    const completionA = a.summary?.modulesTotal
      ? a.summary.modulesCompleted / a.summary.modulesTotal
      : 0;
    const completionB = b.summary?.modulesTotal
      ? b.summary.modulesCompleted / b.summary.modulesTotal
      : 0;
    if (sortValue === "name_asc") return nameA.localeCompare(nameB);
    if (sortValue === "name_desc") return nameB.localeCompare(nameA);
    if (sortValue === "completion_asc") {
      if (completionA !== completionB) return completionA - completionB;
      return nameA.localeCompare(nameB);
    }
    if (completionA !== completionB) return completionB - completionA;
    return nameA.localeCompare(nameB);
  });

  if (!rows.length) {
    progressUserList.innerHTML = "<p class=\"status\">No matches.</p>";
    return;
  }

  progressUserList.innerHTML = "";
  rows.forEach(({ row, summary }) => {
    const name = row.fullName || row.email || "User";
    const userRow = document.createElement("div");
    userRow.className = "user-row";
    userRow.innerHTML = `
      <div class="user-meta">
        <strong>${name}</strong>
        <span class="status" data-progress>Loading progress…</span>
      </div>
    `;

    userRow.addEventListener("click", () => loadUserProgress(row));
    const progressEl = userRow.querySelector("[data-progress]");
    if (!summary) {
      progressEl.textContent = "Progress unavailable.";
    } else {
      progressEl.textContent = summary.total
        ? `Sections completed ${summary.completed}/${summary.total} • Modules completed ${summary.modulesCompleted}/${summary.modulesTotal}`
        : "No sections yet.";
    }

    progressUserList.appendChild(userRow);
  });
}

async function loadUsers({ reset = false } = {}) {
  if (loadingUsers) return;
  if (reset) {
    users = [];
    userCursor = null;
    userHasMore = true;
  }
  if (!userHasMore && !reset) return;

  loadingUsers = true;
  const q = userCursor
    ? query(collection(defaultDb, "users"), orderBy("email"), startAfter(userCursor), limit(USER_PAGE_SIZE))
    : query(collection(defaultDb, "users"), orderBy("email"), limit(USER_PAGE_SIZE));

  const snap = await getDocs(q);
  if (!snap.empty) {
    userCursor = snap.docs[snap.docs.length - 1];
  }
  userHasMore = snap.docs.length === USER_PAGE_SIZE;
  users = [...users, ...snap.docs.map((docSnap) => ({ uid: docSnap.id, ...docSnap.data() }))];
  loadingUsers = false;

  if (reset) {
    renderUserResults(userResults, userSearch.value, {
      label: "Add admin",
      action: async (row) => {
        try {
          await setDoc(doc(db, "admins", row.uid), {
            email: row.email || null,
            fullName: row.fullName || null,
            addedAt: serverTimestamp(),
            addedBy: auth.currentUser?.uid || null,
          });
          setStatus(adminStatus, "Admin added.");
          loadAdmins();
        } catch (error) {
          setStatus(adminStatus, error.message, true);
        }
      },
    });
    renderProgressUsers();
    renderContracts();
  }
}

async function loadUserProgress(user) {
  progressDetail.innerHTML = "<p class=\"status\">Loading progress…</p>";
  progressUserTitle.textContent = user.fullName || user.email || "User";

  const progressSnap = await getDocs(collection(db, "progress", user.uid, "modules"));
  const progressMap = {};
  progressSnap.forEach((docSnap) => {
    progressMap[docSnap.id] = docSnap.data();
  });

  if (!sections.length || !modules.length) {
    progressDetail.innerHTML = "<p class=\"status\">No sections or modules yet.</p>";
    return;
  }

  const groups = sections.map((section) => {
    const sectionModules = modules.filter((m) => m.sectionId === section.id);
    return { section, sectionModules, progressMap };
  });

  progressDetail.innerHTML = "";
  const summaryWrap = document.createElement("div");
  summaryWrap.className = "stack";
  summaryWrap.innerHTML = "<strong>Sections</strong>";
  groups.forEach((group) => {
    const sectionComplete = group.sectionModules.length
      ? group.sectionModules.every((module) => group.progressMap[module.id]?.status === "completed")
      : false;
    const row = document.createElement("div");
    row.className = `module-row${sectionComplete ? " is-complete" : ""}`;
    row.innerHTML = `
      <div class="module-meta spaced">
        <strong>${group.section.title || "Untitled"}</strong>
        ${sectionComplete ? "<span class=\"badge\">Completed</span>" : "<span class=\"status\">In progress</span>"}
      </div>
    `;
    summaryWrap.appendChild(row);
  });
  progressDetail.appendChild(summaryWrap);

  groups.forEach((group) => {
    const groupWrap = document.createElement("div");
    groupWrap.className = "stack";
    groupWrap.innerHTML = `
      <strong>${group.section.title || "Untitled"}</strong>
    `;

    if (!group.sectionModules.length) {
      const empty = document.createElement("p");
      empty.className = "status";
      empty.textContent = "No modules in this section.";
      groupWrap.appendChild(empty);
    } else {
      group.sectionModules.forEach((module) => {
        const progress = group.progressMap[module.id] || {};
        const row = document.createElement("div");
        row.className = `module-row${progress.status === "completed" ? " is-complete" : ""}`;
        const status = progress.status === "completed" ? "Completed" : "In progress";
        const score = typeof progress.quizPercent === "number" ? `Score ${Math.round(progress.quizPercent)}%` : "";
        row.innerHTML = `
          <div class="module-meta spaced">
            <strong>${module.title || "Untitled module"}</strong>
            ${progress.status === "completed"
              ? "<span class=\"badge\">Completed</span>"
              : "<span class=\"status\">In progress</span>"}
          </div>
        `;
        groupWrap.appendChild(row);
      });
    }

    progressDetail.appendChild(groupWrap);
  });
}

if (newSectionBtn) {
  newSectionBtn.addEventListener("click", () => {
    const next = promptSectionData();
    if (!next) return;
    addDoc(collection(db, "sections"), {
      ...next,
      status: "draft",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
      .then(async () => {
        setStatus(sectionStatusText, "Section saved as unpublished.");
        await loadSections();
        renderSections();
      })
      .catch((error) => {
        setStatus(sectionStatusText, error.message, true);
      });
  });
}

if (newModuleBtn) {
  newModuleBtn.addEventListener("click", () => {
    window.location.href = "./admin-module.html";
  });
}

if (adminForm) {
  adminForm.addEventListener("submit", (event) => {
    event.preventDefault();
  });
}

if (addAdminToggle && adminForm) {
  addAdminToggle.addEventListener("click", () => {
    const willShow = adminForm.classList.contains("hidden");
    adminForm.classList.toggle("hidden", !willShow);
    addAdminToggle.textContent = willShow ? "Close" : "Add admin";
    if (!willShow) {
      if (userSearch) userSearch.value = "";
      if (userResults) userResults.innerHTML = "";
      if (adminStatus) adminStatus.textContent = "";
    } else {
      if (userSearch) userSearch.focus();
    }
  });
}

if (userSearch) {
  userSearch.addEventListener("input", () => {
    renderUserResults(userResults, userSearch.value, {
      label: "Add admin",
      action: async (row) => {
        try {
          await setDoc(doc(db, "admins", row.uid), {
            email: row.email || null,
            fullName: row.fullName || null,
            addedAt: serverTimestamp(),
            addedBy: auth.currentUser?.uid || null,
          });
          setStatus(adminStatus, "Admin added.");
          loadAdmins();
        } catch (error) {
          setStatus(adminStatus, error.message, true);
        }
      },
    });
  });
}

if (refreshUsers) {
  refreshUsers.addEventListener("click", () => {
    loadUsers({ reset: true });
  });
}

progressSearch.addEventListener("input", () => {
  renderProgressUsers();
});
if (progressSort) {
  progressSort.addEventListener("change", () => {
    renderProgressUsers();
  });
}
if (progressFilter) {
  progressFilter.addEventListener("change", () => {
    renderProgressUsers();
  });
}

requireAuth({
  onAuthed: async (user) => {
    const adminDoc = await getDoc(doc(db, "admins", user.uid));
    if (!adminDoc.exists()) {
      adminGuard.innerHTML = `
        <h2>Access denied</h2>
        <p class="status">Ask an existing admin to add your UID: <strong>${user.uid}</strong>.</p>
      `;
      return;
    }

    adminGuard.classList.add("hidden");
    tabPanels.forEach((panel) => panel.classList.remove("hidden"));
    showTab("content");
    initTabs();
    await loadSections();
    await loadModules();
    renderSections();
    await loadAdmins();
    await loadUsers({ reset: true });
    renderContracts();
  },
  onUnauthed: () => {
    window.location.href = "./index.html";
  },
});

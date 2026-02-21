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

const sectionForm = document.querySelector("#section-form");
const sectionIdInput = document.querySelector("#section-id");
const sectionTitle = document.querySelector("#section-title");
const sectionSummary = document.querySelector("#section-summary");
const sectionOrder = document.querySelector("#section-order");
const sectionStatus = document.querySelector("#section-status");
const sectionStatusText = document.querySelector("#section-status-text");
const sectionReset = document.querySelector("#section-reset");
const sectionList = document.querySelector("#section-list");

const moduleForm = document.querySelector("#module-form");
const moduleIdInput = document.querySelector("#module-id");
const moduleTitle = document.querySelector("#module-title");
const moduleSummary = document.querySelector("#module-summary");
const moduleSection = document.querySelector("#module-section");
const moduleType = document.querySelector("#module-type");
const moduleStatus = document.querySelector("#module-status");
const moduleOrder = document.querySelector("#module-order");
const moduleStatusText = document.querySelector("#module-status-text");
const moduleReset = document.querySelector("#module-reset");
const moduleList = document.querySelector("#module-list");
const completionModeWrap = document.querySelector("#completion-mode-wrap");
const completionMode = document.querySelector("#completion-mode");
const pageBuilder = document.querySelector("#page-builder");
const quizBuilder = document.querySelector("#quiz-builder");
const addAttachmentBtn = document.querySelector("#add-attachment");
const attachmentList = document.querySelector("#attachment-list");
const addEmbedBtn = document.querySelector("#add-embed");
const embedList = document.querySelector("#embed-list");
const addQuestionBtn = document.querySelector("#add-question");
const questionList = document.querySelector("#question-list");

const adminForm = document.querySelector("#admin-form");
const adminStatus = document.querySelector("#admin-status");
const adminList = document.querySelector("#admin-list");
const userSearch = document.querySelector("#user-search");
const userResults = document.querySelector("#user-results");
const refreshUsers = document.querySelector("#refresh-users");

const progressSearch = document.querySelector("#progress-search");
const progressUserList = document.querySelector("#progress-user-list");
const progressDetail = document.querySelector("#progress-detail");
const progressUserTitle = document.querySelector("#progress-user-title");

let quill = null;
let sections = [];
let modules = [];
let users = [];
let attachments = [];
let embeds = [];
let quizQuestions = [];

const USER_PAGE_SIZE = 200;
let userCursor = null;
let loadingUsers = false;
let userHasMore = false;

wireSignOut("#sign-out");

function setStatus(el, message, isError = false) {
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

function resetSectionForm() {
  sectionForm.reset();
  sectionIdInput.value = "";
  setStatus(sectionStatusText, "");
}

function resetModuleForm() {
  moduleForm.reset();
  moduleIdInput.value = "";
  attachments = [];
  embeds = [];
  quizQuestions = [];
  if (quill) {
    quill.root.innerHTML = "";
  }
  renderAttachmentList();
  renderEmbedList();
  renderQuestionList();
  toggleModuleType();
  setStatus(moduleStatusText, "");
}

function initQuill() {
  if (window.Quill) {
    quill = new window.Quill("#editor", {
      theme: "snow",
      modules: {
        toolbar: [
          [{ header: [1, 2, 3, false] }],
          ["bold", "italic", "underline", "strike"],
          [{ list: "ordered" }, { list: "bullet" }],
          ["link", "image", "video"],
          [{ align: [] }],
          ["clean"],
        ],
      },
    });
  }
}

function renderSections() {
  sectionList.innerHTML = "";
  if (!sections.length) {
    sectionList.innerHTML = "<p class=\"status\">No sections yet.</p>";
    return;
  }

  sections.forEach((section) => {
    const card = document.createElement("div");
    card.className = "user-row";
    card.innerHTML = `
      <div class="user-meta">
        <strong>${section.title || "Untitled"}</strong>
        <span>${section.summary || ""}</span>
      </div>
      <div class="actions">
        <button class="secondary" data-action="edit">Edit</button>
        <button class="danger" data-action="delete">Delete</button>
      </div>
    `;

    card.querySelector("[data-action='edit']").addEventListener("click", () => {
      sectionIdInput.value = section.id;
      sectionTitle.value = section.title || "";
      sectionSummary.value = section.summary || "";
      sectionOrder.value = section.order ?? 0;
      sectionStatus.value = section.status || "draft";
      showTab("sections");
    });

    card.querySelector("[data-action='delete']").addEventListener("click", async () => {
      const confirmed = window.confirm("Delete this section? Modules will remain but be unassigned.");
      if (!confirmed) return;
      await deleteDoc(doc(db, "sections", section.id));
      await loadSections();
    });

    sectionList.appendChild(card);
  });
}

function renderModuleSelect() {
  moduleSection.innerHTML = "";
  sections.forEach((section) => {
    const option = document.createElement("option");
    option.value = section.id;
    option.textContent = section.title || "Untitled";
    moduleSection.appendChild(option);
  });
}

function renderModules() {
  moduleList.innerHTML = "";
  if (!modules.length) {
    moduleList.innerHTML = "<p class=\"status\">No modules yet.</p>";
    return;
  }

  modules.forEach((module) => {
    const section = sections.find((s) => s.id === module.sectionId);
    const card = document.createElement("div");
    card.className = "user-row";
    card.innerHTML = `
      <div class="user-meta">
        <strong>${module.title || "Untitled module"}</strong>
        <span>${section ? section.title : "No section"} · ${module.type || "page"}</span>
      </div>
      <div class="actions">
        <button class="secondary" data-action="edit">Edit</button>
        <button class="danger" data-action="delete">Delete</button>
      </div>
    `;

    card.querySelector("[data-action='edit']").addEventListener("click", () => {
      moduleIdInput.value = module.id;
      moduleTitle.value = module.title || "";
      moduleSummary.value = module.summary || "";
      moduleSection.value = module.sectionId || sections[0]?.id || "";
      moduleType.value = module.type || "page";
      moduleStatus.value = module.status || "draft";
      moduleOrder.value = module.order ?? 0;
      completionMode.value = module.completionMode || "mark";
      if (quill) quill.root.innerHTML = module.contentHtml || "";
      attachments = module.attachments || [];
      embeds = module.embeds || [];
      quizQuestions = module.quiz?.questions || [];
      renderAttachmentList();
      renderEmbedList();
      renderQuestionList();
      toggleModuleType();
      showTab("modules");
    });

    card.querySelector("[data-action='delete']").addEventListener("click", async () => {
      const confirmed = window.confirm("Delete this module?");
      if (!confirmed) return;
      await deleteDoc(doc(db, "modules", module.id));
      await loadModules();
    });

    moduleList.appendChild(card);
  });
}

function renderAttachmentList() {
  attachmentList.innerHTML = "";
  attachments.forEach((file, index) => {
    const row = document.createElement("div");
    row.className = "attachment-row";
    row.innerHTML = `
      <label>File title</label>
      <input type="text" value="${file.title || ""}" data-field="title" />
      <label>File URL</label>
      <input type="text" value="${file.url || ""}" data-field="url" />
      <button class="danger" type="button" data-action="remove">Remove</button>
    `;

    row.querySelectorAll("input").forEach((input) => {
      input.addEventListener("input", (event) => {
        attachments[index][event.target.dataset.field] = event.target.value;
      });
    });

    row.querySelector("[data-action='remove']").addEventListener("click", () => {
      attachments.splice(index, 1);
      renderAttachmentList();
    });

    attachmentList.appendChild(row);
  });
}

function renderEmbedList() {
  embedList.innerHTML = "";
  embeds.forEach((embed, index) => {
    const row = document.createElement("div");
    row.className = "embed-row";
    row.innerHTML = `
      <label>Embed title</label>
      <input type="text" value="${embed.title || ""}" data-field="title" />
      <label>Embed URL</label>
      <input type="text" value="${embed.url || ""}" data-field="url" />
      <button class="danger" type="button" data-action="remove">Remove</button>
    `;

    row.querySelectorAll("input").forEach((input) => {
      input.addEventListener("input", (event) => {
        embeds[index][event.target.dataset.field] = event.target.value;
      });
    });

    row.querySelector("[data-action='remove']").addEventListener("click", () => {
      embeds.splice(index, 1);
      renderEmbedList();
    });

    embedList.appendChild(row);
  });
}

function createQuestion() {
  return {
    id: crypto.randomUUID(),
    type: "multiple_choice",
    prompt: "",
    options: ["Option 1", "Option 2"],
    correctIndex: 0,
    correctIndexes: [],
    answers: [],
    caseSensitive: false,
  };
}

function renderQuestionList() {
  questionList.innerHTML = "";
  if (!quizQuestions.length) {
    questionList.innerHTML = "<p class=\"status\">No questions yet.</p>";
    return;
  }

  quizQuestions.forEach((q, index) => {
    const card = document.createElement("div");
    card.className = "question-card";
    card.innerHTML = `
      <div class="panel-header">
        <strong>Question ${index + 1}</strong>
        <button class="danger" type="button" data-action="remove">Remove</button>
      </div>
      <label>Prompt</label>
      <textarea data-field="prompt" rows="2">${q.prompt || ""}</textarea>
      <label>Type</label>
      <select data-field="type">
        <option value="multiple_choice">Multiple choice</option>
        <option value="multiple_select">Multiple select</option>
        <option value="true_false">True/False</option>
        <option value="short_answer">Short answer</option>
      </select>
      <div data-field="options"></div>
      <div data-field="short"></div>
    `;

    const typeSelect = card.querySelector("select");
    typeSelect.value = q.type;

    card.querySelector("textarea").addEventListener("input", (event) => {
      q.prompt = event.target.value;
    });

    typeSelect.addEventListener("change", (event) => {
      q.type = event.target.value;
      if (q.type === "true_false") {
        q.options = ["True", "False"];
        q.correctIndex = 0;
      }
      if (q.type === "short_answer") {
        q.answers = q.answers || [];
      }
      renderQuestionList();
    });

    const optionsWrap = card.querySelector("[data-field='options']");
    const shortWrap = card.querySelector("[data-field='short']");

    if (q.type === "multiple_choice" || q.type === "multiple_select" || q.type === "true_false") {
      optionsWrap.innerHTML = "<label>Options</label>";
      q.options = q.options || [];
      q.options.forEach((opt, optIndex) => {
        const row = document.createElement("div");
        row.className = "actions";
        const controlType = q.type === "multiple_select" ? "checkbox" : "radio";
        row.innerHTML = `
          <input type="${controlType}" name="correct-${index}" ${
          q.type === "multiple_select"
            ? (q.correctIndexes || []).includes(optIndex) ? "checked" : ""
            : Number(q.correctIndex) === optIndex ? "checked" : ""
        } />
          <input type="text" value="${opt}" />
          ${q.type === "true_false" ? "" : "<button class=\"danger\" type=\"button\">Remove</button>"}
        `;

        const textInput = row.querySelector("input[type='text']");
        textInput.addEventListener("input", (event) => {
          q.options[optIndex] = event.target.value;
        });

        const selectInput = row.querySelector(`input[type='${controlType}']`);
        selectInput.addEventListener("change", (event) => {
          if (q.type === "multiple_select") {
            const list = new Set(q.correctIndexes || []);
            if (event.target.checked) list.add(optIndex);
            else list.delete(optIndex);
            q.correctIndexes = [...list];
          } else {
            q.correctIndex = optIndex;
          }
        });

        const removeBtn = row.querySelector("button");
        if (removeBtn) {
          removeBtn.addEventListener("click", () => {
            q.options.splice(optIndex, 1);
            q.correctIndexes = (q.correctIndexes || []).filter((i) => i !== optIndex);
            if (q.correctIndex >= q.options.length) q.correctIndex = 0;
            renderQuestionList();
          });
        }

        optionsWrap.appendChild(row);
      });

      if (q.type !== "true_false") {
        const addBtn = document.createElement("button");
        addBtn.className = "secondary";
        addBtn.type = "button";
        addBtn.textContent = "Add option";
        addBtn.addEventListener("click", () => {
          q.options.push(`Option ${q.options.length + 1}`);
          renderQuestionList();
        });
        optionsWrap.appendChild(addBtn);
      }
    }

    if (q.type === "short_answer") {
      shortWrap.innerHTML = `
        <label>Accepted answers (comma-separated)</label>
        <input type="text" value="${(q.answers || []).join(", ")}" />
        <label><input type="checkbox" ${q.caseSensitive ? "checked" : ""} /> Case sensitive</label>
      `;
      const answerInput = shortWrap.querySelector("input[type='text']");
      answerInput.addEventListener("input", (event) => {
        q.answers = event.target.value.split(",").map((a) => a.trim()).filter(Boolean);
      });
      const caseToggle = shortWrap.querySelector("input[type='checkbox']");
      caseToggle.addEventListener("change", (event) => {
        q.caseSensitive = event.target.checked;
      });
    }

    card.querySelector("[data-action='remove']").addEventListener("click", () => {
      quizQuestions.splice(index, 1);
      renderQuestionList();
    });

    questionList.appendChild(card);
  });
}

function toggleModuleType() {
  const isQuiz = moduleType.value === "quiz";
  quizBuilder.classList.toggle("hidden", !isQuiz);
  pageBuilder.classList.toggle("hidden", isQuiz);
  completionModeWrap.classList.toggle("hidden", isQuiz);
}

async function loadSections() {
  const snap = await getDocs(query(collection(db, "sections"), orderBy("order", "asc")));
  sections = snap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
  renderSections();
  renderModuleSelect();
}

async function loadModules() {
  const snap = await getDocs(query(collection(db, "modules"), orderBy("order", "asc")));
  modules = snap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
  renderModules();
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
    : users;

  const maxShown = 50;
  const visible = filtered.slice(0, maxShown);
  targetEl.innerHTML = "";

  if (!visible.length) {
    targetEl.innerHTML = "<p class=\"status\">No users found.</p>";
    return;
  }

  visible.forEach((row) => {
    const name = row.fullName || "";
    const email = row.email || "";
    const label = name || email || "(no name)";
    const sub = name && email ? email : "";
    const el = document.createElement("div");
    el.className = "user-row";
    el.innerHTML = `
      <div class="user-meta">
        <strong>${label}</strong>
        ${sub ? `<span>${sub}</span>` : ""}
      </div>
      <button class="secondary" data-uid="${row.uid}">${onSelect.label}</button>
    `;
    el.querySelector("button").addEventListener("click", () => onSelect.action(row));
    targetEl.appendChild(el);
  });

  if (filtered.length > maxShown) {
    const note = document.createElement("p");
    note.className = "status";
    note.textContent = `Showing ${maxShown} of ${filtered.length} results. Refine your search to see more.`;
    targetEl.appendChild(note);
  }

  if (userHasMore) {
    const moreWrap = document.createElement("div");
    moreWrap.className = "status";
    const moreBtn = document.createElement("button");
    moreBtn.className = "secondary";
    moreBtn.type = "button";
    moreBtn.textContent = loadingUsers ? "Loading…" : "Load more users";
    moreBtn.disabled = loadingUsers;
    moreBtn.addEventListener("click", () => loadUsers({ reset: false }));
    moreWrap.appendChild(moreBtn);
    targetEl.appendChild(moreWrap);
  }
}

async function loadUsers({ reset = false } = {}) {
  if (loadingUsers) return;
  loadingUsers = true;
  if (reset) {
    users = [];
    userCursor = null;
    userHasMore = false;
  }

  try {
    let q = query(collection(defaultDb, "users"), orderBy("fullName"), limit(USER_PAGE_SIZE));
    if (userCursor) {
      q = query(collection(defaultDb, "users"), orderBy("fullName"), startAfter(userCursor), limit(USER_PAGE_SIZE));
    }

    const snapshot = await getDocs(q);
    if (!snapshot.empty) {
      userCursor = snapshot.docs[snapshot.docs.length - 1];
      userHasMore = snapshot.size === USER_PAGE_SIZE;
      const nextRows = snapshot.docs.map((docSnap) => {
        const data = docSnap.data();
        return {
          uid: docSnap.id,
          fullName: data.fullName || "",
          email: data.email || "",
        };
      });

      const seen = new Set(users.map((u) => u.uid));
      nextRows.forEach((row) => {
        if (!seen.has(row.uid)) users.push(row);
      });
    } else {
      userHasMore = false;
    }
  } catch (error) {
    setStatus(adminStatus, error.message, true);
  } finally {
    loadingUsers = false;
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
    renderUserResults(progressUserList, progressSearch.value, {
      label: "View",
      action: (row) => loadUserProgress(row),
    });
  }
}

async function loadUserProgress(user) {
  progressUserTitle.textContent = user.fullName || user.email || "User";
  progressDetail.innerHTML = "<p class=\"status\">Loading progress…</p>";

  const progressSnap = await getDocs(collection(db, "progress", user.uid, "modules"));
  const progressMap = {};
  progressSnap.forEach((docSnap) => {
    progressMap[docSnap.id] = docSnap.data();
  });

  const grouped = sections.map((section) => {
    const sectionModules = modules.filter((m) => m.sectionId === section.id);
    const completedCount = sectionModules.filter((m) => progressMap[m.id]?.status === "completed").length;
    const isComplete = sectionModules.length > 0 && completedCount === sectionModules.length;
    return { section, sectionModules, completedCount, isComplete, progressMap };
  });

  progressDetail.innerHTML = "";
  if (!grouped.length) {
    progressDetail.innerHTML = "<p class=\"status\">No sections found.</p>";
    return;
  }

  grouped.forEach((group) => {
    const card = document.createElement("div");
    card.className = "stack";
    card.innerHTML = `
      <div class="panel-header">
        <div>
          <strong>${group.section.title || "Untitled section"}</strong>
          <span class="status">${group.completedCount}/${group.sectionModules.length} complete</span>
        </div>
        ${group.isComplete ? '<span class="badge">Complete</span>' : ""}
      </div>
    `;

    group.sectionModules.forEach((module) => {
      const progress = group.progressMap[module.id] || {};
      const score = typeof progress.quizPercent === "number" ? `Score ${Math.round(progress.quizPercent)}%` : "";
      const status = progress.status || "not_started";
      const row = document.createElement("div");
      row.className = "module-item";
      row.innerHTML = `
        <strong>${module.title || "Untitled module"}</strong>
        <div class="module-meta">
          <span>${status}</span>
          ${score ? `<span>${score}</span>` : ""}
        </div>
      `;
      card.appendChild(row);
    });

    progressDetail.appendChild(card);
  });
}

sectionForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const payload = {
    title: sectionTitle.value.trim(),
    summary: sectionSummary.value.trim(),
    order: Number(sectionOrder.value || 0),
    status: sectionStatus.value,
    updatedAt: serverTimestamp(),
  };

  try {
    if (sectionIdInput.value) {
      await updateDoc(doc(db, "sections", sectionIdInput.value), payload);
      setStatus(sectionStatusText, "Section updated.");
    } else {
      payload.createdAt = serverTimestamp();
      await addDoc(collection(db, "sections"), payload);
      setStatus(sectionStatusText, "Section created.");
    }
    resetSectionForm();
    await loadSections();
  } catch (error) {
    setStatus(sectionStatusText, error.message, true);
  }
});

sectionReset.addEventListener("click", resetSectionForm);

moduleType.addEventListener("change", toggleModuleType);
moduleReset.addEventListener("click", resetModuleForm);

moduleForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const payload = {
    title: moduleTitle.value.trim(),
    summary: moduleSummary.value.trim(),
    sectionId: moduleSection.value,
    type: moduleType.value,
    status: moduleStatus.value,
    order: Number(moduleOrder.value || 0),
    completionMode: completionMode.value,
    contentHtml: quill ? quill.root.innerHTML : "",
    attachments: attachments.filter((a) => a.url),
    embeds: embeds.filter((e) => e.url),
    quiz: moduleType.value === "quiz" ? { questions: quizQuestions } : null,
    updatedAt: serverTimestamp(),
  };

  try {
    if (moduleIdInput.value) {
      await updateDoc(doc(db, "modules", moduleIdInput.value), payload);
      setStatus(moduleStatusText, "Module updated.");
    } else {
      payload.createdAt = serverTimestamp();
      await addDoc(collection(db, "modules"), payload);
      setStatus(moduleStatusText, "Module created.");
    }
    resetModuleForm();
    await loadModules();
  } catch (error) {
    setStatus(moduleStatusText, error.message, true);
  }
});

addAttachmentBtn.addEventListener("click", () => {
  attachments.push({ title: "", url: "" });
  renderAttachmentList();
});

addEmbedBtn.addEventListener("click", () => {
  embeds.push({ title: "", url: "" });
  renderEmbedList();
});

addQuestionBtn.addEventListener("click", () => {
  quizQuestions.push(createQuestion());
  renderQuestionList();
});

adminForm.addEventListener("submit", (event) => {
  event.preventDefault();
});

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

refreshUsers.addEventListener("click", () => {
  loadUsers({ reset: true });
});

progressSearch.addEventListener("input", () => {
  renderUserResults(progressUserList, progressSearch.value, {
    label: "View",
    action: (row) => loadUserProgress(row),
  });
});

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
    showTab("sections");
    initTabs();
    initQuill();
    toggleModuleType();
    await loadSections();
    await loadModules();
    await loadAdmins();
    await loadUsers({ reset: true });
  },
  onUnauthed: () => {
    window.location.href = "./index.html";
  },
});

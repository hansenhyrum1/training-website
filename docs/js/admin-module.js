import {
  auth,
  db,
  storage,
  ref,
  uploadBytesResumable,
  getDownloadURL,
  collection,
  doc,
  getDoc,
  getDocs,
  addDoc,
  updateDoc,
  query,
  orderBy,
  serverTimestamp,
} from "./firebase.js";
import { requireAuth, wireSignOut } from "./auth.js";

const moduleForm = document.querySelector("#module-form");
const moduleIdInput = document.querySelector("#module-id");
const moduleTitle = document.querySelector("#module-title");
const moduleSection = document.querySelector("#module-section");
const moduleType = document.querySelector("#module-type");
const moduleStatusText = document.querySelector("#module-status-text");
const moduleEditorTitle = document.querySelector("#module-editor-title");
const moduleVisibility = document.querySelector("#module-visibility");
const completionModeWrap = document.querySelector("#completion-mode-wrap");
const completionMode = document.querySelector("#completion-mode");
const pageBuilder = document.querySelector("#page-builder");
const quizBuilder = document.querySelector("#quiz-builder");
const contractNote = document.querySelector("#contract-note");
const addAttachmentBtn = document.querySelector("#add-attachment");
const attachmentList = document.querySelector("#attachment-list");
const addQuestionBtn = document.querySelector("#add-question");
const questionList = document.querySelector("#question-list");
const quizRequiredInput = document.querySelector("#quiz-required");
const quizRequiredTotal = document.querySelector("#quiz-required-total");
const imageOverlay = document.querySelector("#image-overlay");
const editorWrap = document.querySelector(".editor-wrap");
const backToAdmin = document.querySelector("#back-to-admin");

let quill = null;
let sections = [];
let modules = [];
let attachments = [];
let quizQuestions = [];
let selectedEditorImage = null;
let selectedImageId = null;
let resizingImage = null;
let resizeStart = null;
let currentStatus = "draft";
let currentOrder = 0;
let autosaveTimer = null;
let autosaveInFlight = false;
let lastSavedSnapshot = "";

const quizTypes = ["multiple_choice", "true_false"];

async function uploadVideoFile(file) {
  const safeName = (file.name || "video")
    .replace(/[^a-zA-Z0-9.\-_]/g, "_")
    .slice(0, 80);
  const moduleId = moduleIdInput?.value || "draft";
  const userId = auth.currentUser?.uid || "user";
  const path = `module-videos/${userId}/${moduleId}/${Date.now()}-${safeName}`;
  const storageRef = ref(storage, path);
  const uploadTask = uploadBytesResumable(storageRef, file);
  await new Promise((resolve, reject) => {
    uploadTask.on(
      "state_changed",
      null,
      (error) => reject(error),
      () => resolve()
    );
  });
  return await getDownloadURL(uploadTask.snapshot.ref);
}

wireSignOut("#sign-out");

function setStatus(el, message, isError = false) {
  if (!el) return;
  el.textContent = message;
  el.style.color = isError ? "#b54747" : "#4a4a44";
}

function statusLabel(status) {
  return status === "published" ? "Published" : "Unpublished";
}

function getModuleId() {
  const params = new URLSearchParams(window.location.search);
  return params.get("id");
}

function getSectionId() {
  const params = new URLSearchParams(window.location.search);
  return params.get("sectionId");
}


function updateVisibility(status) {
  currentStatus = status || "draft";
  if (moduleVisibility) {
    moduleVisibility.textContent = statusLabel(currentStatus);
  }
}

function initQuill() {
  if (!window.Quill) return;
  quill = new window.Quill("#editor", {
    theme: "snow",
    modules: {
      toolbar: {
        container: [
          [{ header: [1, 2, 3, false] }],
          ["bold", "italic", "underline", "strike"],
          [{ list: "ordered" }, { list: "bullet" }],
          ["link", "image", "video", "iframe"],
          [{ align: [] }],
          ["clean"],
        ],
        handlers: {
          video: async () => {
            const input = document.createElement("input");
            input.type = "file";
            input.accept = "video/*";
            input.addEventListener("change", async () => {
              const file = input.files?.[0];
              if (!file) return;
              setStatus(moduleStatusText, "Uploading video...");
              try {
                const url = await uploadVideoFile(file);
                const range = quill.getSelection(true) || { index: quill.getLength() };
                const html = `
                  <div class="embed-block">
                    <video controls src="${url}"></video>
                  </div>
                `;
                quill.clipboard.dangerouslyPasteHTML(range.index, html);
                setStatus(moduleStatusText, "Video uploaded.");
                scheduleAutosave();
              } catch (error) {
                setStatus(moduleStatusText, error.message || "Video upload failed.", true);
              }
            });
            input.click();
          },
          iframe: () => {
            const iframeHtml = window.prompt("Paste iframe embed code");
            if (!iframeHtml) return;
            const trimmed = iframeHtml.trim();
            if (!trimmed.toLowerCase().startsWith("<iframe")) return;
            const range = quill.getSelection(true) || { index: quill.getLength() };
            const html = `
              <div class="embed-block">
                ${trimmed}
              </div>
            `;
            quill.clipboard.dangerouslyPasteHTML(range.index, html);
          },
        },
      },
    },
  });

  const toolbar = quill.getModule("toolbar")?.container;
  if (toolbar) {
    const iframeBtn = toolbar.querySelector("button.ql-iframe");
    if (iframeBtn && !iframeBtn.querySelector("svg")) {
      iframeBtn.innerHTML = `
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zm0 2v10h16V7H4zm3 2h2v6H7V9zm4 0h6v2h-6V9zm0 4h6v2h-6v-2z"></path>
        </svg>
      `;
      iframeBtn.setAttribute("title", "Iframe");
    }
  }

  const updateOverlay = () => {
    if (!selectedEditorImage || !imageOverlay) return;
    const container = editorWrap || quill.root;
    const containerRect = container.getBoundingClientRect();
    const imgRect = selectedEditorImage.getBoundingClientRect();
    const top = imgRect.top - containerRect.top + container.scrollTop;
    const left = imgRect.left - containerRect.left + container.scrollLeft;
    imageOverlay.style.top = `${top}px`;
    imageOverlay.style.left = `${left}px`;
    imageOverlay.style.width = `${imgRect.width}px`;
    imageOverlay.style.height = `${imgRect.height}px`;
    imageOverlay.classList.remove("hidden");
  };

  const clearSelection = () => {
    selectedEditorImage = null;
    selectedImageId = null;
    if (imageOverlay) imageOverlay.classList.add("hidden");
  };

  quill.root.addEventListener("click", (event) => {
    const target = event.target;
    if (target && target.tagName === "IMG") {
      selectedEditorImage = target;
      if (!selectedEditorImage.dataset.imageId) {
        selectedEditorImage.dataset.imageId = crypto.randomUUID();
      }
      selectedImageId = selectedEditorImage.dataset.imageId;
      selectedEditorImage.setAttribute("draggable", "true");
      updateOverlay();
      return;
    }
    const iframe = target?.closest ? target.closest("iframe") : (target && target.tagName === "IFRAME" ? target : null);
    if (iframe) {
      const current = iframe.outerHTML;
      const updated = window.prompt("Edit iframe embed code", current);
      if (!updated) return;
      const trimmed = updated.trim();
      if (!trimmed.toLowerCase().startsWith("<iframe")) return;
      const blot = window.Quill.find(iframe);
      if (!blot) return;
      const index = quill.getIndex(blot);
      blot.remove();
      const html = `<div class="embed-block">${trimmed}</div>`;
      quill.clipboard.dangerouslyPasteHTML(index, html);
      return;
    }
    clearSelection();
  });

  quill.on("selection-change", () => {
    if (selectedEditorImage) {
      updateOverlay();
    }
  });

  quill.on("text-change", () => {
    if (selectedImageId) {
      const match = quill.root.querySelector(`img[data-image-id='${selectedImageId}']`);
      if (match) {
        selectedEditorImage = match;
        window.requestAnimationFrame(updateOverlay);
      } else {
        clearSelection();
      }
    }
    scheduleAutosave();
  });


  if (imageOverlay) {
    imageOverlay.querySelectorAll(".resize-handle").forEach((handle) => {
      handle.addEventListener("mousedown", (event) => {
        if (!selectedEditorImage) return;
        event.preventDefault();
        resizingImage = selectedEditorImage;
        const rect = resizingImage.getBoundingClientRect();
        const editorRect = quill.root.getBoundingClientRect();
        resizeStart = {
          x: event.clientX,
          width: rect.width,
          dir: handle.dataset.dir || "se",
          editorWidth: editorRect.width,
        };
        document.body.classList.add("no-select");
      });
    });
  }

  const onMouseMove = (event) => {
    if (!resizingImage || !resizeStart) return;
    const deltaX = event.clientX - resizeStart.x;
    const direction = resizeStart.dir || "se";
    const isLeft = direction.includes("w");
    const widthPx = Math.max(80, Math.min(resizeStart.editorWidth, resizeStart.width + (isLeft ? -deltaX : deltaX)));
    const percent = Math.max(10, Math.min(100, (widthPx / resizeStart.editorWidth) * 100));
    resizingImage.style.width = `${percent}%`;
    resizingImage.style.height = "auto";
    updateOverlay();
  };

  const onMouseUp = () => {
    if (!resizingImage) return;
    resizingImage = null;
    resizeStart = null;
    document.body.classList.remove("no-select");
  };

  window.addEventListener("mousemove", onMouseMove);
  window.addEventListener("mouseup", onMouseUp);
  window.addEventListener("scroll", updateOverlay);
  window.addEventListener("resize", updateOverlay);
  quill.root.addEventListener("scroll", updateOverlay);

  quill.root.addEventListener("dragstart", (event) => {
    const target = event.target;
    if (target && target.tagName === "IMG") {
      selectedEditorImage = target;
      selectedEditorImage.setAttribute("draggable", "false");
    }
  });

}

function toggleModuleType() {
  const isQuiz = moduleType.value === "quiz";
  const isContract = moduleType.value === "contract";
  quizBuilder.classList.toggle("hidden", !isQuiz);
  pageBuilder.classList.toggle("hidden", isQuiz);
  completionModeWrap.classList.toggle("hidden", isQuiz || isContract);
  if (contractNote) {
    contractNote.classList.toggle("hidden", !isContract);
  }
  if (quizRequiredInput) {
    quizRequiredInput.closest(".stack")?.classList.toggle("hidden", !isQuiz);
    quizRequiredInput.toggleAttribute("disabled", !isQuiz);
  }
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
        scheduleAutosave();
      });
    });

    row.querySelector("[data-action='remove']").addEventListener("click", () => {
      attachments.splice(index, 1);
      renderAttachmentList();
      scheduleAutosave();
    });

    attachmentList.appendChild(row);
  });
}

function createQuestion() {
  return {
    id: crypto.randomUUID(),
    type: "multiple_choice",
    prompt: "",
    options: ["", ""],
    correctIndex: null,
    correctIndexes: [],
    answers: [],
    caseSensitive: false,
  };
}

function normalizeQuestion(question) {
  if (!quizTypes.includes(question.type)) {
    question.type = "multiple_choice";
  }
  if (question.type === "true_false") {
    question.options = ["True", "False"];
    if (typeof question.correctIndex !== "number") {
      if (Array.isArray(question.correctIndexes) && question.correctIndexes.length) {
        question.correctIndex = Number(question.correctIndexes[0]);
      } else {
        question.correctIndex = 0;
      }
    }
  } else {
    question.options = Array.isArray(question.options) ? question.options : [];
    if (!question.options.length && Array.isArray(question.answers) && question.answers.length) {
      question.options = question.answers.slice();
    }
    if (typeof question.correctIndex !== "number") {
      if (Array.isArray(question.correctIndexes) && question.correctIndexes.length) {
        question.correctIndex = Number(question.correctIndexes[0]);
      } else {
        question.correctIndex = null;
      }
    }
  }
  if (typeof question.correctIndex === "number" && question.options.length) {
    if (question.correctIndex < 0 || question.correctIndex >= question.options.length) {
      question.correctIndex = 0;
    }
  }
  if (!question.options.length) {
    question.correctIndex = null;
  }
}

function updateRequiredTotal() {
  if (!quizRequiredTotal) return;
  const total = quizQuestions.length || 0;
  quizRequiredTotal.textContent = `/ ${total}`;
  if (quizRequiredInput) {
    quizRequiredInput.max = total ? String(total) : "";
    if (quizRequiredInput.value && Number(quizRequiredInput.value) > total && total > 0) {
      quizRequiredInput.value = total;
    }
  }
}

function renderQuestionList() {
  questionList.innerHTML = "";
  if (!quizQuestions.length) {
    questionList.innerHTML = "<p class=\"status\">No questions yet.</p>";
  } else {
    quizQuestions.forEach((q, index) => {
      normalizeQuestion(q);
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
        <option value="true_false">True/False</option>
      </select>
      <div data-field="options"></div>
    `;

      const typeSelect = card.querySelector("select");
      typeSelect.value = quizTypes.includes(q.type) ? q.type : "multiple_choice";

      card.querySelector("textarea").addEventListener("input", (event) => {
        q.prompt = event.target.value;
        scheduleAutosave();
      });

      typeSelect.addEventListener("change", (event) => {
        q.type = event.target.value;
        if (q.type === "true_false") {
          q.options = ["True", "False"];
          q.correctIndex = 0;
        }
        if (q.type === "multiple_choice" && (!q.options || !q.options.length)) {
          q.options = ["", ""];
          q.correctIndex = null;
        }
        renderQuestionList();
        scheduleAutosave();
      });

      const optionsWrap = card.querySelector("[data-field='options']");

      q.options = q.options || [];
      q.options.forEach((opt, optIndex) => {
        const row = document.createElement("div");
        row.className = "option-row";
        row.innerHTML = `
        <input type="text" value="${opt}" />
        <label class="option-correct">
          <input type="checkbox" ${q.correctIndex === optIndex ? "checked" : ""} />
          Correct
        </label>
        <button class="secondary option-remove" type="button">Remove</button>
      `;

        const input = row.querySelector("input[type='text']");
        input.addEventListener("input", (event) => {
          q.options[optIndex] = event.target.value;
          scheduleAutosave();
        });

        const check = row.querySelector("input[type='checkbox']");
        check.addEventListener("change", (event) => {
          if (event.target.checked) {
            q.correctIndex = optIndex;
            row
              .closest(".question-card")
              ?.querySelectorAll(".option-correct input[type='checkbox']")
              .forEach((box, idx) => {
                if (idx !== optIndex) box.checked = false;
              });
          } else if (q.correctIndex === optIndex) {
            q.correctIndex = null;
          }
          scheduleAutosave();
        });

        optionsWrap.appendChild(row);
        row.querySelector(".option-remove").addEventListener("click", () => {
          q.options.splice(optIndex, 1);
          if (q.correctIndex === optIndex) {
            q.correctIndex = null;
          } else if (typeof q.correctIndex === "number" && q.correctIndex > optIndex) {
            q.correctIndex -= 1;
          }
          renderQuestionList();
          scheduleAutosave();
        });
      });

      if (q.type !== "true_false") {
        const addBtn = document.createElement("button");
        addBtn.className = "secondary";
        addBtn.type = "button";
        addBtn.textContent = "Add option";
        addBtn.addEventListener("click", () => {
          q.options.push("");
          renderQuestionList();
          scheduleAutosave();
        });
        optionsWrap.appendChild(addBtn);
      }

      card.querySelector("[data-action='remove']").addEventListener("click", () => {
        quizQuestions.splice(index, 1);
        renderQuestionList();
        scheduleAutosave();
      });

    questionList.appendChild(card);
  });
  }

  const addMore = document.createElement("button");
  addMore.className = "secondary";
  addMore.type = "button";
  addMore.textContent = "Add question";
  addMore.addEventListener("click", () => {
    quizQuestions.push(createQuestion());
    renderQuestionList();
    scheduleAutosave();
  });
  questionList.appendChild(addMore);
  updateRequiredTotal();
}

function serializeSnapshot() {
  return JSON.stringify({
    title: moduleTitle.value.trim(),
    sectionId: moduleSection.value,
    type: moduleType.value,
    order: currentOrder,
    completionMode: completionMode.value,
    contentHtml: quill ? quill.root.innerHTML : "",
    attachments: attachments.filter((a) => a.url),
    quiz: moduleType.value === "quiz"
      ? { questions: quizQuestions, requiredCorrect: Number(quizRequiredInput?.value || 0) || null }
      : null,
  });
}

async function saveModule({ status, message, silent = false, redirect = false } = {}) {
  if (autosaveInFlight) return;
  autosaveInFlight = true;
  const payload = {
    title: moduleTitle.value.trim(),
    sectionId: moduleSection.value,
    type: moduleType.value,
    status: status || currentStatus || "draft",
    order: currentOrder,
    completionMode: completionMode.value,
    contentHtml: quill ? quill.root.innerHTML : "",
    attachments: attachments.filter((a) => a.url),
    quiz: moduleType.value === "quiz"
      ? { questions: quizQuestions, requiredCorrect: Number(quizRequiredInput?.value || 0) || null }
      : null,
    updatedAt: serverTimestamp(),
  };

  try {
    if (moduleIdInput.value) {
      await updateDoc(doc(db, "modules", moduleIdInput.value), payload);
    } else {
      payload.createdAt = serverTimestamp();
      const docRef = await addDoc(collection(db, "modules"), payload);
      moduleIdInput.value = docRef.id;
      window.history.replaceState(null, "", `./admin-module.html?id=${docRef.id}`);
    }
    updateVisibility(payload.status);
    moduleEditorTitle.textContent = moduleTitle.value.trim() || "Edit module";
    lastSavedSnapshot = serializeSnapshot();
    if (!silent) {
      setStatus(moduleStatusText, message || "Module saved.");
    } else {
      setStatus(moduleStatusText, `Autosaved ${new Date().toLocaleTimeString()}.`);
    }
    if (redirect && !silent) {
      window.location.href = "./admin.html";
    }
  } catch (error) {
    if (!silent) setStatus(moduleStatusText, error.message, true);
  } finally {
    autosaveInFlight = false;
  }
}

function scheduleAutosave() {
  if (autosaveTimer) window.clearTimeout(autosaveTimer);
  autosaveTimer = window.setTimeout(async () => {
    const snapshot = serializeSnapshot();
    if (snapshot === lastSavedSnapshot) return;
    await saveModule({ status: "draft", silent: true });
  }, 15000);
}

async function loadSections() {
  const snap = await getDocs(query(collection(db, "sections"), orderBy("order", "asc")));
  sections = snap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
  moduleSection.innerHTML = "";
  sections.forEach((section) => {
    const option = document.createElement("option");
    option.value = section.id;
    option.textContent = section.title || "Untitled";
    moduleSection.appendChild(option);
  });
}

async function loadModules() {
  const snap = await getDocs(query(collection(db, "modules"), orderBy("order", "asc")));
  modules = snap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
}

async function loadModule(moduleId) {
  const moduleSnap = await getDoc(doc(db, "modules", moduleId));
  if (!moduleSnap.exists()) {
    setStatus(moduleStatusText, "Module not found.", true);
    return;
  }

  const moduleDoc = { id: moduleSnap.id, ...moduleSnap.data() };
  moduleIdInput.value = moduleDoc.id;
  moduleTitle.value = moduleDoc.title || "";
  moduleSection.value = moduleDoc.sectionId || sections[0]?.id || "";
  moduleType.value = moduleDoc.type || "page";
  currentOrder = moduleDoc.order ?? 0;
  completionMode.value = moduleDoc.completionMode || "mark";
  if (quill) quill.root.innerHTML = moduleDoc.contentHtml || "";
  attachments = moduleDoc.attachments || [];
  quizQuestions = moduleDoc.quiz?.questions || [];
  if (quizRequiredInput) {
    quizRequiredInput.value = moduleDoc.quiz?.requiredCorrect || "";
  }
  renderAttachmentList();
  renderQuestionList();
  toggleModuleType();
  updateVisibility(moduleDoc.status || "draft");
  moduleEditorTitle.textContent = moduleDoc.title || "Edit module";
  lastSavedSnapshot = serializeSnapshot();
}

moduleType.addEventListener("change", () => {
  toggleModuleType();
  scheduleAutosave();
});
if (quizRequiredInput) {
  quizRequiredInput.addEventListener("input", scheduleAutosave);
}
moduleTitle.addEventListener("input", scheduleAutosave);
moduleSection.addEventListener("change", scheduleAutosave);
completionMode.addEventListener("change", scheduleAutosave);
addAttachmentBtn.addEventListener("click", () => {
  attachments.push({ title: "", url: "" });
  renderAttachmentList();
  scheduleAutosave();
});

addQuestionBtn.addEventListener("click", () => {
  quizQuestions.push(createQuestion());
  renderQuestionList();
  scheduleAutosave();
});

moduleForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const submitter = event.submitter;
  const overrideStatus = submitter?.dataset?.moduleStatus;
  await saveModule({
    status: overrideStatus || currentStatus || "draft",
    message: overrideStatus === "published" ? "Module published." : "Module saved as unpublished.",
    redirect: true,
  });
});

if (backToAdmin) {
  backToAdmin.addEventListener("click", () => {
    window.location.href = "./admin.html";
  });
}

requireAuth({
  onAuthed: async (user) => {
    const adminDoc = await getDoc(doc(db, "admins", user.uid));
    if (!adminDoc.exists()) {
      window.location.href = "./admin.html";
      return;
    }

    initQuill();
    await loadSections();
    await loadModules();

    const moduleId = getModuleId();
    const sectionId = getSectionId();

    if (sectionId && !moduleId) {
      moduleSection.value = sectionId;
    }

    if (moduleId) {
      await loadModule(moduleId);
    } else {
      updateVisibility("draft");
      toggleModuleType();
      const targetSection = moduleSection.value || sectionId || sections[0]?.id || "";
      currentOrder = modules.filter((m) => m.sectionId === targetSection).length;
      lastSavedSnapshot = serializeSnapshot();
    }
  },
  onUnauthed: () => {
    window.location.href = "./index.html";
  },
});

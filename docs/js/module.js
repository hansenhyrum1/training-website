import {
  auth,
  db,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
} from "./firebase.js";
import { requireAuth, wireSignOut } from "./auth.js";

const moduleTitle = document.querySelector("#module-title");
const moduleHeading = document.querySelector("#module-heading");
const moduleSection = document.querySelector("#module-section");
const moduleMeta = document.querySelector("#module-meta");
const moduleContent = document.querySelector("#module-content");
const moduleQuiz = document.querySelector("#module-quiz");
const quizForm = document.querySelector("#quiz-form");
const quizStatus = document.querySelector("#quiz-status");
const quizRetakeBtn = document.querySelector("#quiz-retake");
const quizRetakeTopBtn = document.querySelector("#quiz-retake-top");
const quizScoreTop = document.querySelector("#quiz-score-top");
const quizResultModal = document.querySelector("#quiz-result-modal");
const quizResultMessage = document.querySelector("#quiz-result-message");
const quizResultRetake = document.querySelector("#quiz-result-retake");
const quizResultBack = document.querySelector("#quiz-result-back");
const moduleContract = document.querySelector("#module-contract");
const signatureNameInput = document.querySelector("#signature-name");
const signatureCanvas = document.querySelector("#signature-canvas");
const signatureClearBtn = document.querySelector("#signature-clear");
const signatureSubmitBtn = document.querySelector("#signature-submit");
const signatureStatus = document.querySelector("#signature-status");
const markCompleteBtn = document.querySelector("#mark-complete");
const completionStatus = document.querySelector("#completion-status");
const moduleComplete = document.querySelector("#module-complete");
const moduleFooter = document.querySelector("#module-footer");
const returnToModulesTopBtn = document.querySelector("#return-to-modules-top");
const returnToModulesBottomBtn = document.querySelector("#return-to-modules-bottom");
const adminLink = document.querySelector("#admin-link");

let activeQuiz = null;
let quizState = null;
let activeQuizMeta = { userId: null, moduleId: null };
let quizCompleted = false;

wireSignOut("#sign-out");
const goToModules = () => {
  window.location.href = "./training.html";
};
if (returnToModulesTopBtn) returnToModulesTopBtn.addEventListener("click", goToModules);
if (returnToModulesBottomBtn) returnToModulesBottomBtn.addEventListener("click", goToModules);

if (quizRetakeBtn) {
  quizRetakeBtn.addEventListener("click", () => {
    resetQuizProgress();
  });
}

if (quizRetakeTopBtn) {
  quizRetakeTopBtn.addEventListener("click", () => {
    resetQuizProgress();
  });
}

if (quizResultRetake) {
  quizResultRetake.addEventListener("click", () => {
    hideQuizResultModal();
    resetQuizProgress();
  });
}

if (quizResultBack) {
  quizResultBack.addEventListener("click", () => {
    window.location.href = "./training.html";
  });
}

function getModuleId() {
  const params = new URLSearchParams(window.location.search);
  return params.get("id");
}

function formatMeta(moduleDoc) {
  const tags = [];
  const typeLabel = moduleDoc.type === "quiz" ? "Quiz" : moduleDoc.type === "contract" ? "Contract" : "Page";
  tags.push(`<span class="badge">${typeLabel}</span>`);
  return tags.join("");
}

function renderAttachments(attachments = []) {
  if (!attachments.length) return "";
  const items = attachments
    .map((file) => `<li><a href="${file.url}" target="_blank" rel="noopener">${file.title || file.url}</a></li>`)
    .join("");
  return `
    <div class="stack">
      <h3>Attachments</h3>
      <ul>${items}</ul>
    </div>
  `;
}

function renderEmbeds(embeds = []) {
  if (!embeds.length) return "";
  const items = embeds
    .map((embed) => {
      const url = embed.url || "";
      return `
        <div class="stack">
          <strong>${embed.title || "Embedded media"}</strong>
          <iframe src="${url}" loading="lazy" allowfullscreen style="width:100%; min-height:360px; border:0; border-radius:12px;"></iframe>
        </div>
      `;
    })
    .join("");
  return `
    <div class="stack">
      <h3>Embeds</h3>
      ${items}
    </div>
  `;
}

function normalizeQuestion(question) {
  const normalized = { ...question };
  if (normalized.type !== "multiple_choice" && normalized.type !== "true_false") {
    normalized.type = "multiple_choice";
  }

  if (normalized.type === "true_false") {
    normalized.options = ["True", "False"];
  } else {
    normalized.options = Array.isArray(normalized.options) ? normalized.options : [];
    if (!normalized.options.length && Array.isArray(normalized.answers) && normalized.answers.length) {
      normalized.options = normalized.answers.slice();
    }
  }

  let correctIndex = Number.isInteger(normalized.correctIndex) ? normalized.correctIndex : null;
  if (correctIndex === null && Array.isArray(normalized.correctIndexes) && normalized.correctIndexes.length) {
    correctIndex = Number(normalized.correctIndexes[0]);
  }
  if (correctIndex === null && normalized.options.length) {
    correctIndex = 0;
  }
  if (typeof correctIndex === "number" && normalized.options.length) {
    if (correctIndex < 0 || correctIndex >= normalized.options.length) {
      correctIndex = 0;
    }
  }
  if (!normalized.options.length) {
    correctIndex = null;
  }
  normalized.correctIndex = correctIndex;
  return normalized;
}

function coerceSelections(questions, selections) {
  if (!Array.isArray(selections) || selections.length !== questions.length) {
    return Array(questions.length).fill(null);
  }
  return questions.map((q, index) => {
    const value = selections[index];
    if (typeof value !== "number") return null;
    if (!Array.isArray(q.options) || value < 0 || value >= q.options.length) return null;
    return value;
  });
}

function showQuizResultModal(message) {
  if (!quizResultModal || !quizResultMessage) return;
  quizResultMessage.textContent = message;
  if (quizResultRetake) quizResultRetake.disabled = quizCompleted;
  quizResultModal.classList.remove("hidden");
}

function hideQuizResultModal() {
  if (!quizResultModal) return;
  quizResultModal.classList.add("hidden");
}

function updateQuizRetakeButtons() {
  const hasAnswer = quizState?.selections?.some((val) => typeof val === "number");
  const disabled = quizCompleted || !hasAnswer;
  if (quizRetakeBtn) quizRetakeBtn.disabled = disabled;
  if (quizRetakeTopBtn) quizRetakeTopBtn.disabled = disabled;
}

function updateQuizTopScore(text) {
  if (!quizScoreTop) return;
  quizScoreTop.textContent = text || "";
}

async function resetQuizProgress() {
  if (!activeQuiz || quizCompleted) return;
  if (completionStatus) completionStatus.textContent = "";
  if (activeQuizMeta.userId && activeQuizMeta.moduleId) {
    await setDoc(
      doc(db, "progress", activeQuizMeta.userId, "modules", activeQuizMeta.moduleId),
      {
        status: "in_progress",
        quizSelections: [],
        quizScore: null,
        quizMax: null,
        quizPercent: null,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
  }
  hideQuizResultModal();
  renderQuiz(activeQuiz, activeQuizMeta);
}

function renderQuiz(quiz, meta = {}, savedSelections = []) {
  activeQuiz = quiz;
  activeQuizMeta = {
    userId: meta.userId || null,
    moduleId: meta.moduleId || null,
  };
  const questions = (quiz?.questions || []).map(normalizeQuestion);
  quizState = {
    questions,
    selections: coerceSelections(questions, savedSelections),
  };
  quizForm.innerHTML = "";
  quizStatus.textContent = "";
  updateQuizTopScore("");
  updateQuizRetakeButtons();
  if (!quiz?.questions?.length) {
    quizForm.innerHTML = "<p class=\"status\">No questions in this quiz yet.</p>";
    return;
  }

  questions.forEach((q, index) => {
    const card = document.createElement("div");
    card.className = "question-card";
    card.dataset.questionCard = index;
    card.innerHTML = `<strong>Q${index + 1}. ${q.prompt || ""}</strong>`;

    if (!q.options.length) {
      const empty = document.createElement("p");
      empty.className = "status";
      empty.textContent = "No options configured for this question.";
      card.appendChild(empty);
    } else {
      q.options.forEach((opt, optIndex) => {
        const option = document.createElement("button");
        option.type = "button";
        option.className = "quiz-option";
        option.dataset.question = index;
        option.dataset.option = optIndex;
        option.textContent = (opt || "").trim() ? opt : `Option ${optIndex + 1}`;
        option.addEventListener("click", () => {
          if (!quizState) return;
          quizState.selections[index] = optIndex;
          applyFeedback(index);
          updateQuizScore();
        });
        card.appendChild(option);
      });
    }

    quizForm.appendChild(card);
  });

  if (quizState.selections.some((val) => typeof val === "number")) {
    quizState.selections.forEach((_, index) => applyFeedback(index));
    updateQuizScore({ persist: false });
  }
}

function applyFeedback(questionIndex) {
  if (!quizState) return;
  const card = quizForm.querySelector(`[data-question-card='${questionIndex}']`);
  if (!card) return;
  const options = [...card.querySelectorAll(".quiz-option")];
  options.forEach((opt) => opt.classList.remove("correct", "incorrect"));

  const selectedIndex = quizState.selections[questionIndex];
  if (typeof selectedIndex !== "number") return;
  const correctIndex = quizState.questions[questionIndex]?.correctIndex;
  if (typeof correctIndex !== "number") return;

  const selectedBtn = options[selectedIndex];
  if (selectedIndex === correctIndex) {
    if (selectedBtn) selectedBtn.classList.add("correct");
  } else {
    if (selectedBtn) selectedBtn.classList.add("incorrect");
  }

  options.forEach((opt) => {
    opt.disabled = true;
    opt.classList.add("locked");
  });
}

function scoreQuizFromSelections() {
  if (!quizState) return { score: 0, max: 0 };
  let score = 0;
  quizState.questions.forEach((q, index) => {
    const selected = quizState.selections[index];
    if (typeof selected === "number" && selected === q.correctIndex) {
      score += 1;
    }
  });
  return { score, max: quizState.questions.length };
}

async function updateQuizScore({ persist = true } = {}) {
  if (!quizState) return;
  updateQuizRetakeButtons();
  const allAnswered = quizState.selections.every((val) => typeof val === "number");
  if (!allAnswered) {
    quizStatus.textContent = "";
    if (persist && activeQuizMeta.userId && activeQuizMeta.moduleId) {
      await setDoc(
        doc(db, "progress", activeQuizMeta.userId, "modules", activeQuizMeta.moduleId),
        {
          status: "in_progress",
          quizSelections: quizState.selections,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
    }
    return;
  }

  const results = scoreQuizFromSelections();
  const requiredCorrect = Math.min(
    results.max,
    Number(activeQuiz?.requiredCorrect) || results.max
  );
  const scoreText = `Score ${results.score}/${results.max} - Pass: ${requiredCorrect} correct`;
  quizStatus.textContent = scoreText;
  updateQuizTopScore(scoreText);
  const percent = results.max ? (results.score / results.max) * 100 : 0;

  if (!activeQuizMeta.userId || !activeQuizMeta.moduleId) return;
  if (!persist) {
    if (completionStatus) {
      completionStatus.textContent =
        results.score >= requiredCorrect
          ? "Quiz completed."
          : `Needs ${requiredCorrect} correct to complete.`;
    }
    return;
  }
  if (results.score >= requiredCorrect) {
    await markComplete(activeQuizMeta.userId, activeQuizMeta.moduleId, {
      quizScore: results.score,
      quizMax: results.max,
      quizPercent: percent,
      lastAttemptAt: serverTimestamp(),
      quizSelections: quizState.selections,
      type: "quiz",
      requiredCorrect,
    });
    if (completionStatus) {
      completionStatus.textContent = "Quiz completed.";
    }
    quizCompleted = true;
    updateQuizRetakeButtons();
    showQuizResultModal("You passed the quiz.");
  } else {
    await setDoc(
      doc(db, "progress", activeQuizMeta.userId, "modules", activeQuizMeta.moduleId),
      {
        status: "in_progress",
        quizScore: results.score,
        quizMax: results.max,
        quizPercent: percent,
        lastAttemptAt: serverTimestamp(),
        quizSelections: quizState.selections,
        type: "quiz",
        requiredCorrect,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
    if (completionStatus) {
      completionStatus.textContent = `Needs ${requiredCorrect} correct to complete.`;
    }
    showQuizResultModal(
      `You got ${results.score}/${results.max}. You need ${requiredCorrect} correct to pass.`
    );
  }
}

async function markComplete(userId, moduleId, payload) {
  await setDoc(
    doc(db, "progress", userId, "modules", moduleId),
    {
      status: "completed",
      completedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      ...payload,
    },
    { merge: true }
  );
}

async function markInProgress(userId, moduleId) {
  await setDoc(
    doc(db, "progress", userId, "modules", moduleId),
    {
      status: "in_progress",
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
}

function setupSignaturePad() {
  if (!signatureCanvas) return null;
  const ctx = signatureCanvas.getContext("2d");
  const state = { drawing: false, hasStroke: false };

  const resizeCanvas = () => {
    const ratio = window.devicePixelRatio || 1;
    const width = signatureCanvas.clientWidth || 600;
    const height = signatureCanvas.clientHeight || 200;
    signatureCanvas.width = Math.floor(width * ratio);
    signatureCanvas.height = Math.floor(height * ratio);
    signatureCanvas.style.width = `${width}px`;
    signatureCanvas.style.height = `${height}px`;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.strokeStyle = "#1f241b";
  };

  const getPoint = (event) => {
    const rect = signatureCanvas.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
  };

  const start = (event) => {
    state.drawing = true;
    const point = getPoint(event);
    ctx.beginPath();
    ctx.moveTo(point.x, point.y);
  };

  const move = (event) => {
    if (!state.drawing) return;
    const point = getPoint(event);
    ctx.lineTo(point.x, point.y);
    ctx.stroke();
    state.hasStroke = true;
    updateSignatureButton(state.hasStroke);
  };

  const end = () => {
    state.drawing = false;
  };

  signatureCanvas.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    signatureCanvas.setPointerCapture(event.pointerId);
    start(event);
  });
  signatureCanvas.addEventListener("pointermove", move);
  signatureCanvas.addEventListener("pointerup", end);
  signatureCanvas.addEventListener("pointerleave", end);

  resizeCanvas();
  window.addEventListener("resize", resizeCanvas);

  return {
    clear: () => {
      ctx.clearRect(0, 0, signatureCanvas.width, signatureCanvas.height);
      state.hasStroke = false;
      updateSignatureButton(false);
    },
    hasSignature: () => state.hasStroke,
    toDataUrl: () => signatureCanvas.toDataURL("image/png"),
  };
}

function updateSignatureButton(hasStroke) {
  if (!signatureSubmitBtn || !signatureNameInput) return;
  const hasName = signatureNameInput.value.trim().length > 1;
  signatureSubmitBtn.disabled = !(hasStroke && hasName);
}

requireAuth({
  onAuthed: async (user) => {
    const moduleId = getModuleId();
    if (!moduleId) {
      window.location.href = "./training.html";
      return;
    }

    try {
      const adminDoc = await getDoc(doc(db, "admins", user.uid));
      if (adminDoc.exists()) {
        adminLink.classList.remove("hidden");
      }
    } catch (error) {
      if (error?.code !== "permission-denied") {
        throw error;
      }
    }

    const moduleSnap = await getDoc(doc(db, "modules", moduleId));
    if (!moduleSnap.exists()) {
      moduleContent.innerHTML = "<p class=\"status\">Module not found.</p>";
      return;
    }

    const moduleDoc = { id: moduleSnap.id, ...moduleSnap.data() };
    moduleTitle.textContent = moduleDoc.title || "Module";
    moduleHeading.textContent = moduleDoc.title || "Module";
    moduleMeta.innerHTML = formatMeta(moduleDoc);

    if (moduleDoc.sectionId) {
      const sectionSnap = await getDoc(doc(db, "sections", moduleDoc.sectionId));
      if (sectionSnap.exists()) {
        moduleSection.textContent = sectionSnap.data().title || "Section";
      }
    }

    const progressSnap = await getDoc(doc(db, "progress", user.uid, "modules", moduleId));
    const progressData = progressSnap.exists() ? progressSnap.data() : null;
    quizCompleted = progressData?.status === "completed";
    if (quizCompleted) {
      completionStatus.textContent = "Already completed.";
      markCompleteBtn.disabled = true;
    } else {
      await markInProgress(user.uid, moduleId);
    }

    if (moduleDoc.type === "quiz") {
      moduleQuiz.classList.remove("hidden");
      if (moduleFooter) moduleFooter.classList.add("hidden");
      renderQuiz(moduleDoc.quiz, { userId: user.uid, moduleId }, progressData?.quizSelections || []);
      markCompleteBtn.classList.add("hidden");
      const quizIntro = moduleDoc.contentHtml || "";
      const introText = quizIntro.replace(/<[^>]*>/g, "").trim();
      if (introText) {
        moduleContent.classList.remove("hidden");
        moduleContent.innerHTML = `
          <div class="ql-snow">
            <div class="module-content-body ql-editor">${quizIntro}</div>
          </div>
        `;
      } else {
        moduleContent.classList.add("hidden");
      }
      if (progressData?.quizScore !== null && progressData?.quizMax) {
        const requiredCorrect = Math.min(
          progressData.quizMax,
          Number(progressData.requiredCorrect) || progressData.quizMax
        );
        const scoreText = `Score ${progressData.quizScore}/${progressData.quizMax} - Pass: ${requiredCorrect} correct`;
        updateQuizTopScore(scoreText);
        quizStatus.textContent = scoreText;
      }
      updateQuizRetakeButtons();
    } else if (moduleDoc.type === "contract") {
      if (moduleFooter) moduleFooter.classList.remove("hidden");
      moduleContract.classList.remove("hidden");
      markCompleteBtn.classList.add("hidden");
      const contentHtml = moduleDoc.contentHtml || "<p class=\"status\">No contract content yet.</p>";
      moduleContent.innerHTML = [
        "<div class=\"ql-snow\"><div class=\"module-content-body ql-editor\">",
        contentHtml,
        renderAttachments(moduleDoc.attachments),
        renderEmbeds(moduleDoc.embeds),
        "</div></div>",
      ].join("");

      const pad = setupSignaturePad();
      if (progressData?.signatureName) {
        signatureNameInput.value = progressData.signatureName;
      }
      if (progressData?.signatureDataUrl) {
        const img = new Image();
        img.onload = () => {
          const ctx = signatureCanvas.getContext("2d");
          ctx.clearRect(0, 0, signatureCanvas.width, signatureCanvas.height);
          ctx.drawImage(img, 0, 0, signatureCanvas.clientWidth, signatureCanvas.clientHeight);
        };
        img.src = progressData.signatureDataUrl;
      }
      if (progressData?.signedAt?.toDate) {
        const signedAt = progressData.signedAt.toDate();
        signatureStatus.textContent = `Signed on ${signedAt.toLocaleString()}.`;
      } else if (progressData?.signedAt) {
        signatureStatus.textContent = "Signed.";
      }
      if (progressData?.status === "completed") {
        signatureSubmitBtn.disabled = true;
        signatureNameInput.disabled = true;
        signatureClearBtn.disabled = true;
      }

      signatureNameInput.addEventListener("input", () => {
        updateSignatureButton(pad?.hasSignature());
      });
      signatureClearBtn.addEventListener("click", () => {
        pad?.clear();
        signatureStatus.textContent = "";
      });

      signatureSubmitBtn.addEventListener("click", async () => {
        const name = signatureNameInput.value.trim();
        if (!name || !pad?.hasSignature()) return;
        const dataUrl = pad.toDataUrl();
        await markComplete(user.uid, moduleId, {
          type: "contract",
          signatureName: name,
          signatureDataUrl: dataUrl,
          signedAt: serverTimestamp(),
        });
        signatureStatus.textContent = "Signed.";
        signatureSubmitBtn.disabled = true;
        signatureNameInput.disabled = true;
        signatureClearBtn.disabled = true;
        completionStatus.textContent = "Contract signed.";
      });
    } else {
      if (moduleFooter) moduleFooter.classList.remove("hidden");
      const contentHtml = moduleDoc.contentHtml || "<p class=\"status\">No content yet.</p>";
      moduleContent.innerHTML = [
        "<div class=\"ql-snow\"><div class=\"module-content-body ql-editor\">",
        contentHtml,
        renderAttachments(moduleDoc.attachments),
        renderEmbeds(moduleDoc.embeds),
        "</div></div>",
      ].join("");

      markCompleteBtn.addEventListener("click", async () => {
        await markComplete(user.uid, moduleId, { type: "page", completionMode: "mark" });
        completionStatus.textContent = "Module completed.";
        markCompleteBtn.disabled = true;
      });
    }
  },
  onUnauthed: () => {
    window.location.href = "./index.html";
  },
});

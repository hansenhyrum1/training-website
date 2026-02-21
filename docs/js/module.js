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
const moduleSummary = document.querySelector("#module-summary");
const moduleSection = document.querySelector("#module-section");
const moduleMeta = document.querySelector("#module-meta");
const moduleContent = document.querySelector("#module-content");
const moduleQuiz = document.querySelector("#module-quiz");
const quizForm = document.querySelector("#quiz-form");
const quizStatus = document.querySelector("#quiz-status");
const markCompleteBtn = document.querySelector("#mark-complete");
const completionStatus = document.querySelector("#completion-status");
const adminLink = document.querySelector("#admin-link");

wireSignOut("#sign-out");

function getModuleId() {
  const params = new URLSearchParams(window.location.search);
  return params.get("id");
}

function formatMeta(moduleDoc) {
  const tags = [];
  tags.push(`<span class="badge">${moduleDoc.type === "quiz" ? "Quiz" : "Page"}</span>`);
  tags.push(`<span>${moduleDoc.status || "draft"}</span>`);
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

function renderQuiz(quiz) {
  quizForm.innerHTML = "";
  if (!quiz?.questions?.length) {
    quizForm.innerHTML = "<p class=\"status\">No questions in this quiz yet.</p>";
    return;
  }

  quiz.questions.forEach((q, index) => {
    const card = document.createElement("div");
    card.className = "question-card";
    card.innerHTML = `<strong>Q${index + 1}. ${q.prompt || ""}</strong>`;

    if (q.type === "multiple_choice" || q.type === "true_false") {
      const options = q.options || [];
      options.forEach((opt, optIndex) => {
        const label = document.createElement("label");
        label.innerHTML = `
          <input type="radio" name="q-${index}" value="${optIndex}" />
          ${opt}
        `;
        card.appendChild(label);
      });
    }

    if (q.type === "multiple_select") {
      const options = q.options || [];
      options.forEach((opt, optIndex) => {
        const label = document.createElement("label");
        label.innerHTML = `
          <input type="checkbox" name="q-${index}" value="${optIndex}" />
          ${opt}
        `;
        card.appendChild(label);
      });
    }

    if (q.type === "short_answer") {
      const input = document.createElement("input");
      input.type = "text";
      input.name = `q-${index}`;
      input.placeholder = "Your answer";
      card.appendChild(input);
    }

    quizForm.appendChild(card);
  });

  const submit = document.createElement("button");
  submit.type = "submit";
  submit.className = "primary";
  submit.textContent = "Submit quiz";
  quizForm.appendChild(submit);
}

function scoreQuiz(quiz) {
  const results = { score: 0, max: quiz.questions.length };

  quiz.questions.forEach((q, index) => {
    const name = `q-${index}`;
    if (q.type === "multiple_choice" || q.type === "true_false") {
      const selected = quizForm.querySelector(`input[name='${name}']:checked`);
      if (selected && Number(selected.value) === Number(q.correctIndex)) {
        results.score += 1;
      }
    } else if (q.type === "multiple_select") {
      const selected = [...quizForm.querySelectorAll(`input[name='${name}']:checked`)].map((el) => Number(el.value));
      const correct = (q.correctIndexes || []).map((n) => Number(n));
      selected.sort();
      correct.sort();
      if (selected.length === correct.length && selected.every((v, i) => v === correct[i])) {
        results.score += 1;
      }
    } else if (q.type === "short_answer") {
      const input = quizForm.querySelector(`input[name='${name}']`);
      const value = (input?.value || "").trim();
      const answers = (q.answers || []).map((a) => (q.caseSensitive ? a : a.toLowerCase()));
      const check = q.caseSensitive ? value : value.toLowerCase();
      if (answers.includes(check)) {
        results.score += 1;
      }
    }
  });

  return results;
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

requireAuth({
  onAuthed: async (user) => {
    const moduleId = getModuleId();
    if (!moduleId) {
      window.location.href = "./training.html";
      return;
    }

    const adminDoc = await getDoc(doc(db, "admins", user.uid));
    if (adminDoc.exists()) {
      adminLink.classList.remove("hidden");
    }

    const moduleSnap = await getDoc(doc(db, "modules", moduleId));
    if (!moduleSnap.exists()) {
      moduleContent.innerHTML = "<p class=\"status\">Module not found.</p>";
      return;
    }

    const moduleDoc = { id: moduleSnap.id, ...moduleSnap.data() };
    moduleTitle.textContent = moduleDoc.title || "Module";
    moduleHeading.textContent = moduleDoc.title || "Module";
    moduleSummary.textContent = moduleDoc.summary || "";
    moduleMeta.innerHTML = formatMeta(moduleDoc);

    if (moduleDoc.sectionId) {
      const sectionSnap = await getDoc(doc(db, "sections", moduleDoc.sectionId));
      if (sectionSnap.exists()) {
        moduleSection.textContent = sectionSnap.data().title || "Section";
      }
    }

    const progressSnap = await getDoc(doc(db, "progress", user.uid, "modules", moduleId));
    if (progressSnap.exists() && progressSnap.data().status === "completed") {
      completionStatus.textContent = "Already completed.";
      markCompleteBtn.disabled = true;
    } else {
      await markInProgress(user.uid, moduleId);
    }

    if (moduleDoc.type === "quiz") {
      moduleQuiz.classList.remove("hidden");
      renderQuiz(moduleDoc.quiz);
      markCompleteBtn.classList.add("hidden");
      moduleContent.innerHTML = moduleDoc.contentHtml || "<p class=\"status\">No intro content yet.</p>";
      quizForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        const results = scoreQuiz(moduleDoc.quiz);
        const percent = results.max ? (results.score / results.max) * 100 : 0;
        quizStatus.textContent = `Score: ${results.score}/${results.max} (${Math.round(percent)}%)`;
        await markComplete(user.uid, moduleId, {
          quizScore: results.score,
          quizMax: results.max,
          quizPercent: percent,
          lastAttemptAt: serverTimestamp(),
          type: "quiz",
        });
        completionStatus.textContent = "Quiz completed.";
      });
    } else {
      moduleContent.innerHTML = `
        <div class="stack">
          ${moduleDoc.contentHtml || "<p class=\\"status\\">No content yet.</p>"}
          ${renderAttachments(moduleDoc.attachments)}
          ${renderEmbeds(moduleDoc.embeds)}
        </div>
      `;

      if (moduleDoc.completionMode === "scroll") {
        markCompleteBtn.textContent = "Scroll to complete";
        markCompleteBtn.disabled = true;
        const onScroll = () => {
          const scrollBottom = window.innerHeight + window.scrollY;
          const pageBottom = document.body.offsetHeight - 40;
          if (scrollBottom >= pageBottom) {
            markCompleteBtn.disabled = false;
            markCompleteBtn.textContent = "Marked complete";
            markComplete(user.uid, moduleId, { type: "page", completionMode: "scroll" });
            completionStatus.textContent = "Module completed.";
            window.removeEventListener("scroll", onScroll);
          }
        };
        window.addEventListener("scroll", onScroll);
      }

      markCompleteBtn.addEventListener("click", async () => {
        if (moduleDoc.completionMode === "scroll") return;
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

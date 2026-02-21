import {
  db,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  orderBy,
  where,
} from "./firebase.js";
import { requireAuth, wireSignOut } from "./auth.js";

const welcomeMessage = document.querySelector("#welcome-message");
const adminLink = document.querySelector("#admin-link");
const sectionList = document.querySelector("#section-list");
const moduleList = document.querySelector("#module-list");
const moduleEmpty = document.querySelector("#module-empty");

wireSignOut("#sign-out");

let sections = [];
let modules = [];
let progressByModule = {};
let selectedSectionId = null;

function getSectionModules(sectionId) {
  return modules.filter((m) => m.sectionId === sectionId);
}

function isModuleComplete(moduleId) {
  return progressByModule[moduleId]?.status === "completed";
}

function isSectionComplete(sectionId) {
  const items = getSectionModules(sectionId);
  if (!items.length) return false;
  return items.every((m) => isModuleComplete(m.id));
}

function renderSectionList() {
  sectionList.innerHTML = "";
  if (!sections.length) {
    sectionList.innerHTML = "<p class=\"status\">No sections yet.</p>";
    return;
  }

  sections.forEach((section) => {
    const card = document.createElement("button");
    card.className = "section-card" + (section.id === selectedSectionId ? " active" : "");
    const complete = isSectionComplete(section.id);
    card.innerHTML = `
      <strong>${section.title || "Untitled section"}</strong>
      <span class="status">${section.summary || ""}</span>
      ${complete ? '<span class="badge">Complete</span>' : ""}
    `;
    card.addEventListener("click", () => {
      selectedSectionId = section.id;
      renderSectionList();
      renderModuleList();
    });
    sectionList.appendChild(card);
  });
}

function renderModuleList() {
  moduleList.innerHTML = "";
  const sectionModules = getSectionModules(selectedSectionId);

  if (!sectionModules.length) {
    moduleEmpty.classList.remove("hidden");
    return;
  }
  moduleEmpty.classList.add("hidden");

  sectionModules.forEach((module) => {
    const status = progressByModule[module.id]?.status || "not_started";
    const score = progressByModule[module.id]?.quizPercent;
    const badge = status === "completed" ? "Complete" : "Not started";
    const scoreText = typeof score === "number" ? `Score: ${Math.round(score)}%` : "";

    const card = document.createElement("div");
    card.className = "module-item";
    card.innerHTML = `
      <strong>${module.title || "Untitled module"}</strong>
      <span class="status">${module.summary || ""}</span>
      <div class="module-meta">
        <span class="badge">${module.type === "quiz" ? "Quiz" : "Page"}</span>
        <span>${badge}</span>
        ${scoreText ? `<span>${scoreText}</span>` : ""}
      </div>
      <div class="actions">
        <a class="primary" href="./module.html?id=${module.id}">Open module</a>
      </div>
    `;
    moduleList.appendChild(card);
  });
}

async function loadTrainingData(user, isAdmin) {
  const sectionsQuery = isAdmin
    ? query(collection(db, "sections"), orderBy("order", "asc"))
    : query(collection(db, "sections"), where("status", "==", "published"), orderBy("order", "asc"));
  const modulesQuery = isAdmin
    ? query(collection(db, "modules"), orderBy("order", "asc"))
    : query(collection(db, "modules"), where("status", "==", "published"), orderBy("order", "asc"));

  const [sectionsSnap, modulesSnap, progressSnap] = await Promise.all([
    getDocs(sectionsQuery),
    getDocs(modulesQuery),
    getDocs(collection(db, "progress", user.uid, "modules")),
  ]);

  sections = sectionsSnap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
  modules = modulesSnap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
  progressByModule = {};
  progressSnap.forEach((docSnap) => {
    progressByModule[docSnap.id] = docSnap.data();
  });

  selectedSectionId = sections[0]?.id || null;
  renderSectionList();
  renderModuleList();
}

requireAuth({
  onAuthed: async (user) => {
    welcomeMessage.textContent = `Signed in as ${user.email}`;

    const adminDoc = await getDoc(doc(db, "admins", user.uid));
    const isAdmin = adminDoc.exists();
    if (adminDoc.exists()) {
      adminLink.classList.remove("hidden");
    }

    await loadTrainingData(user, isAdmin);
  },
  onUnauthed: () => {
    window.location.href = "./index.html";
  },
});

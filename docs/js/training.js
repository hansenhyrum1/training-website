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

function getSectionIdFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return params.get("sectionId");
}

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
    const completedText = status === "completed" ? "Completed" : "Not completed";
    const completedClass = status === "completed" ? "badge-success" : "badge-danger";
    const scoreText = typeof score === "number" ? `Score: ${Math.round(score)}%` : "";
    const typeLabel = module.type === "quiz" ? "Quiz" : module.type === "contract" ? "Contract" : "Page";

    const card = document.createElement("div");
    card.className = "module-item";
    card.setAttribute("role", "button");
    card.setAttribute("tabindex", "0");
    card.innerHTML = `
      <div class="module-item-header">
        <strong>${module.title || "Untitled module"}</strong>
        <span class="badge badge-large ${completedClass}">${completedText}</span>
      </div>
      <div class="module-meta">
        <span class="badge">${typeLabel}</span>
        ${scoreText ? `<span>${scoreText}</span>` : ""}
      </div>
    `;
    const openModule = () => {
      const sectionParam = module.sectionId ? `&sectionId=${module.sectionId}` : "";
      window.location.href = `./module.html?id=${module.id}${sectionParam}`;
    };
    card.addEventListener("click", openModule);
    card.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openModule();
      }
    });
    moduleList.appendChild(card);
  });
}

async function loadTrainingData(user, isAdmin) {
  const sectionsQuery = isAdmin
    ? query(collection(db, "sections"), orderBy("order", "asc"))
    : query(collection(db, "sections"), where("status", "==", "published"));
  const modulesQuery = isAdmin
    ? query(collection(db, "modules"), orderBy("order", "asc"))
    : query(collection(db, "modules"), where("status", "==", "published"));

  const [sectionsSnap, modulesSnap, progressSnap] = await Promise.all([
    getDocs(sectionsQuery),
    getDocs(modulesQuery),
    getDocs(collection(db, "progress", user.uid, "modules")),
  ]);

  const allSections = sectionsSnap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
  const allModules = modulesSnap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
  const visibleSections = allSections.filter((section) => section.status === "published");
  const visibleSectionIds = new Set(visibleSections.map((section) => section.id));
  const visibleModules = allModules.filter(
    (module) => module.status === "published" && visibleSectionIds.has(module.sectionId)
  );

  const sortByOrder = (a, b) => (a.order ?? 0) - (b.order ?? 0);
  sections = visibleSections.sort(sortByOrder);
  modules = visibleModules.sort(sortByOrder);
  progressByModule = {};
  progressSnap.forEach((docSnap) => {
    progressByModule[docSnap.id] = docSnap.data();
  });

  const initialSectionId = getSectionIdFromUrl();
  if (initialSectionId && sections.some((section) => section.id === initialSectionId)) {
    selectedSectionId = initialSectionId;
  } else {
    selectedSectionId = sections[0]?.id || null;
  }
  renderSectionList();
  renderModuleList();
}

requireAuth({
  onAuthed: async (user) => {
    welcomeMessage.textContent = `Signed in as ${user.email}`;

    let isAdmin = false;
    try {
      const adminDoc = await getDoc(doc(db, "admins", user.uid));
      isAdmin = adminDoc.exists();
      if (adminDoc.exists()) {
        adminLink.classList.remove("hidden");
      }
    } catch (error) {
      if (error?.code !== "permission-denied") {
        throw error;
      }
    }

    await loadTrainingData(user, isAdmin);
  },
  onUnauthed: () => {
    window.location.href = "./index.html";
  },
});

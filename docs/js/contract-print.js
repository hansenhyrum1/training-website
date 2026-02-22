import {
  auth,
  db,
  defaultDb,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  orderBy,
} from "./firebase.js";
import { requireAuth } from "./auth.js";

const printRoot = document.querySelector("#print-root");

function getParams() {
  const params = new URLSearchParams(window.location.search);
  return {
    contractId: params.get("contractId"),
    userId: params.get("userId"),
    mode: params.get("mode") || "signed",
  };
}

function renderMessage(text) {
  if (!printRoot) return;
  printRoot.innerHTML = `<p class="status">${text}</p>`;
}

function formatTimestamp(ts) {
  if (!ts) return "";
  if (ts.toDate) {
    return ts.toDate().toLocaleString();
  }
  return String(ts);
}

async function renderSigned(contractDoc, userDoc, progress) {
  const name = userDoc?.fullName || userDoc?.email || userDoc?.uid || "User";
  const signedAt = formatTimestamp(progress?.signedAt);
  const signatureName = progress?.signatureName || "";
  const signatureDataUrl = progress?.signatureDataUrl || "";

  printRoot.innerHTML = `
    <h2>${contractDoc.title || "Contract"}</h2>
    <p class="status">${contractDoc.summary || ""}</p>
    <div class="stack">
      ${contractDoc.contentHtml || "<p class=\"status\">No contract content.</p>"}
    </div>
    <div class="signature-block">
      <p><strong>Signed by:</strong> ${signatureName || name}</p>
      ${signedAt ? `<p class="status">Signed on ${signedAt}</p>` : "<p class=\"status\">Unsigned</p>"}
      ${signatureDataUrl ? `<img src="${signatureDataUrl}" alt="Signature" />` : ""}
    </div>
  `;
}

async function renderRoster(contractDoc) {
  const usersSnap = await getDocs(query(collection(defaultDb, "users"), orderBy("email")));
  const users = usersSnap.docs.map((docSnap) => ({ uid: docSnap.id, ...docSnap.data() }));

  const progressDocs = await Promise.all(
    users.map((user) => getDoc(doc(db, "progress", user.uid, "modules", contractDoc.id)))
  );

  const rows = users.map((user, index) => {
    const progress = progressDocs[index].exists() ? progressDocs[index].data() : null;
    const signed = progress?.status === "completed";
    const signedAt = formatTimestamp(progress?.signedAt);
    return `
      <tr>
        <td>${user.fullName || user.email || user.uid}</td>
        <td>${signed ? "Signed" : "Unsigned"}</td>
        <td>${signedAt || ""}</td>
      </tr>
    `;
  });

  printRoot.innerHTML = `
    <h2>${contractDoc.title || "Contract"} — Roster</h2>
    <p class="status">${contractDoc.summary || ""}</p>
    <table class="roster-table">
      <thead>
        <tr>
          <th>User</th>
          <th>Status</th>
          <th>Signed At</th>
        </tr>
      </thead>
      <tbody>
        ${rows.join("")}
      </tbody>
    </table>
  `;
}

requireAuth({
  onAuthed: async (user) => {
    const adminDoc = await getDoc(doc(db, "admins", user.uid));
    if (!adminDoc.exists()) {
      renderMessage("Access denied.");
      return;
    }

    const { contractId, userId, mode } = getParams();
    if (!contractId) {
      renderMessage("Missing contract id.");
      return;
    }

    const contractSnap = await getDoc(doc(db, "modules", contractId));
    if (!contractSnap.exists()) {
      renderMessage("Contract not found.");
      return;
    }

    const contractDoc = { id: contractSnap.id, ...contractSnap.data() };
    if (mode === "roster") {
      await renderRoster(contractDoc);
    } else {
      if (!userId) {
        renderMessage("Missing user id.");
        return;
      }
      const userSnap = await getDoc(doc(defaultDb, "users", userId));
      const userDoc = userSnap.exists() ? { uid: userSnap.id, ...userSnap.data() } : { uid: userId };
      const progressSnap = await getDoc(doc(db, "progress", userId, "modules", contractId));
      const progress = progressSnap.exists() ? progressSnap.data() : null;
      await renderSigned(contractDoc, userDoc, progress);
    }

    setTimeout(() => window.print(), 300);
  },
  onUnauthed: () => {
    renderMessage("Not signed in.");
  },
});

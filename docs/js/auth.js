import {
  auth,
  onAuthStateChanged,
  signOut,
} from "./firebase.js";

export function wireSignOut(buttonId) {
  const btn = document.querySelector(buttonId);
  if (!btn) return;
  btn.addEventListener("click", async () => {
    await signOut(auth);
    window.location.href = "./index.html";
  });
}

export function requireAuth({ onAuthed, onUnauthed }) {
  return onAuthStateChanged(auth, (user) => {
    if (user) {
      onAuthed(user);
    } else if (onUnauthed) {
      onUnauthed();
    }
  });
}

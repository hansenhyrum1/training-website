import { auth, signInWithEmailAndPassword, onAuthStateChanged } from "./firebase.js";

const statusEl = document.querySelector("#auth-status");
const form = document.querySelector("#auth-form");

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.style.color = isError ? "#b54747" : "#4a4a44";
}

onAuthStateChanged(auth, (user) => {
  if (user) {
    window.location.href = "./training.html";
  }
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const email = document.querySelector("#email").value.trim();
  const password = document.querySelector("#password").value;

  setStatus("Signing in...");
  try {
    await signInWithEmailAndPassword(auth, email, password);
  } catch (error) {
    setStatus(error.message, true);
  }
});

// Account creation happens in the app, not on the web login.

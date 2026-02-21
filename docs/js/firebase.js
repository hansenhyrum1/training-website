import { initializeApp } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js";
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";
import {
  getFirestore,
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
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyA6gQ30F8tflaZRmnk7c8T0XQdHGB6Cubw",
  authDomain: "employee-app-992de.firebaseapp.com",
  projectId: "employee-app-992de",
  storageBucket: "training-website-992de",
  messagingSenderId: "772817926933",
  appId: "1:772817926933:web:c301171fdd8517da40c71c",
  measurementId: "G-C95V04ZRVK",
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const defaultDb = getFirestore(app);
const db = getFirestore(app, "training-website");

export {
  auth,
  db,
  defaultDb,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
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
};

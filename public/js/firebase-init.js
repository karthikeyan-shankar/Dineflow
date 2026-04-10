// ─── Firebase Initialization ──────────────────────────────────────────
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyBElMvTQbTY-YsTTxCUHYhiU70wVjZ8Zz8",
  authDomain: "dineflow-ebddd.firebaseapp.com",
  projectId: "dineflow-ebddd",
  storageBucket: "dineflow-ebddd.firebasestorage.app",
  messagingSenderId: "837028566431",
  appId: "1:837028566431:web:cf5652094fdd855b7919aa",
  measurementId: "G-YGHT5KL4FZ"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

export { auth, signInWithEmailAndPassword, createUserWithEmailAndPassword, onAuthStateChanged, signOut };

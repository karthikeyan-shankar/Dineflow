import { auth, onAuthStateChanged, signOut } from '/js/firebase-init.js';

// Setup Auth State Listener to protect the page
onAuthStateChanged(auth, (user) => {
    if (user) {
        // User is signed in, reveal the dashboard body
        document.body.style.display = 'block';
    } else {
        // User is signed out, redirect to login
        window.location.href = '/admin-login';
    }
});

// Expose logout function globally so HTML inline onclick handlers can use it
window.logoutAdmin = async function() {
    try {
        await signOut(auth);
        window.location.href = '/admin-login';
    } catch (error) {
        console.error("Error signing out: ", error);
    }
};

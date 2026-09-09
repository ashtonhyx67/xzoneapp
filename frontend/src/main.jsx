import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App.jsx";
import { AuthProvider } from "./context/AuthContext.jsx";
import "./styles/index.css";
// Imported for the side effect: it listens for beforeinstallprompt, which fires
// once and usually before React has mounted.
import "./lib/install.js";

// Chrome will not offer to install a site without a service worker registered,
// however complete its manifest is. This one deliberately caches nothing — it
// exists to make the app installable, and caching here would fight the update
// check, which works by asking the server for index.html.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Blocked, unsupported, or served over plain HTTP. The app works either
      // way; only the install offer is lost.
    });
  });
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
);

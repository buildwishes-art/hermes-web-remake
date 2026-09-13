import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import "./index.css";
import App from "./App";
import { SystemActionsProvider } from "./contexts/SystemActions";
import { I18nProvider } from "./i18n";
import { exposePluginSDK } from "./plugins";
import { HERMES_BASE_PATH } from "./lib/api";
import { initAppearance } from "./lib/appearance";

// Stamp the stored appearance before the first paint — otherwise the page
// renders dark and then corrects itself in front of the user.
initAppearance();

// Expose the plugin SDK before rendering so plugins loaded via <script>
// can access React, components, etc. immediately.
exposePluginSDK();

createRoot(document.getElementById("root")!).render(
  <BrowserRouter basename={HERMES_BASE_PATH || undefined}>
    <I18nProvider>
      <SystemActionsProvider>
        <App />
      </SystemActionsProvider>
    </I18nProvider>
  </BrowserRouter>,
);

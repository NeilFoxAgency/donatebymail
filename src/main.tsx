import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import "./site-flow.css";
import "./header-responsive.css";
import "./pledge.css";
import "./progress-fix.css";
import "./homepage-refresh.css";
import "./document-flow.css";
import "./social-footer.css";
import "./operations.css";
import "./gen2/gen2.css";
import "./articles.css";
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

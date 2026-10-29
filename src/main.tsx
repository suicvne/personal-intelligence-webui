import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app.tsx";
import { AppModelProvider } from "./state/app_context.tsx";
import { AppModel } from "./state/app_model.ts";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/layout.css";
import "./styles/screens.css";

const model = new AppModel();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppModelProvider model={model}>
      <App />
    </AppModelProvider>
  </StrictMode>,
);

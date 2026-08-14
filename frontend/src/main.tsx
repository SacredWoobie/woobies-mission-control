import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { bootstrapTheme } from "./theme";
import "./styles.css";
import "./resonantOrbit/resonantOrbit.css";

bootstrapTheme();

const root = document.getElementById("root");

if (!root) {
  throw new Error("Mission Control root element was not found.");
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

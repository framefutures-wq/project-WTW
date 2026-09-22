import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import RegionQuickSwitch from "./RegionQuickSwitch";
import CategoryQuickSwitch from "./CategoryQuickSwitch";
import "./styles.css";
import "./redesign.css";
import "./region-drawer.css";
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <RegionQuickSwitch />
    <CategoryQuickSwitch />
    <App />
  </React.StrictMode>,
);

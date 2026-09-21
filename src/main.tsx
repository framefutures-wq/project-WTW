import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import RegionQuickSwitch from "./RegionQuickSwitch";
import "./styles.css";
import "./redesign.css";
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <RegionQuickSwitch />
    <App />
  </React.StrictMode>,
);

import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App.js";
import "@mantine/core/styles.css";
import "@mantine/spotlight/styles.css";
import "@reinss/ui/styles.css";
import "./app.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

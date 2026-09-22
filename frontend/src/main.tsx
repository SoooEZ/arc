import React from "react";
import ReactDOM from "react-dom/client";
import { CssBaseline, ThemeProvider } from "@mui/material";
import "@fontsource-variable/inter";
import "@fontsource/jetbrains-mono/400.css";
import "@xyflow/react/dist/style.css";
import "./styles/index.css";
import App from "./App";
import { theme } from "./app/theme";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <App />
    </ThemeProvider>
  </React.StrictMode>,
);

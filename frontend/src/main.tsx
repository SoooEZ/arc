import React from "react";
import ReactDOM from "react-dom/client";
import { CssBaseline, ThemeProvider } from "@mui/material";
import "@fontsource-variable/inter";
import "@fontsource/jetbrains-mono/400.css";
import "./styles/index.css";
import App from "./App";
import { theme } from "./app/theme";
import { RecoverableBoundary } from "./app/RecoverableBoundary";
import { watchChunkLoadFailures } from "./app/chunkLoadFailures";

watchChunkLoadFailures(window);

ReactDOM.createRoot(document.getElementById("root")!, {
  // Boundaries keep the page usable; the console still records what failed and
  // where. reportError also raises the window error event for uncaught failures.
  onCaughtError: (error, info) =>
    console.error(
      "ARC recovered from a rendering error:",
      error,
      info.componentStack,
    ),
  onUncaughtError: (error, info) => {
    console.error(
      "ARC could not recover from a rendering error:",
      error,
      info.componentStack,
    );
    reportError(error);
  },
}).render(
  <React.StrictMode>
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <RecoverableBoundary title="ARC stopped working">
        <App />
      </RecoverableBoundary>
    </ThemeProvider>
  </React.StrictMode>,
);

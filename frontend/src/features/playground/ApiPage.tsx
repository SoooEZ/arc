import { Button, Chip } from "@mui/material";
import { ArrowRight, Braces, CheckCircle2, Terminal } from "lucide-react";
import { pagePath } from "../../app/routing";
import ApiReference from "./ApiReference";
import PlaygroundConsole from "./PlaygroundConsole";

/**
 * The API pages: `#/docs` explains the API and lists its endpoints;
 * `#/playground` calls a published rule (PlaygroundConsole).
 */
export default function ApiPage({
  mode,
  notify,
  navigate,
}: {
  mode: "docs" | "playground";
  notify: (s: string) => void;
  navigate: (path: string) => void;
}) {
  return (
    <div className="api-page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">
            <span />
            {mode === "docs" ? "BUILT TO CONNECT" : "MAKE THE CALL"}
          </div>
          <h1>
            {mode === "docs" ? "Your logic, on demand." : "API playground"}
          </h1>
          <p>
            {mode === "docs"
              ? "A simple HTTP API for every rule, formula, and decision tree."
              : "Call a published rule and inspect the complete response."}
          </p>
        </div>
        <Chip className="published-chip" label="No authentication required" />
      </div>
      {mode === "docs" && (
        <div className="api-intro-cards">
          <div>
            <span>01</span>
            <Braces size={22} />
            <h3>Build & publish</h3>
            <p>
              Define your inputs, connect the logic, and publish an immutable
              version.
            </p>
          </div>
          <div>
            <span>02</span>
            <Terminal size={22} />
            <h3>Send your inputs</h3>
            <p>
              POST a JSON object from any language, service, or command line.
            </p>
          </div>
          <div>
            <span>03</span>
            <CheckCircle2 size={22} />
            <h3>Get the whole story</h3>
            <p>
              Receive the result, executed version, timing, and an optional
              execution trace.
            </p>
          </div>
        </div>
      )}
      {mode === "docs" ? (
        <>
          <section className="api-try">
            <Terminal size={18} />
            <div>
              <strong>Try a live request</strong>
              <p>
                Choose a published rule, edit its inputs and see the complete
                response with a matching cURL command.
              </p>
            </div>
            <Button
              variant="outlined"
              endIcon={<ArrowRight size={15} />}
              onClick={() => navigate(pagePath("playground"))}
            >
              Open the API playground
            </Button>
          </section>
          <ApiReference />
        </>
      ) : (
        <PlaygroundConsole notify={notify} />
      )}
    </div>
  );
}

import { TextField } from "@mui/material";
import type { SourceConfig } from "../../types";
import { sourceParameterBufferError, type SourceBuffers } from "./model";
import {
  httpTimeoutGuidance,
  httpUrlProblem,
  parseHttpTimeout,
} from "./sourceDocument";
import { identifierGuidance } from "../../domain/identifiers";

export default function SourceConfigurationFields({
  configuration,
  buffers,
  timeout,
  disabled,
  onConfig,
  onBuffer,
  onTimeout,
}: {
  configuration: SourceConfig;
  buffers: SourceBuffers;
  /** Raw timeout text, kept as typed so it can be cleared and retyped. */
  timeout: string;
  disabled: boolean;
  onConfig: (patch: Partial<SourceConfig>) => void;
  onBuffer: (field: keyof SourceBuffers, value: string) => void;
  onTimeout: (text: string) => void;
}) {
  const http = configuration.kind === "HTTP";
  const parametersError = sourceParameterBufferError(buffers.parameters);
  const timeoutInvalid = parseHttpTimeout(timeout) === null;
  const urlProblem = http ? httpUrlProblem(configuration.url || "") : null;
  return (
    <>
      {http && (
        <>
          <TextField
            label="HTTP URL"
            placeholder="https://api.example.com/customer"
            value={configuration.url || ""}
            disabled={disabled}
            error={!!urlProblem}
            onChange={(event) => onConfig({ url: event.target.value })}
            helperText={
              urlProblem ??
              "Mapped parameters become URL-encoded query parameters. The response must be JSON."
            }
          />
          <TextField
            label="Timeout (ms)"
            value={timeout}
            disabled={disabled}
            error={timeoutInvalid}
            helperText={timeoutInvalid ? httpTimeoutGuidance : undefined}
            slotProps={{ htmlInput: { inputMode: "numeric" } }}
            onChange={(event) => onTimeout(event.target.value)}
          />
        </>
      )}
      <TextField
        label="Source parameters · JSON"
        multiline
        minRows={3}
        value={buffers.parameters}
        disabled={disabled}
        onChange={(event) => onBuffer("parameters", event.target.value)}
        error={!!parametersError}
        helperText={
          parametersError ||
          (http
            ? `Declare name, type (STRING / NUMBER / BOOLEAN), required, and optional defaultValue. ${identifierGuidance}`
            : `Lookup tables require a parameter named "key". ${identifierGuidance}`)
        }
        slotProps={{ input: { className: "json-input" } }}
      />
      {http ? (
        <>
          <TextField
            label="Secret header aliases · JSON"
            multiline
            minRows={2}
            value={buffers.secretHeaders}
            disabled={disabled}
            onChange={(event) => onBuffer("secretHeaders", event.target.value)}
            helperText='Example: {"Authorization":"CRM_TOKEN"}. Server reads ARC_SECRET_CRM_TOKEN; enter the full header value only in server configuration.'
            slotProps={{ input: { className: "json-input" } }}
          />
          <p className="studio-hint">
            HTTP destinations are public by default. Server operators can allow
            specific internal hosts. Sending secrets requires an explicit host
            allowlist. Redirects are disabled.
          </p>
        </>
      ) : (
        <TextField
          label="Lookup entries · JSON object"
          multiline
          minRows={8}
          maxRows={20}
          value={buffers.entries}
          disabled={disabled}
          onChange={(event) => onBuffer("entries", event.target.value)}
          helperText='Map keys to values or records. Example: {"US":{"rate":0.07}}'
          slotProps={{ input: { className: "json-input" } }}
        />
      )}
    </>
  );
}

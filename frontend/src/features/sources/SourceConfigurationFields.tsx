import { TextField } from "@mui/material";
import type { SourceConfig } from "../../types";
import { sourceParameterBufferError, type SourceBuffers } from "./model";
import { parameterNameGuidance } from "../../domain/identifiers";

export default function SourceConfigurationFields({
  configuration,
  buffers,
  disabled,
  onConfig,
  onBuffer,
}: {
  configuration: SourceConfig;
  buffers: SourceBuffers;
  disabled: boolean;
  onConfig: (patch: Partial<SourceConfig>) => void;
  onBuffer: (field: keyof SourceBuffers, value: string) => void;
}) {
  const http = configuration.kind === "HTTP";
  const parametersError = sourceParameterBufferError(buffers.parameters);
  return (
    <>
      {http && (
        <>
          <TextField
            label="HTTP URL"
            placeholder="https://api.example.com/customer"
            value={configuration.url || ""}
            disabled={disabled}
            onChange={(event) => onConfig({ url: event.target.value })}
            helperText="Mapped parameters become URL-encoded query parameters. The response must be JSON."
          />
          <TextField
            label="Timeout (ms)"
            type="number"
            value={configuration.timeoutMs}
            disabled={disabled}
            onChange={(event) =>
              onConfig({ timeoutMs: Number(event.target.value) })
            }
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
            ? `Declare name, type (STRING / NUMBER / BOOLEAN / ARRAY / OBJECT), required, and optional defaultValue. ${parameterNameGuidance}`
            : `Lookup tables require a parameter named "key". ${parameterNameGuidance}`)
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

import type { ComponentType } from "react";
import { TextField } from "@mui/material";
import type { SourceConfig } from "../../types";
import { sourceParameterBufferError, type SourceBuffers } from "./model";
import {
  httpTimeoutGuidance,
  httpUrlProblem,
  parseHttpTimeout,
} from "./sourceDocument";
import { sourceProviders, type SourceKind } from "./sourceProviders";
import { identifierGuidance } from "../../domain/identifiers";

interface SectionProps {
  configuration: SourceConfig;
  buffers: SourceBuffers;
  /** Raw timeout text, kept as typed so it can be cleared and retyped. */
  timeout: string;
  disabled: boolean;
  onConfig: (patch: Partial<SourceConfig>) => void;
  onBuffer: (field: keyof SourceBuffers, value: string) => void;
  onTimeout: (text: string) => void;
}

/** The fields before the shared parameters: an HTTP source names its URL and timeout. */
function HttpConnection({
  configuration,
  timeout,
  disabled,
  onConfig,
  onTimeout,
}: SectionProps) {
  const timeoutInvalid = parseHttpTimeout(timeout) === null;
  const urlProblem = httpUrlProblem(configuration.url || "");
  return (
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
  );
}

/** The fields after the parameters: the provider's payload. */
function HttpPayload({ buffers, disabled, onBuffer }: SectionProps) {
  return (
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
  );
}

function LookupPayload({ buffers, disabled, onBuffer }: SectionProps) {
  return (
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
  );
}

function NoFields() {
  return null;
}

// Exhaustive per provider, like the inspector's node-form registry: a new
// provider fails to compile until it has its connection and payload sections.
const connectionSections: Record<SourceKind, ComponentType<SectionProps>> = {
  LOOKUP: NoFields,
  HTTP: HttpConnection,
};
const payloadSections: Record<SourceKind, ComponentType<SectionProps>> = {
  LOOKUP: LookupPayload,
  HTTP: HttpPayload,
};

export default function SourceConfigurationFields(props: SectionProps) {
  const { configuration, buffers, disabled, onBuffer } = props;
  const provider = sourceProviders[configuration.kind];
  const Connection = connectionSections[configuration.kind];
  const Payload = payloadSections[configuration.kind];
  const parametersError = sourceParameterBufferError(
    buffers.parameters,
    configuration.kind,
  );
  return (
    <>
      <Connection {...props} />
      <TextField
        label="Source parameters · JSON"
        multiline
        minRows={3}
        value={buffers.parameters}
        disabled={disabled}
        onChange={(event) => onBuffer("parameters", event.target.value)}
        error={!!parametersError}
        helperText={
          parametersError || `${provider.parametersHelp} ${identifierGuidance}`
        }
        slotProps={{ input: { className: "json-input" } }}
      />
      <Payload {...props} />
    </>
  );
}

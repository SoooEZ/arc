import type { ComponentType } from "react";
import { TextField } from "@mui/material";
import type { SourceConfig } from "../../types";
import { sourceParameterBufferError, type SourceBuffers } from "./model";
import {
  httpTimeoutGuidance,
  httpUrlProblem,
  parseHttpTimeout,
} from "./httpSourcePolicy";
import { sourceProviders, type SourceKind } from "./sourceProviders";
import { readSourceParameters } from "./sourceParameters";
import { secretHeadersBufferProblem } from "./sourceDocument";
import { identifierGuidance } from "../../domain/identifiers";
import type { TouchedField } from "./useFieldFeedback";
import LookupTableEditor from "./LookupTableEditor";
import SecretHeadersEditor from "./SecretHeadersEditor";
import SourceParametersEditor from "./SourceParametersEditor";
import ViewToggle, { useRememberedView } from "./ViewToggle";

interface SectionProps {
  configuration: SourceConfig;
  buffers: SourceBuffers;
  /** Raw timeout text, kept as typed so it can be cleared and retyped. */
  timeout: string;
  disabled: boolean;
  /** Whether a field's problem shows yet (useFieldFeedback). */
  touched: (field: TouchedField) => boolean;
  onTouch: (field: TouchedField) => void;
  /** A table cell whose text is not a value yet blocks saving. */
  onCellValidity: (cell: string, valid: boolean) => void;
  onConfig: (patch: Partial<SourceConfig>) => void;
  onBuffer: (field: keyof SourceBuffers, value: string) => void;
  onTimeout: (text: string) => void;
}

/** The fields before the shared parameters: an HTTP source names its URL and timeout. */
function HttpConnection({
  configuration,
  timeout,
  disabled,
  touched,
  onTouch,
  onConfig,
  onTimeout,
}: SectionProps) {
  const timeoutInvalid = parseHttpTimeout(timeout) === null;
  // An empty URL is the start of a new HTTP source, not yet a mistake.
  const urlProblem = touched("url")
    ? httpUrlProblem(configuration.url || "")
    : null;
  return (
    <>
      <TextField
        label="HTTP URL"
        placeholder="https://api.example.com/customer"
        value={configuration.url || ""}
        disabled={disabled}
        error={!!urlProblem}
        onChange={(event) => {
          onTouch("url");
          onConfig({ url: event.target.value });
        }}
        onBlur={() => onTouch("url")}
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
  const [view, setView] = useRememberedView(
    "secret headers",
    tableViewNames,
    "table",
  );
  const problem = secretHeadersBufferProblem(buffers.secretHeaders);
  return (
    <>
      <div className="source-section">
        <div className="source-section-heading">
          <span>Secret headers</span>
          <ViewToggle
            label="Secret headers view"
            value={view}
            views={tableViews}
            onChange={setView}
          />
        </div>
        {view === "table" ? (
          <>
            <SecretHeadersEditor
              text={buffers.secretHeaders}
              disabled={disabled}
              onChange={(text) => onBuffer("secretHeaders", text)}
            />
            <p className={problem ? "source-section-problem" : "studio-hint"}>
              {problem ??
                "The server sends each header with the value of its ARC_SECRET_<alias> variable; set that value only in server configuration."}
            </p>
          </>
        ) : (
          <TextField
            label="Secret header aliases · JSON"
            multiline
            minRows={2}
            value={buffers.secretHeaders}
            disabled={disabled}
            onChange={(event) => onBuffer("secretHeaders", event.target.value)}
            error={!!problem}
            helperText={
              problem ??
              'Example: {"Authorization":"CRM_TOKEN"}. Server reads ARC_SECRET_CRM_TOKEN; enter the full header value only in server configuration.'
            }
            slotProps={{ input: { className: "json-input" } }}
          />
        )}
      </div>
      <p className="studio-hint">
        HTTP destinations are public by default. Server operators can allow
        specific internal hosts. Sending secrets requires an explicit host
        allowlist. Redirects are disabled.
      </p>
    </>
  );
}

type TableView = "table" | "json";
const tableViews: readonly { view: TableView; text: string }[] = [
  { view: "table", text: "Table" },
  { view: "json", text: "JSON" },
];
const tableViewNames = tableViews.map(({ view }) => view);

/**
 * The entries as a table to edit cell by cell, or as their JSON text. Both
 * edit the one entries buffer; the table writes it whole on every change.
 */
function LookupPayload(props: SectionProps) {
  const [view, setView] = useRememberedView(
    "lookup entries",
    tableViewNames,
    "table",
  );
  const { buffers, disabled, onBuffer } = props;
  return (
    <div className="source-section">
      <div className="source-section-heading">
        <span>Lookup entries</span>
        <ViewToggle
          label="Lookup entries view"
          value={view}
          views={tableViews}
          onChange={setView}
        />
      </div>
      {view === "table" ? (
        <LookupTableEditor
          entries={buffers.entries}
          disabled={disabled}
          onChange={(text) => onBuffer("entries", text)}
        />
      ) : (
        <>
          <LookupEntriesJson {...props} />
          <p className="studio-hint">
            Map keys to values or records. Example: {'{"US":{"rate":0.07}}'}
          </p>
        </>
      )}
    </div>
  );
}

/**
 * The JSON view is a native textarea: MUI's autosizing one laid out the whole
 * table text again on every render of the form, a lag per keystroke on a
 * large table, while sources.css pins the field's height anyway.
 */
function LookupEntriesJson({ buffers, disabled, onBuffer }: SectionProps) {
  return (
    <TextField
      label="Lookup entries · JSON object"
      multiline
      rows={8}
      value={buffers.entries}
      disabled={disabled}
      onChange={(event) => onBuffer("entries", event.target.value)}
      slotProps={{
        input: {
          className: "json-input json-table-input",
          inputComponent: "textarea",
        },
        // A textarea has no type attribute; MUI would pass the field's "text".
        htmlInput: { type: undefined },
      }}
    />
  );
}

/**
 * The parameters as a table, or as their JSON text. Both edit the one
 * parameters buffer, which keeps owning the provider round trip (lesson F7).
 */
function SourceParameters({
  configuration,
  buffers,
  disabled,
  onBuffer,
  onCellValidity,
}: SectionProps) {
  const [view, setView] = useRememberedView(
    "source parameters",
    tableViewNames,
    "table",
  );
  const { kind } = configuration;
  const problem = sourceParameterBufferError(buffers.parameters, kind);
  const provider = sourceProviders[kind];
  return (
    <div className="source-section">
      <div className="source-section-heading">
        <span>Source parameters</span>
        <ViewToggle
          label="Source parameters view"
          value={view}
          views={tableViews}
          onChange={setView}
        />
      </div>
      {view === "table" ? (
        <>
          <SourceParametersEditor
            kind={kind}
            text={buffers.parameters}
            disabled={disabled}
            onChange={(text) => onBuffer("parameters", text)}
            onValidity={onCellValidity}
          />
          {/* A text the table cannot read says so in the table's place. */}
          {readSourceParameters(buffers.parameters).rows && (
            <p className={problem ? "source-section-problem" : "studio-hint"}>
              {problem ?? provider.parametersTableHelp}
            </p>
          )}
        </>
      ) : (
        <TextField
          label="Source parameters · JSON"
          multiline
          minRows={3}
          value={buffers.parameters}
          disabled={disabled}
          onChange={(event) => onBuffer("parameters", event.target.value)}
          error={!!problem}
          helperText={
            problem || `${provider.parametersHelp} ${identifierGuidance}`
          }
          slotProps={{ input: { className: "json-input" } }}
        />
      )}
    </div>
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
  const Connection = connectionSections[props.configuration.kind];
  const Payload = payloadSections[props.configuration.kind];
  return (
    <>
      <Connection {...props} />
      <SourceParameters {...props} />
      <Payload {...props} />
    </>
  );
}

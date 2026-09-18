import { useEffect, useState } from "react";
import { sourceApi } from "../../api/sources";
import { errorMessage } from "../../api/errors";
import type { DataSource, SourceConfig } from "../../types";
export function useSourceEditor({
  onDirty,
  notify,
}: {
  onDirty: (dirty: boolean) => void;
  notify: (message: string) => void;
}) {
  const [sources, setSources] = useState<DataSource[]>([]);
  const [selected, setSelected] = useState<DataSource | null>(null);
  const [baseline, setBaseline] = useState("");
  const [params, setParams] = useState("");
  const [entries, setEntries] = useState("");
  const [headers, setHeaders] = useState("{}");
  const [test, setTest] = useState('{"key":"US"}');
  const [result, setResult] = useState<unknown>(undefined);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [versions, setVersions] = useState<DataSource[]>([]);
  const [viewVersion, setViewVersion] = useState(0);
  const snapshot = JSON.stringify([selected, params, entries, headers]);
  const dirty = !!selected && snapshot !== baseline;
  const historical = !!selected && viewVersion !== selected.version;
  const choose = (s: DataSource) => {
    const p = JSON.stringify(s.definition.parameters, null, 2),
      e = JSON.stringify(s.definition.entries ?? {}, null, 2),
      h = JSON.stringify(s.definition.secretHeaders ?? {}, null, 2);
    setSelected(s);
    setViewVersion(s.version);
    setParams(p);
    setEntries(e);
    setHeaders(h);
    setBaseline(JSON.stringify([s, p, e, h]));
    setResult(undefined);
    setError("");
    setTest(
      JSON.stringify(
        Object.fromEntries(
          s.definition.parameters.map((p) => [
            p.name,
            p.defaultValue ??
              (p.type === "NUMBER"
                ? 1
                : p.type === "BOOLEAN"
                  ? true
                  : p.name === "key"
                    ? "US"
                    : "example"),
          ]),
        ),
        null,
        2,
      ),
    );
  };
  const load = async () => {
    try {
      const rows = await sourceApi.sources();
      setSources(rows);
      if (!selected && rows.length) choose(rows[0]);
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  useEffect(() => {
    void load();
  }, []);
  useEffect(() => {
    onDirty(dirty);
  }, [dirty, onDirty]);
  useEffect(() => {
    let live = true;
    if (selected?.version)
      sourceApi
        .sourceVersions(selected.id)
        .then((rows) => {
          if (live) setVersions(rows);
        })
        .catch((e) => {
          if (live) setError(errorMessage(e));
        });
    else setVersions([]);
    return () => {
      live = false;
    };
  }, [selected?.id, selected?.version]);
  const select = (s: DataSource) => {
    if (dirty && !window.confirm("Discard unsaved source changes?")) return;
    choose(s);
  };
  const configPatch = (patch: Partial<SourceConfig>) => {
    if (selected)
      setSelected({
        ...selected,
        definition: { ...selected.definition, ...patch },
      });
  };
  const save = async () => {
    if (!selected) return;
    setBusy(true);
    setError("");
    try {
      const c = {
        ...selected.definition,
        parameters: JSON.parse(params),
        entries: JSON.parse(entries),
        secretHeaders: JSON.parse(headers),
      };
      const saved = selected.version
        ? await sourceApi.saveSource({ ...selected, definition: c })
        : await sourceApi.createSource(selected.id, selected.name, c);
      setSources((rows) => [saved, ...rows.filter((r) => r.id !== saved.id)]);
      choose(saved);
      notify(
        `Data source v${saved.version} saved. Existing rules keep their pinned version.`,
      );
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const run = async () => {
    if (!selected) return;
    setBusy(true);
    setError("");
    setResult(undefined);
    try {
      const response = await sourceApi.testSource(
        selected.id,
        viewVersion,
        JSON.parse(test),
      );
      setResult(response.result);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const displayConfig = historical
    ? versions.find((v) => v.version === viewVersion)?.definition
    : selected?.definition;
  return {
    sources,
    selected,
    params,
    entries,
    headers,
    test,
    result,
    error,
    busy,
    versions,
    viewVersion,
    dirty,
    historical,
    select,
    configPatch,
    save,
    run,
    displayConfig,
    setSelected,
    setParams,
    setEntries,
    setHeaders,
    setTest,
    setViewVersion,
    setError,
  };
}

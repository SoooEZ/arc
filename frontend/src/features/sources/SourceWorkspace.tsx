import { Button } from "@mui/material";
import { ArrowRight, Plus } from "lucide-react";
import { createSourceDraft } from "./model";
import type { SourceEditor } from "./useSourceEditor";
import SourceDetail from "./SourceDetail";
import SourceList from "./SourceList";

/**
 * The source editor's surface. Its host owns the controller (`useSourceEditor`):
 * the workspace page and the embedded source manager both render this and
 * read the editor's `document.dirty` and `document.pending` directly.
 */
export default function SourceWorkspace({ editor }: { editor: SourceEditor }) {
  const { catalog, document, versions, commands } = editor;
  return (
    <div className="sources-page">
      <div className="page-eyebrow">CONNECTED INPUTS</div>
      <div className="sources-heading">
        <div>
          <h1>
            Data sources<span className="heading-dot">.</span>
          </h1>
          <p>Give your rules the context they need, when they need it.</p>
        </div>
        <Button
          variant="contained"
          startIcon={<Plus size={16} />}
          onClick={() => void commands.select(createSourceDraft())}
        >
          New source
        </Button>
      </div>
      <div className="source-explainer">
        <span>Caller input</span>
        <ArrowRight size={15} />
        <span>Missing? Read pinned source</span>
        <ArrowRight size={15} />
        <span>Extract field & check type</span>
        <ArrowRight size={15} />
        <span>Calculate</span>
      </div>
      <div className="sources-layout">
        <SourceList
          catalog={catalog}
          selectedId={document.open?.source.id}
          onSelect={commands.select}
        />
        <SourceDetail
          document={document}
          versions={versions}
          commands={commands}
        />
      </div>
    </div>
  );
}

import { ChevronRight, Radio } from "lucide-react";
import type { WorkspacePage, WorkspaceRoute } from "./routing";

const sectionLabels: Record<WorkspacePage, string> = {
  library: "Rule library",
  rule: "Rule library",
  sources: "Data sources",
  playground: "API playground",
  docs: "API reference",
};

function sectionLabel(route: WorkspaceRoute) {
  if (route.page === "rule" && route.mode === "code") return "Code studio";
  return sectionLabels[route.page];
}

export default function WorkspaceHeader({
  route,
  ruleName,
  navigate,
}: {
  route: WorkspaceRoute;
  ruleName?: string;
  navigate: (path: string) => void;
}) {
  return (
    <header className="topbar">
      <div className="breadcrumbs">
        <span>Workspace</span>
        <ChevronRight size={13} />
        <button onClick={() => navigate("/library")}>
          {sectionLabel(route)}
        </button>
        {ruleName && (
          <>
            <ChevronRight size={13} />
            <strong>{ruleName}</strong>
          </>
        )}
      </div>
      <div className="topbar-right">
        <span className="open-access">
          <Radio size={13} />
          Open API
        </span>
        <span className="topbar-divider" />
        <span className="user-avatar">A</span>
      </div>
    </header>
  );
}

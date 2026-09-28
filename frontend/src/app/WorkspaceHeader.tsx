import { ChevronRight, Radio } from "lucide-react";
import { pagePath, type WorkspacePage, type WorkspaceRoute } from "./routing";

interface Crumb {
  label: string;
  /** Where the crumb leads; null for the section being shown, which is plain text. */
  path: string | null;
}

const sectionCrumbs: Record<WorkspacePage, Crumb> = {
  library: { label: "Rule library", path: null },
  rule: { label: "Rule library", path: pagePath("library") },
  sources: { label: "Data sources", path: null },
  playground: { label: "API playground", path: null },
  docs: { label: "API reference", path: null },
};

/** The crumb's target agrees with its label: "Data sources" no longer led to the library. */
function sectionCrumb(route: WorkspaceRoute): Crumb {
  if (route.page === "rule" && route.mode === "code")
    return { label: "Code studio", path: null };
  return sectionCrumbs[route.page];
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
  const crumb = sectionCrumb(route);
  return (
    <header className="topbar">
      <div className="breadcrumbs">
        <span>Workspace</span>
        <ChevronRight size={13} />
        {crumb.path ? (
          <button onClick={() => navigate(crumb.path!)}>{crumb.label}</button>
        ) : (
          <span className="breadcrumb-current" aria-current="page">
            {crumb.label}
          </span>
        )}
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

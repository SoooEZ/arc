import { ChevronRight, Radio } from "lucide-react";

function sectionLabel(route: string) {
  if (route === "/playground") return "API playground";
  if (route === "/docs") return "API reference";
  if (route === "/sources") return "Data sources";
  if (route.startsWith("/studio/")) return "Code studio";
  return "Rule library";
}

export default function WorkspaceHeader({
  route,
  ruleName,
  navigate,
}: {
  route: string;
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

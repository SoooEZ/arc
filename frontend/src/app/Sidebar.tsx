import { useCallback, useEffect, useRef, useState } from "react";
import {
  BookOpen,
  CircleHelp,
  FileCode2,
  Layers3,
  PanelLeftClose,
  PanelLeftOpen,
  Send,
  Workflow,
} from "lucide-react";
import { Tooltip, useMediaQuery } from "@mui/material";
import FocusTrap from "@mui/material/Unstable_TrapFocus";
import { ArcMark } from "../components/Icons";
import { pagePath, type WorkspaceRoute } from "./routing";

const preferenceKey = "arc.navigation.expanded";
interface Props {
  route: WorkspaceRoute;
  navigate: (path: string) => void;
  openCodeStudio: () => void;
}
export default function Sidebar({ route, navigate, openCodeStudio }: Props) {
  const [expanded, setExpanded] = useState(() => {
    try {
      return localStorage.getItem(preferenceKey) === "true";
    } catch {
      return false;
    }
  });
  const toggleButton = useRef<HTMLButtonElement>(null);
  const mobile = useMediaQuery("(max-width:760px)");
  const toggleExpanded = useCallback(
    (next: boolean) => {
      setExpanded(next);
      if (!next && mobile) toggleButton.current?.focus();
      try {
        localStorage.setItem(preferenceKey, String(next));
      } catch {
        // Navigation remains usable when browser storage is unavailable.
      }
    },
    [mobile],
  );
  useEffect(() => {
    if (!expanded || !mobile) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") toggleExpanded(false);
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [expanded, mobile, toggleExpanded]);
  const open = (path: string) => {
    navigate(path);
    if (mobile) toggleExpanded(false);
  };
  const ruleMode = route.page === "rule" ? route.mode : null;
  // Authoring first, then calling the API; each item has its own icon.
  const links = [
    {
      label: "Rule library",
      icon: Layers3,
      active: route.page === "library" || ruleMode === "graph",
      action: () => open(pagePath("library")),
    },
    {
      label: "Code studio",
      icon: FileCode2,
      active: ruleMode === "code",
      action: () => {
        openCodeStudio();
        if (mobile) toggleExpanded(false);
      },
    },
    {
      label: "Data sources",
      icon: Workflow,
      active: route.page === "sources",
      action: () => open(pagePath("sources")),
    },
    {
      label: "API playground",
      icon: Send,
      active: route.page === "playground",
      action: () => open(pagePath("playground")),
    },
    {
      label: "API reference",
      icon: BookOpen,
      active: route.page === "docs",
      action: () => open(pagePath("docs")),
    },
  ];
  return (
    <>
      {expanded && mobile && (
        <button
          className="sidebar-backdrop"
          aria-label="Close navigation"
          onClick={() => toggleExpanded(false)}
        />
      )}
      <FocusTrap open={mobile && expanded} disableRestoreFocus>
        <aside
          role={mobile && expanded ? "dialog" : undefined}
          aria-modal={mobile && expanded ? true : undefined}
          aria-label="Workspace navigation"
          tabIndex={-1}
          className={`sidebar ${expanded ? "is-expanded" : "is-compact"}`}
        >
          <button
            className="brand"
            aria-label="ARC home"
            onClick={() => open(pagePath("library"))}
          >
            <ArcMark />
            <span className="nav-label">
              arc<span className="brand-dot">.</span>
            </span>
          </button>
          <Tooltip
            title={expanded ? "Collapse navigation" : "Expand navigation"}
            placement="right"
          >
            <button
              className="sidebar-toggle"
              ref={toggleButton}
              aria-label={
                expanded ? "Collapse navigation" : "Expand navigation"
              }
              aria-expanded={expanded}
              aria-controls="workspace-navigation"
              onClick={() => toggleExpanded(!expanded)}
            >
              {expanded ? (
                <PanelLeftClose size={19} />
              ) : (
                <PanelLeftOpen size={19} />
              )}
              <span className="nav-label">Collapse navigation</span>
            </button>
          </Tooltip>
          <nav
            className="main-nav"
            id="workspace-navigation"
            aria-label="Workspace"
          >
            {links.map(({ label, icon: Icon, active, action }) => (
              <Tooltip
                key={label}
                title={expanded ? "" : label}
                placement="right"
              >
                <button
                  aria-label={label}
                  aria-current={active ? "page" : undefined}
                  className={active ? "active" : ""}
                  onClick={action}
                >
                  <Icon size={19} />
                  <span className="nav-label">{label}</span>
                </button>
              </Tooltip>
            ))}
          </nav>
          <div className="sidebar-bottom">
            <Tooltip
              title={expanded ? "" : "Getting started"}
              placement="right"
            >
              <button
                className="help-link"
                aria-label="Getting started"
                onClick={() => open(pagePath("docs"))}
              >
                <CircleHelp size={19} />
                <span className="nav-label">Getting started</span>
              </button>
            </Tooltip>
            <div className="environment" title="Development">
              <span className="status-dot published" />
              <span className="nav-label">Development</span>
            </div>
          </div>
        </aside>
      </FocusTrap>
    </>
  );
}

import { useEffect, useRef, useState } from "react";
import {
  BookOpen,
  CircleHelp,
  Layers3,
  PanelLeftClose,
  PanelLeftOpen,
  Terminal,
  Workflow,
} from "lucide-react";
import { Tooltip, useMediaQuery } from "@mui/material";
import FocusTrap from "@mui/material/Unstable_TrapFocus";
import { ArcMark } from "../components/Icons";

const preferenceKey = "arc.navigation.expanded";
interface Props {
  route: string;
  studioRuleId: string | null;
  navigate: (path: string) => void;
  newRule: () => void;
}
export default function Sidebar({
  route,
  studioRuleId,
  navigate,
  newRule,
}: Props) {
  const [expanded, setExpanded] = useState(() => {
    try {
      return localStorage.getItem(preferenceKey) === "true";
    } catch {
      return false;
    }
  });
  const toggleButton = useRef<HTMLButtonElement>(null);
  const mobile = useMediaQuery("(max-width:760px)");
  const toggleExpanded = (next: boolean) => {
    setExpanded(next);
    if (!next && mobile) toggleButton.current?.focus();
    try {
      localStorage.setItem(preferenceKey, String(next));
    } catch {
      // Navigation remains usable when browser storage is unavailable.
    }
  };
  useEffect(() => {
    if (!expanded || !mobile) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") toggleExpanded(false);
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [expanded, mobile]);
  const open = (path: string) => {
    navigate(path);
    if (mobile) toggleExpanded(false);
  };
  const links = [
    {
      label: "Rule library",
      icon: Layers3,
      active: route === "/library" || route.startsWith("/rules/"),
      action: () => open("/library"),
    },
    {
      label: "API playground",
      icon: Terminal,
      active: route === "/playground",
      action: () => open("/playground"),
    },
    {
      label: "API reference",
      icon: BookOpen,
      active: route === "/docs",
      action: () => open("/docs"),
    },
    {
      label: "Code studio",
      icon: Terminal,
      active: route.startsWith("/studio/"),
      action: () => {
        if (studioRuleId) open(`/studio/${studioRuleId}`);
        else {
          newRule();
          if (mobile) toggleExpanded(false);
        }
      },
    },
    {
      label: "Data sources",
      icon: Workflow,
      active: route === "/sources",
      action: () => open("/sources"),
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
            onClick={() => open("/library")}
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
                onClick={() => open("/docs")}
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

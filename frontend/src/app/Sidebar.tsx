import {
  ArrowUpRight,
  BookOpen,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Layers3,
  Plus,
  Terminal,
  Workflow,
} from "lucide-react";
import type { Rule } from "../types";
import { ArcMark, KindIcon } from "../components/Icons";
interface Props {
  rules: Rule[];
  route: string;
  selectedId: string | null;
  loading: boolean;
  navigate: (path: string) => void;
  newRule: () => void;
}
export default function Sidebar({
  rules,
  route,
  selectedId,
  loading,
  navigate,
  newRule,
}: Props) {
  return (
    <aside className="sidebar">
      <button className="brand" onClick={() => navigate("/library")}>
        <ArcMark />
        <span>
          arc<span className="brand-dot">.</span>
        </span>
        <span className="brand-beta">BETA</span>
      </button>
      <div className="workspace-switch">
        <span className="workspace-avatar">A</span>
        <div>
          <strong>ARC workspace</strong>
          <small>Rules & calculations</small>
        </div>
        <ChevronDown size={14} />
      </div>
      <div className="nav-section-label">WORKSPACE</div>
      <nav className="main-nav">
        <button
          className={
            route === "/library" || route.startsWith("/rules/") ? "active" : ""
          }
          onClick={() => navigate("/library")}
        >
          <Layers3 size={18} />
          Rule library<span className="nav-count">{rules.length}</span>
        </button>
        <button
          className={route === "/playground" ? "active" : ""}
          onClick={() => navigate("/playground")}
        >
          <Terminal size={18} />
          API playground
        </button>
        <button
          className={route === "/docs" ? "active" : ""}
          onClick={() => navigate("/docs")}
        >
          <BookOpen size={18} />
          API reference
          <ArrowUpRight size={14} className="nav-tail" />
        </button>
        <button
          className={route.startsWith("/studio/") ? "active" : ""}
          onClick={() =>
            rules.length
              ? navigate(`/studio/${selectedId || rules[0].id}`)
              : newRule()
          }
        >
          <Terminal size={18} />
          Code studio
        </button>
        <button
          className={route === "/sources" ? "active" : ""}
          onClick={() => navigate("/sources")}
        >
          <Workflow size={18} />
          Data sources
        </button>
      </nav>
      <div className="nav-section-label rules-label">
        YOUR RULES
        <button onClick={newRule} aria-label="Create rule">
          <Plus size={16} />
        </button>
      </div>
      <div className="sidebar-rules">
        {rules.map((rule) => (
          <button
            key={rule.id}
            title={rule.name}
            className={selectedId === rule.id ? "selected" : ""}
            onClick={() => navigate(`/rules/${rule.id}`)}
          >
            <KindIcon kind={rule.kind} size={16} />
            <span>{rule.name}</span>
            <span
              className={`status-dot ${rule.publishedVersion ? "published" : ""}`}
            />
          </button>
        ))}
        {!loading && !rules.length && (
          <div className="sidebar-empty">Your first rule starts here.</div>
        )}
      </div>
      <div className="sidebar-bottom">
        <div className="build-note">
          <Workflow size={19} />
          <strong>Build once. Reuse everywhere.</strong>
          <p>
            Connect your business logic,
            <br />
            one rule at a time.
          </p>
          <button onClick={() => navigate("/docs")}>
            Explore the API <ArrowUpRight size={14} />
          </button>
        </div>
        <button className="help-link" onClick={() => navigate("/docs")}>
          <CircleHelp size={17} />
          Getting started
          <ChevronRight size={14} />
        </button>
        <div className="environment">
          <span className="status-dot published" />
          <span>Development</span>
          <span>v0.2</span>
        </div>
      </div>
    </aside>
  );
}

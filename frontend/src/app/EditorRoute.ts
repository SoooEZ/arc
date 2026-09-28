/*
 * Lazy entry of the rule editor route, so the library and other pages do not
 * download React Flow. Its stylesheet travels with the editor and therefore
 * loads after the application styles. That keeps the cascade: every app rule
 * for a .react-flow__ element either sets properties this stylesheet leaves
 * alone or uses !important.
 */
import "@xyflow/react/dist/style.css";

export { default } from "../features/editor/Editor";

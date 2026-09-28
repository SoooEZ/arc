import type { InputType } from "../types";
import { quoteText } from "./expressions";

/**
 * The ARC literal that stands in for a required value the user has not chosen
 * yet, such as a Formula-call argument or a Reference binding inserted by a
 * Code studio snippet. Each literal passes the backend's strict check for its
 * input type; `null` would count as a missing required input.
 */
export const placeholderLiteral: Record<InputType, string> = {
  NUMBER: "0",
  STRING: quoteText("value"),
  BOOLEAN: "false",
  ARRAY: "[]",
  OBJECT: "$OBJECT()",
};

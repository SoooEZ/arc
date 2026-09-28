import type { Kind } from "../types";

/** What the UI says about a rule kind; the library tabs, the create dialog, the cards and the editor read one table. */
export interface RuleKindFacts {
  label: string;
  /** The library's filter tab. */
  pluralLabel: string;
  description: string;
}

export const ruleKinds: Record<Kind, RuleKindFacts> = {
  DECISION_TREE: {
    label: "Decision tree",
    pluralLabel: "Decision trees",
    description: "Combine conditions and calculations across branching paths.",
  },
  FORMULA: {
    label: "Formula",
    pluralLabel: "Formulas",
    description: "Calculate a value, such as a price or a score.",
  },
  RULE: {
    label: "Condition rule",
    pluralLabel: "Condition rules",
    description: "Evaluate a condition, such as whether an order is eligible.",
  },
};

/** The kinds in the order the UI offers them. */
export const kinds = Object.keys(ruleKinds) as Kind[];

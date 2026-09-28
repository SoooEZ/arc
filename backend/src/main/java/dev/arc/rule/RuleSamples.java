package dev.arc.rule;

import static dev.arc.model.NodeKind.*;

import dev.arc.model.Definition;
import dev.arc.model.Definition.*;
import dev.arc.model.Handles;
import dev.arc.model.NodeKind;
import dev.arc.model.RuleKind;
import java.util.List;
import java.util.Map;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

@Component
public class RuleSamples implements ApplicationRunner {
  private final RuleRepository store;
  private final RuleService service;

  public RuleSamples(RuleRepository store, RuleService service) {
    this.store = store;
    this.service = service;
  }

  private static Node node(
      String id,
      NodeKind kind,
      String label,
      double x,
      double y,
      String expression,
      String output) {
    return new Node(
        id,
        kind.name(),
        label,
        new Position(x, y),
        expression,
        output,
        null,
        null,
        null,
        null,
        null,
        null,
        null);
  }

  /** The pricing sample's call of the published discount formula at one rate. */
  private static Node discount(String id, String label, double x, double y, String rate) {
    return new Node(
        id,
        REFERENCE.name(),
        label,
        new Position(x, y),
        null,
        "price",
        "apply-discount",
        1,
        Map.of("amount", "orderTotal", "rate", rate),
        null,
        null,
        null,
        null);
  }

  private static Edge edge(String source, String target, String handle) {
    return new Edge(source + "-" + handle + "-" + target, source, target, handle);
  }

  /**
   * The valid template a new rule of the kind starts from: a Condition with two Outputs for a RULE,
   * and one calculation for a FORMULA or DECISION_TREE (a tree grows from the calculation by hand).
   */
  public static Definition blank(RuleKind kind) {
    return switch (kind) {
      case RULE -> conditionTemplate();
      case FORMULA, DECISION_TREE -> calculationTemplate();
    };
  }

  private static Definition conditionTemplate() {
    return new Definition(
        1,
        List.of(new Input("amount", "NUMBER", true, 100)),
        List.of(
            node("input", INPUT, "Inputs", 300, 0, null, null),
            node("condition", CONDITION, "Check amount", 300, 160, "amount >= 100", null),
            node("yes", OUTPUT, "Eligible", 100, 340, "true", null),
            node("no", OUTPUT, "Not eligible", 500, 340, "false", null)),
        List.of(
            edge("input", "condition", Handles.NEXT),
            edge("condition", "yes", Handles.TRUE),
            edge("condition", "no", Handles.FALSE)));
  }

  private static Definition calculationTemplate() {
    return new Definition(
        1,
        List.of(new Input("amount", "NUMBER", true, 100)),
        List.of(
            node("input", INPUT, "Inputs", 280, 0, null, null),
            node("calculate", FORMULA, "Calculate", 280, 160, "amount * 0.9", "total"),
            node("result", OUTPUT, "Return total", 280, 320, "total", null)),
        List.of(
            edge("input", "calculate", Handles.NEXT), edge("calculate", "result", Handles.NEXT)));
  }

  /**
   * Seeds the examples once per workspace. The claim is a row in the same transaction, so a failed
   * seed rolls it back, and a workspace whose rules were all deleted is not seeded again.
   */
  @Override
  @Transactional
  public void run(ApplicationArguments args) {
    if (!store.claimSampleSeeding()) return;
    Definition discount =
        new Definition(
            1,
            List.of(
                new Input("amount", "NUMBER", true, null), new Input("rate", "NUMBER", true, null)),
            List.of(
                node("input", INPUT, "Amount & rate", 280, 0, null, null),
                node(
                    "discount",
                    FORMULA,
                    "Apply discount",
                    280,
                    160,
                    "$ROUND(amount * (1 - rate), 2)",
                    "discounted"),
                node("result", OUTPUT, "Discounted amount", 280, 320, "discounted", null)),
            List.of(
                edge("input", "discount", Handles.NEXT), edge("discount", "result", Handles.NEXT)));
    var formula =
        store.create(
            "apply-discount",
            "Apply discount",
            "A reusable formula for percentage discounts, rounded to two decimal places.",
            RuleKind.FORMULA.name(),
            discount);
    service.publish(formula.id(), formula.revision());
    Definition pricing =
        new Definition(
            1,
            List.of(
                new Input("orderTotal", "NUMBER", true, null),
                new Input("customerTier", "STRING", true, null)),
            List.of(
                node("input", INPUT, "Order details", 310, 0, null, null),
                node(
                    "tier",
                    CONDITION,
                    "Premium customer?",
                    310,
                    150,
                    "customerTier == \"premium\"",
                    null),
                discount("premium", "Premium discount", 100, 320, "0.2"),
                node(
                    "threshold",
                    CONDITION,
                    "Order over $100?",
                    520,
                    320,
                    "orderTotal >= 100",
                    null),
                discount("standard", "Volume discount", 380, 500, "0.1"),
                node("regular", OUTPUT, "Standard price", 680, 500, "orderTotal", null),
                node("result", OUTPUT, "Discounted price", 170, 690, "price", null)),
            List.of(
                edge("input", "tier", Handles.NEXT),
                edge("tier", "premium", Handles.TRUE),
                edge("tier", "threshold", Handles.FALSE),
                edge("premium", "result", Handles.NEXT),
                edge("threshold", "standard", Handles.TRUE),
                edge("threshold", "regular", Handles.FALSE),
                edge("standard", "result", Handles.NEXT)));
    var tree =
        store.create(
            "order-pricing",
            "Order pricing",
            "Reward premium customers and larger orders with the right discount.",
            RuleKind.DECISION_TREE.name(),
            pricing);
    service.publish(tree.id(), tree.revision());
    var eligibility =
        store.create(
            "free-shipping",
            "Free shipping",
            "Check whether an order qualifies for complimentary shipping.",
            RuleKind.RULE.name(),
            blank(RuleKind.RULE));
    service.publish(eligibility.id(), eligibility.revision());
  }
}

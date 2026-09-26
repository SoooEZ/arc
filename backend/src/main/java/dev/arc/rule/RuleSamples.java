package dev.arc.rule;

import dev.arc.model.Definition;
import dev.arc.model.Definition.*;
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
      String id, String type, String label, double x, double y, String expression, String output) {
    return new Node(id, type, label, new Position(x, y), expression, output, null, null, null);
  }

  private static Edge edge(String source, String target, String branch) {
    return new Edge(source + "-" + branch + "-" + target, source, target, branch);
  }

  public static Definition blank(String kind) {
    if (kind.equals("RULE"))
      return new Definition(
          1,
          List.of(new Input("amount", "NUMBER", true, 100)),
          List.of(
              node("input", "INPUT", "Inputs", 300, 0, null, null),
              node("condition", "CONDITION", "Check amount", 300, 160, "amount >= 100", null),
              node("yes", "OUTPUT", "Eligible", 100, 340, "true", null),
              node("no", "OUTPUT", "Not eligible", 500, 340, "false", null)),
          List.of(
              edge("input", "condition", "next"),
              edge("condition", "yes", "true"),
              edge("condition", "no", "false")));
    return new Definition(
        1,
        List.of(new Input("amount", "NUMBER", true, 100)),
        List.of(
            node("input", "INPUT", "Inputs", 280, 0, null, null),
            node("calculate", "FORMULA", "Calculate", 280, 160, "amount * 0.9", "total"),
            node("result", "OUTPUT", "Return total", 280, 320, "total", null)),
        List.of(edge("input", "calculate", "next"), edge("calculate", "result", "next")));
  }

  @Override
  @Transactional
  public void run(ApplicationArguments args) {
    if (!store.list().isEmpty()) return;
    Definition discount =
        new Definition(
            1,
            List.of(
                new Input("amount", "NUMBER", true, null), new Input("rate", "NUMBER", true, null)),
            List.of(
                node("input", "INPUT", "Amount & rate", 280, 0, null, null),
                node(
                    "discount",
                    "FORMULA",
                    "Apply discount",
                    280,
                    160,
                    "$ROUND(amount * (1 - rate), 2)",
                    "discounted"),
                node("result", "OUTPUT", "Discounted amount", 280, 320, "discounted", null)),
            List.of(edge("input", "discount", "next"), edge("discount", "result", "next")));
    var formula =
        store.create(
            "apply-discount",
            "Apply discount",
            "A reusable formula for percentage discounts, rounded to two decimal places.",
            "FORMULA",
            discount);
    service.publish(formula.id(), formula.revision());
    Definition pricing =
        new Definition(
            1,
            List.of(
                new Input("orderTotal", "NUMBER", true, null),
                new Input("customerTier", "STRING", true, null)),
            List.of(
                node("input", "INPUT", "Order details", 310, 0, null, null),
                node(
                    "tier",
                    "CONDITION",
                    "Premium customer?",
                    310,
                    150,
                    "customerTier == \"premium\"",
                    null),
                new Node(
                    "premium",
                    "REFERENCE",
                    "Premium discount",
                    new Position(100, 320),
                    null,
                    "price",
                    "apply-discount",
                    1,
                    Map.of("amount", "orderTotal", "rate", "0.2")),
                node(
                    "threshold",
                    "CONDITION",
                    "Order over $100?",
                    520,
                    320,
                    "orderTotal >= 100",
                    null),
                new Node(
                    "standard",
                    "REFERENCE",
                    "Volume discount",
                    new Position(380, 500),
                    null,
                    "price",
                    "apply-discount",
                    1,
                    Map.of("amount", "orderTotal", "rate", "0.1")),
                node("regular", "OUTPUT", "Standard price", 680, 500, "orderTotal", null),
                node("result", "OUTPUT", "Discounted price", 170, 690, "price", null)),
            List.of(
                edge("input", "tier", "next"),
                edge("tier", "premium", "true"),
                edge("tier", "threshold", "false"),
                edge("premium", "result", "next"),
                edge("threshold", "standard", "true"),
                edge("threshold", "regular", "false"),
                edge("standard", "result", "next")));
    var tree =
        store.create(
            "order-pricing",
            "Order pricing",
            "Reward premium customers and larger orders with the right discount.",
            "DECISION_TREE",
            pricing);
    service.publish(tree.id(), tree.revision());
    var eligibility =
        store.create(
            "free-shipping",
            "Free shipping",
            "Check whether an order qualifies for complimentary shipping.",
            "RULE",
            blank("RULE"));
    service.publish(eligibility.id(), eligibility.revision());
  }
}

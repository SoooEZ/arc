package dev.arc.rule;

import static dev.arc.model.NodeKind.*;

import dev.arc.error.ArcException;
import dev.arc.model.Definition;
import dev.arc.model.Definition.*;
import dev.arc.model.Handles;
import dev.arc.model.NodeKind;
import dev.arc.model.RuleKind;
import java.util.List;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;

@Component
public class RuleSamples implements ApplicationRunner {
  private static final Logger LOG = LoggerFactory.getLogger(RuleSamples.class);

  private final RuleRepository store;
  private final RuleService service;
  private final TransactionTemplate savepoint;

  public RuleSamples(
      RuleRepository store, RuleService service, PlatformTransactionManager transactions) {
    this.store = store;
    this.service = service;
    this.savepoint = new TransactionTemplate(transactions);
    savepoint.setPropagationBehavior(TransactionDefinition.PROPAGATION_NESTED);
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
   * Seeds the examples once per workspace; the claim is a row, so a workspace whose rules were all
   * deleted is not seeded again. The samples are written behind a savepoint. The API accepts
   * requests before this runs, so a sample ID can be taken already, as can one created before the
   * claim existed: then only the samples roll back, the claim stays and the API starts. Such a seed
   * rolled the claim back and failed every start of the API.
   */
  @Override
  @Transactional
  public void run(ApplicationArguments args) {
    if (!store.claimSampleSeeding()) return;
    try {
      savepoint.executeWithoutResult(status -> seed());
    } catch (ArcException failure) {
      LOG.warn("Sample rules were not added: {}", failure.getMessage());
    }
  }

  private void seed() {
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

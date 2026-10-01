package dev.arc.rule;

import static dev.arc.model.NodeKind.*;
import static dev.arc.rule.RuleTemplates.edge;
import static dev.arc.rule.RuleTemplates.node;

import dev.arc.error.ArcException;
import dev.arc.model.Definition;
import dev.arc.model.Definition.*;
import dev.arc.model.Handles;
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

/** The sample rules a new workspace starts with, seeded once per workspace ({@link #run}). */
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
            RuleTemplates.blank(RuleKind.RULE));
    service.publish(eligibility.id(), eligibility.revision());
  }
}

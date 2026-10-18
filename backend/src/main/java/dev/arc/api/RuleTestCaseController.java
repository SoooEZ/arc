package dev.arc.api;

import dev.arc.model.RuleTestCase;
import dev.arc.rule.RuleTestCaseService;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;

/** A rule's saved test cases; running and comparing them is the client's work. */
@RestController
@RequestMapping("/api")
public class RuleTestCaseController {
  private final RuleTestCaseService cases;

  public RuleTestCaseController(RuleTestCaseService cases) {
    this.cases = cases;
  }

  @GetMapping("/rules/{id}/test-cases")
  public List<RuleTestCase> list(@PathVariable String id) {
    return cases.list(id);
  }

  @PostMapping("/rules/{id}/test-cases")
  @ResponseStatus(HttpStatus.CREATED)
  public RuleTestCase create(
      @PathVariable String id, @RequestBody RuleTestCaseService.Write request) {
    return cases.create(id, request);
  }

  @PutMapping("/rules/{id}/test-cases/{caseId}")
  public RuleTestCase update(
      @PathVariable String id,
      @PathVariable long caseId,
      @RequestBody RuleTestCaseService.Write request) {
    return cases.update(id, caseId, request);
  }

  @DeleteMapping("/rules/{id}/test-cases/{caseId}")
  @ResponseStatus(HttpStatus.NO_CONTENT)
  public void delete(@PathVariable String id, @PathVariable long caseId) {
    cases.delete(id, caseId);
  }
}

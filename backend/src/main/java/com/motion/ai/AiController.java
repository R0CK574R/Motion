package com.motion.ai;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.motion.ai.AiService.AskResponse;
import com.motion.ai.AiService.MemoResponse;
import com.motion.ai.AiService.Status;
import com.motion.auth.CurrentUser;
import java.util.List;
import java.util.Map;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/ai")
public class AiController {

  @JsonIgnoreProperties(ignoreUnknown = true)
  public record Question(String question) {}

  private final AiService ai;

  public AiController(AiService ai) {
    this.ai = ai;
  }

  /** Whether the caller gets live answers, sample answers, or needs a subscription. */
  @GetMapping("/status")
  public Status status(@AuthenticationPrincipal Jwt jwt) {
    return ai.status(CurrentUser.id(jwt));
  }

  /** Answers a question about the caller's own portfolio. */
  @PostMapping("/ask")
  public AskResponse ask(
      @AuthenticationPrincipal Jwt jwt, @RequestBody(required = false) Question body) {
    return ai.ask(CurrentUser.id(jwt), body == null ? null : body.question());
  }

  /** Writes a short risk memo for the caller's portfolio. */
  @PostMapping("/memo")
  public MemoResponse memo(@AuthenticationPrincipal Jwt jwt) {
    return ai.memo(CurrentUser.id(jwt));
  }

  /** The caller's own recent AI requests, with what the safety checks found. */
  @GetMapping("/calls")
  public Map<String, List<AiCallLog.Summary>> calls(
      @AuthenticationPrincipal Jwt jwt, @RequestParam(defaultValue = "20") int limit) {
    return Map.of("calls", ai.recentCalls(CurrentUser.id(jwt), Math.max(1, Math.min(limit, 100))));
  }
}

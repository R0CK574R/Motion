package com.motion.ai;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Checks that every figure in a model-written answer can be traced to the
 * data the model was actually given.
 *
 * A language model can state a number that looks right and is not. For a
 * finance product that is the failure that matters most, so no answer is
 * shown as verified unless each figure in it matches a figure in the
 * evidence: the tool results and the user's own question.
 *
 * A figure matches when some evidence number rounds to it at the precision
 * the answer used. So "$1,245" is supported by 1244.70, and "17.5%" by 17.5,
 * but "$1,300" is supported by neither. Signs are ignored, because "a loss of
 * $39,295" and -39295.00 are the same fact.
 */
public final class GroundingVerifier {

  public record Result(boolean grounded, List<String> ungrounded) {}

  // A number, optionally with a leading minus or $, thousands separators,
  // decimals and a trailing %. The look-behinds keep it from starting in the
  // middle of a word or identifier ("Q4", "COVID-19", "top3").
  private static final Pattern NUMBER =
      Pattern.compile("(?<![A-Za-z0-9.,])(?<![A-Za-z]-)[-−]?\\$?\\d[\\d,]*(?:\\.\\d+)?%?");

  private static final BigDecimal SMALL = BigDecimal.TEN;
  private static final int MAX_REPORTED = 10;

  private GroundingVerifier() {}

  public static Result verify(String answer, Collection<String> evidence) {
    List<BigDecimal> known = new ArrayList<>();
    for (String text : evidence) {
      for (Token token : tokens(text)) {
        known.add(token.value());
      }
    }

    Set<String> ungrounded = new LinkedHashSet<>();
    for (Token token : tokens(answer)) {
      if (token.isBareSmallInteger()) {
        continue; // "the top 3", "2 positions", list numbering: not a financial figure
      }
      if (!supported(token.value(), known) && ungrounded.size() < MAX_REPORTED) {
        ungrounded.add(token.text());
      }
    }
    return new Result(ungrounded.isEmpty(), List.copyOf(ungrounded));
  }

  private static boolean supported(BigDecimal figure, List<BigDecimal> known) {
    // Half a unit in the figure's last decimal place: 0.5 for "1,245", 0.05 for "17.5".
    BigDecimal tolerance = new BigDecimal("0.5").movePointLeft(Math.max(figure.scale(), 0));
    for (BigDecimal candidate : known) {
      if (candidate.subtract(figure).abs().compareTo(tolerance) <= 0) {
        return true;
      }
    }
    return false;
  }

  private record Token(String text, BigDecimal value, boolean decorated) {

    /** An undecorated whole number below ten, such as a count or a list index. */
    boolean isBareSmallInteger() {
      return !decorated && value.scale() <= 0 && value.compareTo(SMALL) < 0;
    }
  }

  private static List<Token> tokens(String text) {
    List<Token> tokens = new ArrayList<>();
    if (text == null) {
      return tokens;
    }
    Matcher matcher = NUMBER.matcher(text);
    while (matcher.find()) {
      String raw = matcher.group();
      // A trailing comma or a comma-only tail belongs to the sentence, not the number.
      String digits = raw.replaceAll("[-−$%,]", "");
      if (digits.isEmpty() || digits.equals(".")) {
        continue;
      }
      boolean decorated = raw.contains("$") || raw.contains("%");
      tokens.add(new Token(raw, new BigDecimal(digits).abs(), decorated));
    }
    return tokens;
  }
}

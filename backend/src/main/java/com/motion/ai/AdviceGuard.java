package com.motion.ai;

import java.util.List;
import java.util.regex.Pattern;

/**
 * Last line of defence against investment advice.
 *
 * The system prompt tells the model never to recommend a trade. A prompt is
 * a request, not a guarantee, so the finished answer is also scanned for
 * prescriptive language. An answer that trips the scan is not shown; the user
 * gets a fixed explanation instead.
 *
 * The patterns look for wording that tells the user what to do. They are
 * written so that a refusal ("I can't tell you whether to buy or sell") and a
 * disclaimer ("this is not a recommendation") do not trip them.
 */
public final class AdviceGuard {

  public static final String DECLINED =
      "Motion describes what a portfolio is made of and how it might behave. It doesn't give "
          + "investment advice, so it can't tell you what to buy, sell or hold. Ask about your "
          + "positions, concentration or risk figures and it will show you the numbers.";

  private static final int FLAGS = Pattern.CASE_INSENSITIVE;
  private static final String ACTION =
      "(?:buy|buying|sell|selling|trim|trimming|reduce|reducing|add|adding|hold|holding|"
          + "diversify|diversifying|rebalance|rebalancing|exit|exiting|increase|increasing|"
          + "cut|cutting|dump|dumping)";

  private static final List<Pattern> PATTERNS =
      List.of(
          Pattern.compile("\\byou (?:should|ought to|need to|must|had better)\\b", FLAGS),
          Pattern.compile("\\byou(?:'d| would) (?:be wise|do well|be better off)\\b", FLAGS),
          Pattern.compile("\\bi(?:'d| would)? (?:strongly )?(?:recommend|suggest|advise)\\b", FLAGS),
          Pattern.compile("\\bmy (?:recommendation|advice|suggestion) (?:is|would be)\\b", FLAGS),
          Pattern.compile("\\b(?:consider|try|start|think about) " + ACTION + "\\b", FLAGS),
          Pattern.compile("\\byou (?:may|might|could) want to " + ACTION + "\\b", FLAGS),
          Pattern.compile("\\b(?:it(?:'s| is| would be)|now is) (?:a )?(?:good|great|smart|wise|bad|the right) (?:idea|time|move) to " + ACTION + "\\b", FLAGS),
          Pattern.compile("\\b(?:is|are|looks?) (?:a )?(?:strong |good |great )?(?:buy|sell)\\b(?! or)", FLAGS),
          Pattern.compile("\\b(?:will|is going to|are going to|should) (?:likely |probably )?(?:rise|fall|go up|go down|rally|crash|outperform|underperform)\\b", FLAGS));

  private AdviceGuard() {}

  public static boolean containsAdvice(String text) {
    if (text == null) {
      return false;
    }
    for (Pattern pattern : PATTERNS) {
      if (pattern.matcher(text).find()) {
        return true;
      }
    }
    return false;
  }
}

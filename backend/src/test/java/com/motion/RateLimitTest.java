package com.motion;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

/** Sign-in attempts are capped per IP address. Runs with the limit lowered to 3 a minute. */
@SpringBootTest(properties = "motion.auth-rate-limit-per-minute=3")
@AutoConfigureMockMvc
@ActiveProfiles("test")
class RateLimitTest {

  @Autowired MockMvc mvc;

  @Test
  void repeatedSignInAttemptsAreThrottled() throws Exception {
    String body = "{\"email\":\"nobody@example.com\",\"password\":\"guess-guess\"}";
    for (int attempt = 1; attempt <= 3; attempt++) {
      assertThat(login(body).getStatus()).as("attempt " + attempt).isEqualTo(401);
    }
    MockHttpServletResponse blocked = login(body);
    assertThat(blocked.getStatus()).isEqualTo(429);
    assertThat(blocked.getHeader("Retry-After")).isNotNull();
    assertThat(blocked.getContentAsString()).contains("RATE_LIMITED");

    // Other endpoints are not affected by the sign-in limit.
    assertThat(mvc.perform(get("/health")).andReturn().getResponse().getStatus()).isEqualTo(200);
  }

  private MockHttpServletResponse login(String body) throws Exception {
    return mvc.perform(post("/api/auth/login").contentType(MediaType.APPLICATION_JSON).content(body))
        .andReturn()
        .getResponse();
  }
}

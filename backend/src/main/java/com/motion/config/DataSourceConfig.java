package com.motion.config;

import com.zaxxer.hikari.HikariDataSource;
import java.net.URI;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * Builds the connection pool from DATABASE_URL.
 *
 * Hosting providers (Neon, Render, Heroku) hand out URLs shaped like
 * postgres://user:password@host:5432/dbname?sslmode=require, which is not
 * what JDBC accepts, so this translates it to jdbc:postgresql://host:5432/dbname
 * plus separate credentials.
 */
@Configuration
public class DataSourceConfig {

  /** Where to connect, in the form the Postgres JDBC driver expects. */
  record Target(String jdbcUrl, String username, String password) {}

  /** Pool settings (size, idle timeout) are bound from spring.datasource.hikari.* afterwards. */
  @Bean
  @ConfigurationProperties(prefix = "spring.datasource.hikari")
  public HikariDataSource dataSource(AppProperties props) {
    if (AppProperties.blank(props.databaseUrl())) {
      throw new IllegalStateException(
          "DATABASE_URL is not set. Copy .env.example to .env and fill it in.");
    }
    Target target = translate(props.databaseUrl(), props.sslRequired());
    HikariDataSource dataSource = new HikariDataSource();
    dataSource.setJdbcUrl(target.jdbcUrl());
    if (target.username() != null) {
      dataSource.setUsername(target.username());
    }
    if (target.password() != null) {
      dataSource.setPassword(target.password());
    }
    return dataSource;
  }

  /**
   * Turns a provider's URL into a JDBC one. Query parameters are kept, except
   * that libpq's channel_binding is renamed to the driver's channelBinding:
   * the driver ignores names it does not know, so Neon's
   * channel_binding=require would otherwise be dropped without a word.
   */
  static Target translate(String databaseUrl, boolean sslRequired) {
    String url = databaseUrl.trim();
    if (url.startsWith("jdbc:")) {
      return new Target(url, null, null);
    }

    URI uri = URI.create(url);
    StringBuilder jdbc = new StringBuilder("jdbc:postgresql://").append(uri.getHost());
    if (uri.getPort() > 0) {
      jdbc.append(':').append(uri.getPort());
    }
    jdbc.append(uri.getRawPath() == null ? "" : uri.getRawPath());

    List<String> params = new ArrayList<>();
    if (uri.getRawQuery() != null) {
      for (String param : uri.getRawQuery().split("&")) {
        if (!param.isEmpty()) {
          params.add(param.startsWith("channel_binding=") ? "channelBinding=" + param.substring(16) : param);
        }
      }
    }
    if (sslRequired && params.stream().noneMatch(p -> p.startsWith("sslmode="))) {
      params.add("sslmode=require");
    }
    if (!params.isEmpty()) {
      jdbc.append('?').append(String.join("&", params));
    }

    String username = null;
    String password = null;
    if (uri.getRawUserInfo() != null) {
      String[] parts = uri.getRawUserInfo().split(":", 2);
      username = URLDecoder.decode(parts[0], StandardCharsets.UTF_8);
      if (parts.length > 1) {
        password = URLDecoder.decode(parts[1], StandardCharsets.UTF_8);
      }
    }
    return new Target(jdbc.toString(), username, password);
  }
}

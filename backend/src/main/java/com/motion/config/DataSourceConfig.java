package com.motion.config;

import com.zaxxer.hikari.HikariDataSource;
import java.net.URI;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import javax.sql.DataSource;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * Builds the connection pool from DATABASE_URL.
 *
 * Hosting providers (Neon, Render, Heroku) hand out URLs shaped like
 * postgres://user:password@host:5432/dbname, which is not what JDBC accepts,
 * so this translates it to jdbc:postgresql://host:5432/dbname plus separate
 * credentials.
 */
@Configuration
public class DataSourceConfig {

  /** Pool settings (size, idle timeout) are bound from spring.datasource.hikari.* afterwards. */
  @Bean
  @ConfigurationProperties(prefix = "spring.datasource.hikari")
  public HikariDataSource dataSource(AppProperties props) {
    if (AppProperties.blank(props.databaseUrl())) {
      throw new IllegalStateException(
          "DATABASE_URL is not set. Copy .env.example to .env and fill it in.");
    }
    HikariDataSource dataSource = new HikariDataSource();
    String url = props.databaseUrl().trim();
    if (url.startsWith("jdbc:")) {
      dataSource.setJdbcUrl(url);
      return dataSource;
    }

    URI uri = URI.create(url);
    StringBuilder jdbc = new StringBuilder("jdbc:postgresql://").append(uri.getHost());
    if (uri.getPort() > 0) {
      jdbc.append(':').append(uri.getPort());
    }
    jdbc.append(uri.getRawPath() == null ? "" : uri.getRawPath());
    String query = uri.getRawQuery();
    if (props.sslRequired() && (query == null || !query.contains("sslmode="))) {
      query = (query == null || query.isEmpty() ? "" : query + "&") + "sslmode=require";
    }
    if (query != null && !query.isEmpty()) {
      jdbc.append('?').append(query);
    }
    dataSource.setJdbcUrl(jdbc.toString());

    if (uri.getRawUserInfo() != null) {
      String[] parts = uri.getRawUserInfo().split(":", 2);
      dataSource.setUsername(URLDecoder.decode(parts[0], StandardCharsets.UTF_8));
      if (parts.length > 1) {
        dataSource.setPassword(URLDecoder.decode(parts[1], StandardCharsets.UTF_8));
      }
    }
    return dataSource;
  }
}

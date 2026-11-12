package com.motion.config;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

/** DATABASE_URL translation. Pure logic, no database. */
class DataSourceConfigTest {

  @Test
  void neonConnectionStringKeepsItsSecuritySettings() {
    DataSourceConfig.Target target =
        DataSourceConfig.translate(
            "postgresql://neondb_owner:pw%40%3A1@ep-cool-name-a1b2c3.us-west-2.aws.neon.tech/neondb"
                + "?sslmode=require&channel_binding=require",
            false);
    assertThat(target.jdbcUrl())
        .isEqualTo(
            "jdbc:postgresql://ep-cool-name-a1b2c3.us-west-2.aws.neon.tech/neondb"
                + "?sslmode=require&channelBinding=require");
    assertThat(target.username()).isEqualTo("neondb_owner");
    assertThat(target.password()).isEqualTo("pw@:1");
  }

  @Test
  void localUrlGetsTlsOnlyWhenAskedFor() {
    assertThat(DataSourceConfig.translate("postgres://motion:motion@localhost:5432/motion", false).jdbcUrl())
        .isEqualTo("jdbc:postgresql://localhost:5432/motion");
    assertThat(DataSourceConfig.translate("postgres://motion:motion@db:5432/motion", true).jdbcUrl())
        .isEqualTo("jdbc:postgresql://db:5432/motion?sslmode=require");
    // An explicit sslmode wins over PGSSL.
    assertThat(DataSourceConfig.translate("postgres://u:p@db/motion?sslmode=verify-full", true).jdbcUrl())
        .isEqualTo("jdbc:postgresql://db/motion?sslmode=verify-full");
  }

  @Test
  void jdbcUrlPassesThroughUntouched() {
    DataSourceConfig.Target target =
        DataSourceConfig.translate(" jdbc:postgresql://db:5432/motion?user=a&password=b ", false);
    assertThat(target.jdbcUrl()).isEqualTo("jdbc:postgresql://db:5432/motion?user=a&password=b");
    assertThat(target.username()).isNull();
  }
}

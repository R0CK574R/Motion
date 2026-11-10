package com.motion;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.ConfigurationPropertiesScan;

@SpringBootApplication
@ConfigurationPropertiesScan
public class MotionApplication {

  public static void main(String[] args) {
    SpringApplication.run(MotionApplication.class, args);
  }
}

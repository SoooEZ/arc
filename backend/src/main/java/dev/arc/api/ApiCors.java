package dev.arc.api;

import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

/**
 * The API's one CORS policy: any origin may call {@code /api/**}. {@link RequestLimitFilter}
 * answers before Spring MVC applies it, so its 413 states the same origin from here.
 */
@Configuration
class ApiCors implements WebMvcConfigurer {
  static final String ALLOWED_ORIGIN = "*";

  @Override
  public void addCorsMappings(CorsRegistry registry) {
    registry
        .addMapping("/api/**")
        .allowedOrigins(ALLOWED_ORIGIN)
        .allowedMethods("GET", "POST", "PUT", "DELETE", "OPTIONS")
        .allowedHeaders("*");
  }
}

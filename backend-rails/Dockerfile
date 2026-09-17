FROM ruby:3.3.11-slim-bookworm AS gems
RUN apt-get update && apt-get install -y --no-install-recommends build-essential libpq-dev libyaml-dev pkg-config && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY backend-rails/Gemfile backend-rails/Gemfile.lock ./
RUN bundle config set without development:test && bundle install --jobs 4 && rm -rf /usr/local/bundle/cache

FROM ruby:3.3.11-slim-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends libpq5 curl ca-certificates && rm -rf /var/lib/apt/lists/* && useradd --system --uid 10001 arc
ENV RAILS_ENV=production BUNDLE_WITHOUT=development:test ARC_CONTRACTS_PATH=/app/contracts ARC_MIGRATIONS_PATH=/app/db/sql
WORKDIR /app
COPY --from=gems /usr/local/bundle /usr/local/bundle
COPY backend-rails/ .
COPY contracts/ ./contracts/
COPY database/migrations/ ./db/sql/
RUN mkdir -p tmp/pids log && chown -R arc:arc tmp log
USER arc
EXPOSE 8080
ENTRYPOINT ["./bin/docker-entrypoint"]
CMD ["bundle", "exec", "puma", "-C", "config/puma.rb"]

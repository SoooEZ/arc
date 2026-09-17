require_relative "../config/environment"
require "minitest/autorun"
require "socket"

class SourcesTest < Minitest::Test
  def with_environment(values)
    original = values.to_h { |key, _| [key, ENV[key]] }
    values.each { |key, value| ENV[key] = value }
    yield
  ensure
    original.each { |key, value| ENV[key] = value }
  end

  def with_server(body: '{"ok":true}', status: "200 OK", delay: 0, headers: {})
    server = TCPServer.new("127.0.0.1", 0)
    requests = Queue.new
    worker = Thread.new do
      socket = server.accept
      request = +""
      request << socket.gets until request.end_with?("\r\n\r\n")
      requests << request
      sleep delay if delay.positive?
      fields = { "Content-Type" => "application/json", "Content-Length" => body.bytesize, "Connection" => "close" }.merge(headers)
      socket.write("HTTP/1.1 #{status}\r\n" + fields.map { |k, v| "#{k}: #{v}\r\n" }.join + "\r\n" + body)
    rescue Errno::EPIPE, Errno::ECONNRESET, IOError
      # The client deliberately closes timed-out or oversized responses.
    ensure
      socket&.close
    end
    url = "http://127.0.0.1:#{server.addr[1]}/lookup?key=old&keep=yes"
    with_environment("ARC_HTTP_ALLOWED_HOSTS" => "127.0.0.1", "ARC_HTTP_PRIVATE_HOSTS" => "127.0.0.1") { yield(url, requests) }
  ensure
    worker&.kill
    worker&.join
    server&.close
  end

  def configuration(url, timeout: 1000, secrets: nil)
    { "kind" => "HTTP", "parameters" => [], "url" => url, "timeoutMs" => timeout, "secretHeaders" => secrets }
  end

  def test_http_query_secret_decimal_and_pointer
    with_server(body: '{"a/b":{"~key":[12345678901234567890.123456789]}}') do |url, requests|
      with_environment("ARC_SECRET_TEST_TOKEN" => "example-test-token") do
        source = Arc::Sources.new
        value = source.fetch_http(configuration(url, secrets: { "Authorization" => "TEST_TOKEN" }), { "key" => "a & b" })
        assert_equal BigDecimal("12345678901234567890.123456789"), source.extract(value, "/a~1b/~0key/0")
        request = requests.pop
        assert_includes request, "key=a+%26+b"
        assert_includes request, "keep=yes"
        refute_includes request, "key=old"
        assert_includes request, "Authorization: example-test-token"
        assert_includes request, "Accept-Encoding: identity"
      end
    end
  end

  def test_redirects_are_not_followed
    with_server(status: "302 Found", headers: { "Location" => "http://169.254.169.254/" }) do |url, _|
      error = assert_raises(ArcError) { Arc::Sources.new.fetch_http(configuration(url), {}) }
      assert_equal "HTTP source returned status 302", error.message
    end
  end

  def test_response_size_and_invalid_json
    with_server(body: "x" * 1_048_577) do |url, _|
      error = assert_raises(ArcError) { Arc::Sources.new.fetch_http(configuration(url), {}) }
      assert_equal "HTTP source response exceeds 1 MiB", error.message
    end
    with_server(body: "not json") do |url, _|
      error = assert_raises(ArcError) { Arc::Sources.new.fetch_http(configuration(url), {}) }
      assert_equal Arc::Sources::FAILURE, error.message
    end
    with_server(body: "") do |url, _|
      error = assert_raises(ArcError) { Arc::Sources.new.fetch_http(configuration(url), {}) }
      assert_equal "HTTP source returned an empty body", error.message
    end
  end

  def test_slow_sources_time_out
    with_server(delay: 0.3) do |url, _|
      error = assert_raises(ArcError) { Arc::Sources.new.fetch_http(configuration(url, timeout: 100), {}) }
      assert_equal Arc::Sources::FAILURE, error.message
    end
  end

  def test_private_and_mapped_addresses_are_blocked_without_explicit_exception
    with_environment("ARC_HTTP_ALLOWED_HOSTS" => "", "ARC_HTTP_PRIVATE_HOSTS" => "") do
      source = Arc::Sources.new
      %w[127.0.0.1 169.254.169.254 ::1 ::ffff:127.0.0.1 fec0::1].each do |ip|
        assert_raises(IOError, ip) { source.resolve(ip) }
      end
      error = assert_raises(ArcError) { source.fetch_http(configuration("http://127.0.0.1:1"), {}) }
      assert_equal Arc::Sources::FAILURE, error.message
    end
  end

  def test_allowlist_and_secret_validation
    with_environment("ARC_HTTP_ALLOWED_HOSTS" => "example.com", "ARC_HTTP_PRIVATE_HOSTS" => "") do
      source = Arc::Sources.new
      assert_raises(ArcError) { source.validate_http(configuration("https://other.example/")) }
      assert_raises(ArcError) { source.validate_http(configuration("https://user:pass@example.com/")) }
      assert_raises(ArcError) { source.validate_http(configuration("https://example.com/", secrets: { "Host" => "TOKEN" })) }
    end
    with_server do |url, _|
      with_environment("ARC_SECRET_MISSING" => nil) do
        error = assert_raises(ArcError) { Arc::Sources.new.fetch_http(configuration(url, secrets: { "Authorization" => "MISSING" }), {}) }
        assert_equal "Configured source secret is unavailable", error.message
      end
    end
  end
end

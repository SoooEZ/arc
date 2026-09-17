require "net/http"
require "ipaddr"
require "resolv"
require "timeout"
module Arc
  class Sources
    BLOCKED = %w[0.0.0.0/8 10.0.0.0/8 127.0.0.0/8 169.254.0.0/16 172.16.0.0/12 192.168.0.0/16 224.0.0.0/3 100.64.0.0/10 192.0.0.0/16 192.2.0.0/16 198.18.0.0/15 198.51.0.0/16 203.0.0.0/16 ::/128 ::1/128 fc00::/7 fec0::/10 fe80::/10 ff00::/8 2001:db8::/32].map { |cidr| IPAddr.new(cidr) }.freeze
    FAILURE = "HTTP source failed: destination unavailable, blocked, timed out, or response is not valid JSON"
    def initialize
      @allowed = ENV.fetch("ARC_HTTP_ALLOWED_HOSTS", "").split(",").map { |h| h.strip.downcase }.reject(&:empty?).to_set
      @private = ENV.fetch("ARC_HTTP_PRIVATE_HOSTS", "").split(",").map { |h| h.strip.downcase }.reject(&:empty?).to_set
    end

    def get(id, version)
      DataSourceVersion.fetch(id, version).document
    end

    def config(id, version)
      DataSourceVersion.fetch(id, version).definition
    end

    def check(condition, message)
      raise ArcError.new(422, message) unless condition
    end

    def validate(name, c)
      check(name.is_a?(String) && !name.strip.empty? && name.length <= 160, "Source name must contain 1–160 characters")
      check(c && %w[HTTP LOOKUP].include?(c["kind"]), "Source kind must be HTTP or LOOKUP")
      check(c["parameters"].is_a?(Array) && c["parameters"].size <= 20, "Provide up to 20 source parameters")
      names = Set.new
      c["parameters"].each do |p|
        check(p && Validator.identifier?(p["name"]) && names.add?(p["name"]) && p["source"].nil?, "Invalid source parameter")
        check(%w[NUMBER STRING BOOLEAN].include?(p["type"]), "Source parameters must be scalar")
        Validator.check_type(p["name"], p["type"], p["defaultValue"]) unless p["defaultValue"].nil?
      end
      if c["kind"] == "LOOKUP"
        check(names == Set["key"], "Lookup tables require exactly one parameter named key")
        check(c["entries"].is_a?(Hash) && c["entries"].size <= 1000, "Provide a JSON object with at most 1,000 lookup entries")
        Expressions.bounded(c["entries"])
      else
        validate_http(c)
        check(c["timeoutMs"].is_a?(Integer) && c["timeoutMs"].between?(100, 10_000), "HTTP timeout must be 100–10,000 ms")
      end
      c
    end

    def validate_bindings(d, resolver, visited = Set.new, depth = 0)
      check(depth <= 16, "Rule nesting exceeds 16 levels")
      d["inputs"].each do |p|
        next unless (b = p["source"])
        begin
          c = config(b["id"], b["version"])
          names = c["parameters"].map { |arg| arg["name"] }
          b["bindings"].each_key { |k| check(names.include?(k), "Unknown source parameter: #{k}") }
          c["parameters"].each { |arg| check(!arg["required"] || !arg["defaultValue"].nil? || b["bindings"].key?(arg["name"]), "#{p['name']}: missing source mapping for #{arg['name']}") }
        rescue ArcError => e
          raise e.at_node(d["nodes"].find { |n| n["type"] == "INPUT" })
        end
      end
      d["nodes"].each do |n|
        next unless n["type"] == "REFERENCE" && n["ruleId"] && n["version"] && visited.add?([n["ruleId"], n["version"]])
        begin
          validate_bindings(resolver.call(n["ruleId"], n["version"]), resolver, visited, depth + 1)
        rescue ArcError => e
          raise e.in_rule(n["ruleId"], n["version"]).at_node(n)
        end
      end
    end

    def fetch(id, version, inputs)
      c = config(id, version)
      check(inputs.is_a?(Hash), "Source inputs must be an object")
      names = c["parameters"].map { |p| p["name"] }
      inputs.each_key { |key| check(names.include?(key), "Unknown source parameter: #{key}") }
      values = c["parameters"].to_h do |p|
        value = inputs.fetch(p["name"], p["defaultValue"])
        check(!value.nil? || !p["required"], "Missing source parameter: #{p['name']}")
        [p["name"], value.nil? ? nil : Validator.check_type(p["name"], p["type"], value)]
      end
      if c["kind"] == "LOOKUP"
        key = Functions.text(values["key"], null: "null")
        check(c["entries"].key?(key), "Lookup key was not found in #{id}")
        return c["entries"][key]
      end
      fetch_http(c, values)
    end

    def extract(value, pointer)
      return value if pointer.nil? || pointer.empty?
      pointer.split("/", -1).drop(1).each do |raw|
        part = raw.gsub("~1", "/").gsub("~0", "~")
        if value.is_a?(Hash) && value.key?(part)
          value = value[part]
        elsif value.is_a?(Array) && /\A(?:0|[1-9]\d*)\z/.match?(part) && part.to_i < value.size
          value = value[part.to_i]
        else
          raise ArcError.new(422, "Source JSON pointer did not match a value")
        end
      end
      value
    end

    def validate_http(c)
      begin
        uri = URI.parse(c["url"].to_s)
      rescue URI::InvalidURIError
        raise ArcError.new(422, "Use an HTTP(S) URL without credentials or fragment")
      end
      host = uri.hostname&.downcase
      check(%w[http https].include?(uri.scheme) && host && !host.empty? && uri.userinfo.nil? && uri.fragment.nil? && uri.to_s.length <= 2000, "Use an HTTP(S) URL without credentials or fragment")
      check(@allowed.empty? || @allowed.include?(host), "HTTP host is not in the configured allowlist")
      if c["secretHeaders"]
        check(c["secretHeaders"].is_a?(Hash) && c["secretHeaders"].size <= 10, "At most 10 secret headers")
        c["secretHeaders"].each do |name, env|
          check(name.is_a?(String) && /\A[A-Za-z][A-Za-z0-9-]{0,63}\z/.match?(name) && !%w[host content-length connection transfer-encoding].include?(name.downcase) && env.is_a?(String) && /\A[A-Z][A-Z0-9_]{0,63}\z/.match?(env), "Secret headers map header names to uppercase environment aliases")
          check(@allowed.include?(host), "Secret headers require an explicitly allowlisted HTTP host")
        end
      end
      uri
    end

    def resolve(host)
      addresses = Resolv.getaddresses(host)
      raise IOError if addresses.empty?
      unless @private.include?(host.downcase)
        addresses.each do |address|
          ip = IPAddr.new(address)
          ip = ip.native if ip.ipv4_mapped?
          raise IOError if BLOCKED.any? { |range| range.include?(ip) }
        end
      end
      addresses
    end

    def fetch_http(c, inputs)
      uri = validate_http(c)
      begin
        Timeout.timeout(c["timeoutMs"] / 1000.0) do
          query = URI.decode_www_form(uri.query || "").reject { |k, _| inputs.key?(k) && !inputs[k].nil? }
          inputs.each { |k, v| query << [k, Functions.text(v)] unless v.nil? }
          uri.query = query.empty? ? nil : URI.encode_www_form(query)
          http = Net::HTTP.new(uri.hostname, uri.port, nil)
          http.ipaddr = resolve(uri.hostname).first
          http.use_ssl = uri.scheme == "https"
          http.open_timeout = http.read_timeout = http.write_timeout = c["timeoutMs"] / 1000.0
          http.max_retries = 0
          request = Net::HTTP::Get.new(uri.request_uri)
          request["Accept"], request["Accept-Encoding"] = "application/json", "identity"
          (c["secretHeaders"] || {}).each do |header, alias_name|
            secret = ENV["ARC_SECRET_#{alias_name}"]
            check(secret && !secret.match?(/[\r\n]/), "Configured source secret is unavailable")
            request[header] = secret
          end
          bytes = +"".b
          http.start do
            http.request(request) do |response|
              check(response.code.to_i.between?(200, 299), "HTTP source returned status #{response.code}")
              response.read_body do |chunk|
                bytes << chunk
                check(bytes.bytesize <= 1_048_576, "HTTP source response exceeds 1 MiB")
              end
            end
          end
          check(!bytes.empty?, "HTTP source returned an empty body")
          Expressions.bounded(ArcJson.load(bytes.force_encoding(Encoding::UTF_8)))
        end
      rescue ArcError
        raise
      rescue StandardError
        raise ArcError.new(422, FAILURE)
      end
    end
  end
end

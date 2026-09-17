# Plain Minitest so runtime and HTTP-source tests need neither PostgreSQL nor Java.
Dir[File.join(__dir__, "*_test.rb")].sort.each { |path| require path }

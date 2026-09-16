package dev.arc.engine;

import dev.arc.api.RequestLimitFilter;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicBoolean;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import static org.assertj.core.api.Assertions.*;

class RequestLimitTest {
    @Test void normalJsonBodyRemainsReadable() throws Exception {
        var request = new MockHttpServletRequest("POST", "/api/preview");
        request.setContent("{\"inputs\":{}}".getBytes(StandardCharsets.UTF_8));
        var response = new MockHttpServletResponse();
        var called = new AtomicBoolean(false);
        new RequestLimitFilter().doFilter(request, response, (req, res) -> {
            called.set(true);
            assertThat(new String(req.getInputStream().readAllBytes(), StandardCharsets.UTF_8)).isEqualTo("{\"inputs\":{}}");
        });
        assertThat(called).isTrue();
    }
    @Test void oversizedBodiesAreRejectedEvenWithoutContentLength() throws Exception {
        for (boolean chunked : new boolean[]{false, true}) {
            MockHttpServletRequest request = new MockHttpServletRequest("POST", "/api/rules") {
                @Override public long getContentLengthLong() { return chunked ? -1 : super.getContentLengthLong(); }
            };
            request.setContent(new byte[1024 * 1024 + 1]);
            var response = new MockHttpServletResponse();
            new RequestLimitFilter().doFilter(request, response, (req, res) -> fail("Oversized request must not reach controller"));
            assertThat(response.getStatus()).isEqualTo(413);
            assertThat(response.getHeader("Access-Control-Allow-Origin")).isEqualTo("*");
        }
    }
}

#!/usr/bin/env python3
"""Local mock backend for `make mock`.

Serves the real `site/` directory as a static site (GET requests) and fakes
the `/api/chat` Lambda (POST requests) by replaying pre-recorded NDJSON
fixtures from `mocks/replies/`, cycling through them on every request so a
handful of questions in a row exercises every Markdown rendering case
without restarting anything.

Stdlib only, no new dependency.
"""
import glob
import http.server
import itertools
import os
import time

PORT = 8002
SITE_DIR = os.path.join(os.path.dirname(__file__), "..", "site")
REPLIES_DIR = os.path.join(os.path.dirname(__file__), "replies")
TOKEN_DELAY_SECONDS = 0.04

# Fixtures are listed once at startup, sorted by their numeric prefix, so the
# rotation order is stable and predictable across requests.
REPLY_FILES = sorted(glob.glob(os.path.join(REPLIES_DIR, "*.ndjson")))
if not REPLY_FILES:
    raise SystemExit(f"No .ndjson fixtures found in {REPLIES_DIR}")

# Shared across request-handling threads (ThreadingHTTPServer spawns one per
# connection). CPython's GIL makes a plain generator's __next__ atomic, so a
# bare itertools.count is enough here without an extra lock.
_counter = itertools.count()


class MockChatHandler(http.server.SimpleHTTPRequestHandler):
    """Serves the real site/ tree, plus a fake streaming /api/chat."""

    # HTTP/1.1 is required to stream the reply with `Transfer-Encoding:
    # chunked`. Under HTTP/1.0 (http.server's default), the response body is
    # only ever delimited by closing the connection, so curl/browsers buffer
    # the whole reply and the token-by-token streaming becomes invisible.
    # Chunked encoding also matches what the real Lambda function URL does.
    protocol_version = "HTTP/1.1"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=SITE_DIR, **kwargs)

    def do_POST(self):
        # Drain the request body regardless of path: with HTTP/1.1 keep-alive
        # connections, leftover unread bytes would corrupt the next request
        # parsed on the same socket.
        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length) if length else b""

        if self.path != "/api/chat":
            self.send_error(404, "Not Found")
            return

        # In production, CloudFront verifies X-Amz-Content-Sha256 against the
        # signed request before it ever reaches the Lambda; the application
        # itself never checks it. This mock ignores both the header and the
        # body content entirely.
        del body

        reply_path = REPLY_FILES[next(_counter) % len(REPLY_FILES)]
        # flush=True: stdout is block-buffered once redirected to a file/pipe,
        # so without it this trails behind the request log for a long time.
        print(f"[mock] /api/chat -> {os.path.basename(reply_path)}", flush=True)

        self.send_response(200)
        self.send_header("Content-Type", "application/x-ndjson")
        self.send_header("Transfer-Encoding", "chunked")
        self.end_headers()

        try:
            with open(reply_path, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    self._write_chunk((line + "\n").encode("utf-8"))
                    time.sleep(TOKEN_DELAY_SECONDS)

            # A zero-length chunk terminates the body per RFC 7230 4.1.
            self.wfile.write(b"0\r\n\r\n")
        except (BrokenPipeError, ConnectionResetError):
            # The client (e.g. `curl | head`) disconnected mid-stream. Nothing
            # to clean up: the thread simply stops sending.
            pass

    def _write_chunk(self, data):
        """Writes one HTTP chunked-encoding frame and flushes it immediately."""
        self.wfile.write(f"{len(data):x}\r\n".encode("ascii"))
        self.wfile.write(data)
        self.wfile.write(b"\r\n")
        self.wfile.flush()


def main():
    server = http.server.ThreadingHTTPServer(("", PORT), MockChatHandler)
    print(
        f"Mock backend on http://localhost:{PORT}/ ({len(REPLY_FILES)} replies in rotation)",
        flush=True,
    )
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()

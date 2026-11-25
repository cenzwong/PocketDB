"""Serve the same static files in two HTTPS project paths."""

import argparse
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import ssl
from urllib.parse import urlsplit


SITE = Path(__file__).resolve().parent / "site"
PROJECT_PATHS = {
    "/PocketDB": False,
    "/isolated/PocketDB": True,
}
ASSETS = {"index.html", "probe.js", "worker.js", "answer.wasm"}


class PreviewHandler(SimpleHTTPRequestHandler):
    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript",
        ".wasm": "application/wasm",
    }

    def send_head(self):
        path = urlsplit(self.path).path
        for prefix, isolated in PROJECT_PATHS.items():
            if path.startswith(prefix + "/"):
                asset = path[len(prefix) + 1:] or "index.html"
                if asset in ASSETS:
                    self.asset = asset
                    self.isolated = isolated
                    return super().send_head()
        self.send_error(404)
        return None

    def translate_path(self, path):
        return str(SITE / self.asset)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        if getattr(self, "isolated", False):
            self.send_header("Cross-Origin-Opener-Policy", "same-origin")
            self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
        super().end_headers()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cert", required=True)
    parser.add_argument("--key", required=True)
    parser.add_argument("--port", type=int, default=9443)
    args = parser.parse_args()

    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.load_cert_chain(args.cert, args.key)
    with ThreadingHTTPServer(("127.0.0.1", args.port), PreviewHandler) as server:
        server.socket = context.wrap_socket(server.socket, server_side=True)
        print(f"Preview running at https://localhost:{args.port}/PocketDB/", flush=True)
        server.serve_forever()


if __name__ == "__main__":
    main()

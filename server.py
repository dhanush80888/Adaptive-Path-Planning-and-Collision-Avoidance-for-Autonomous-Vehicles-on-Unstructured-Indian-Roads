#!/usr/bin/env python3
"""
Python Simulation Server for AVOC
Serves the web visualizer and exposes REST API endpoints for real-time
stepping, scenario switching, and live telemetry streaming.
Standard library only (zero third-party dependencies required).
"""

import sys
import os
import json
import mimetypes
import socket
import threading
from http.server import HTTPServer, BaseHTTPRequestHandler
from socketserver import ThreadingMixIn
import urllib.parse

from avoc.simulation import Simulation

WEB_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "web")
sim = Simulation()
sim_lock = threading.Lock()
step_counter = 0

class ThreadedHTTPServer(ThreadingMixIn, HTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def get_request(self):
        sock, addr = super().get_request()
        try:
            sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
            sock.settimeout(2.5)  # Auto-reclaims idle keep-alive sockets, prevents socket leaks
        except Exception:
            pass
        return sock, addr

    def handle_error(self, request, client_address):
        exc_type, _, _ = sys.exc_info()
        if exc_type in (BrokenPipeError, ConnectionResetError, TimeoutError, socket.timeout):
            return
        super().handle_error(request, client_address)

class AvocRequestHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    timeout = 2.5

    def handle(self):
        try:
            super().handle()
        except (BrokenPipeError, ConnectionResetError, TimeoutError, socket.timeout):
            pass

    def log_message(self, format, *args):
        # Suppress routine GET logging for performance during polling
        if len(args) > 0 and ("POST /api/step" in str(args[0]) or "GET /api/state" in str(args[0])):
            return
        super().log_message(format, *args)

    def log_error(self, format, *args):
        # Suppress routine keep-alive timeout closing messages
        if len(args) > 0 and "timed out" in str(args[0]):
            return
        super().log_error(format, *args)

    def send_json_response(self, data: dict, status_code: int = 200):
        try:
            body = json.dumps(data).encode("utf-8")
            self.send_response(status_code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
            self.send_header("Connection", "keep-alive")
            self.send_header("Keep-Alive", "timeout=2, max=100")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.end_headers()
            self.wfile.write(body)
            self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError, TimeoutError, socket.timeout):
            pass

    def do_OPTIONS(self):
        try:
            self.send_response(200)
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.end_headers()
        except (BrokenPipeError, ConnectionResetError, TimeoutError, socket.timeout):
            pass

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        if path == "/api/state":
            with sim_lock:
                state = sim.get_state()
                state["seqId"] = step_counter
            self.send_json_response(state)
            return
        elif path == "/api/scenarios":
            with sim_lock:
                metadata = sim.scenario_manager.get_scenario_metadata()
            self.send_json_response(metadata)
            return

        # Serve static web files
        if path == "/" or path == "":
            file_path = os.path.join(WEB_DIR, "index.html")
        else:
            clean_path = path.lstrip("/")
            file_path = os.path.join(WEB_DIR, clean_path)

        if os.path.exists(file_path) and os.path.isfile(file_path):
            mime_type, _ = mimetypes.guess_type(file_path)
            if not mime_type:
                mime_type = "application/octet-stream"

            with open(file_path, "rb") as f:
                content = f.read()

            try:
                self.send_response(200)
                self.send_header("Content-Type", mime_type)
                self.send_header("Content-Length", str(len(content)))
                self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
                self.send_header("Connection", "keep-alive")
                self.end_headers()
                self.wfile.write(content)
                self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError, TimeoutError, socket.timeout):
                pass
        else:
            try:
                self.send_response(404)
                self.end_headers()
                self.wfile.write(b"404 Not Found")
                self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError, TimeoutError, socket.timeout):
                pass

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        content_len = int(self.headers.get("Content-Length", 0))
        try:
            body = self.rfile.read(content_len) if content_len > 0 else b"{}"
        except (BrokenPipeError, ConnectionResetError):
            return

        try:
            payload = json.loads(body.decode("utf-8")) if body else {}
        except Exception:
            payload = {}

        global step_counter
        if path == "/api/step":
            dt = float(payload.get("dt", 1 / 60))
            with sim_lock:
                step_counter += 1
                state = sim.step(dt)
                state["seqId"] = step_counter
            self.send_json_response(state)
        elif path.startswith("/api/scenario/"):
            try:
                scen_idx = int(path.split("/")[-1])
                with sim_lock:
                    step_counter += 1
                    sim.select_scenario(scen_idx)
                    state = sim.get_state()
                    state["seqId"] = step_counter
                self.send_json_response(state)
            except Exception as e:
                self.send_json_response({"error": str(e)}, status_code=400)
        elif path.startswith("/api/inject/"):
            try:
                hazard_name = path.split("/")[-1]
                with sim_lock:
                    step_counter += 1
                    sim.inject_hazard(hazard_name)
                    state = sim.get_state()
                    state["seqId"] = step_counter
                self.send_json_response(state)
            except Exception as e:
                self.send_json_response({"error": str(e)}, status_code=400)
        elif path == "/api/reset":
            with sim_lock:
                step_counter += 1
                sim.reset()
                state = sim.get_state()
                state["seqId"] = step_counter
            self.send_json_response(state)
        else:
            try:
                self.send_response(404)
                self.end_headers()
                self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError, TimeoutError, socket.timeout):
                pass


def run_server(port: int = 8000):
    server_address = ("0.0.0.0", port)
    httpd = ThreadedHTTPServer(server_address, AvocRequestHandler)
    print(f"\n=======================================================")
    print(f"  ADAPTIVE COLLISION AVOIDANCE FOR AUTONOMOUS VEHICLES (AVOC)")
    print(f"  Autonomous Vehicle Simulation Server (Python Core)")
    print(f"=======================================================")
    print(f"  Visualizer running at: http://localhost:{port}")
    print(f"  API Endpoints:")
    print(f"    - GET  /api/state")
    print(f"    - POST /api/step")
    print(f"    - POST /api/scenario/<0-6>")
    print(f"    - POST /api/reset")
    print(f"=======================================================\n")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down server...")
        httpd.server_close()


if __name__ == "__main__":
    port = 8000
    if len(sys.argv) > 1 and sys.argv[1].isdigit():
        port = int(sys.argv[1])
    run_server(port)

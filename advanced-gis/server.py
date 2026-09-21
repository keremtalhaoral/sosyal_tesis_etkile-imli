import http.server
import socketserver
import sys
import os

class ThreadingHTTPServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    pass

if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
    directory = sys.argv[2] if len(sys.argv) > 2 else '.'
    
    # Change working directory to serve the target folder
    os.chdir(directory)
    
    handler = http.server.SimpleHTTPRequestHandler
    print(f"Starting threaded HTTP static server on port {port} for directory {directory}...")
    with ThreadingHTTPServer(('0.0.0.0', port), handler) as httpd:
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nShutting down static server.")

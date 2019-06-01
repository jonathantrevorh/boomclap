import BaseHTTPServer, SimpleHTTPServer
import ssl
import sys

host = sys.argv[1]
port = sys.argv[2]

# create an http daemon
httpd = BaseHTTPServer.HTTPServer((host, int(port)), SimpleHTTPServer.SimpleHTTPRequestHandler)

# wrap the socket in ssl handler
httpd.socket = ssl.wrap_socket(httpd.socket, server_side=True, certfile='local-dev-server.pem')

# serve all requests indefinitely
httpd.serve_forever()

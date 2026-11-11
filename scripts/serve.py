#!/usr/bin/env python3
"""Servidor local SEM cache, para testar o site sem arquivos velhos misturados.
Uso: python3 scripts/serve.py [porta]     -> abre em http://localhost:8000"""
import sys, os, http.server, functools

class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, must-revalidate')
        super().end_headers()

port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
root = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
handler = functools.partial(NoCache, directory=root)
print(f'JIAS em http://localhost:{port}  (Ctrl+C para parar)')
http.server.ThreadingHTTPServer(('0.0.0.0', port), handler).serve_forever()

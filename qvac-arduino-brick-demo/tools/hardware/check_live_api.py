import importlib.util
import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.request import Request, urlopen
from urllib.error import HTTPError

from pathlib import Path
path=str(Path(__file__).resolve().parents[2]/'app'/'bricks'/'qvac'/'webview.py')
spec=importlib.util.spec_from_file_location('brick_webview',path)
module=importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
forwarded=[]
class Runtime(BaseHTTPRequestHandler):
    def do_POST(self):
        value=json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        forwarded.append(value)
        body=json.dumps(value).encode()
        self.send_response(200)
        self.end_headers()
        self.wfile.write(body)
    def log_message(self,*args): pass
class Sensor:
    reading={'available':False,'source':'live','error':'Sensor disconnected'}
    def snapshot(self): return dict(self.reading)
sensor=Sensor()
runtime=ThreadingHTTPServer(('127.0.0.1',0),Runtime)
threading.Thread(target=runtime.serve_forever,daemon=True).start()
web=module.start_webview(f'http://127.0.0.1:{runtime.server_port}','127.0.0.1',0,sensor_provider=sensor)
def call(path,payload=None):
    req=Request(f'http://127.0.0.1:{web.server_port}'+path,data=None if payload is None else json.dumps(payload).encode(),headers={'Content-Type':'application/json'})
    try:
        with urlopen(req,timeout=5) as response: return response.status,json.load(response)
    except HTTPError as error: return error.code,json.load(error)
try:
    assert call('/live')[0]==503
    assert call('/sensor',{'source':'live','temperature':99,'humidity':99})[0]==503
    assert not forwarded
    sensor.reading={'available':True,'source':'live','temperature':26,'humidity':54,'sensor':'DHT11','pin':2,'capturedAt':'2026-11-22T09:00:00+00:00','sequence':10}
    assert call('/live')[1]['temperature']==26
    status,value=call('/sensor',{'source':'live','temperature':99,'humidity':99})
    assert status==200 and value['temperature']==26 and value['humidity']==54
    assert value['source']=='live' and value['sequence']==10
    status,value=call('/sensor',{'source':'simulated','temperature':34,'humidity':25})
    assert status==200 and value['temperature']==34 and value['source']=='simulated'
    assert call('/sensor',[])[0]==400
    print('PASS: unavailable sensor rejected; measured values override client values; sample mode preserved; malformed input rejected.')
finally:
    web.shutdown()
    runtime.shutdown()

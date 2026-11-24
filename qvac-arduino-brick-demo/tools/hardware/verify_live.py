import json
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.request import Request, urlopen

base='http://127.0.0.1:8765'
def get():
    with urlopen(base+'/live',timeout=5) as response: return json.load(response)
def explain():
    payload={'source':'live','temperature':99,'humidity':99}
    request=Request(base+'/sensor',data=json.dumps(payload).encode(),headers={'Content-Type':'application/json'})
    start=time.monotonic()
    with urlopen(request,timeout=180) as response: answer=json.load(response)
    return {'elapsed_seconds':round(time.monotonic()-start,2),'answer':answer}
readings=[]
for _ in range(3):
    reading=get()
    assert reading['available'] and reading['source']=='live' and reading['sensor']=='DHT11' and reading['pin']==2
    assert reading['ageMs'] <=10000
    readings.append(reading)
    print('Measured:',json.dumps(reading),flush=True)
    time.sleep(3)
assert readings[-1]['sequence'] > readings[0]['sequence']
with ThreadPoolExecutor(max_workers=1) as pool:
    future=pool.submit(explain)
    time.sleep(6)
    during=get()
    assert during['available'] and during['sequence'] > readings[-1]['sequence']
    print('Live updates continue during AI inference:',json.dumps(during),flush=True)
    result=future.result()
reading=result['answer']['reading']
assert reading['source']=='live' and reading['sensor']=='DHT11' and reading['pin']==2
assert reading['temperature']!=99 and reading['humidity']!=99
assert reading['capturedAt'] and reading['sequence']
assert result['answer']['explanation'].strip() and result['answer']['next_step'].strip()
receipt={'readings':readings,'during_inference':during,'inference':result,'client_values_ignored':True}
Path('live-check.json').write_text(json.dumps(receipt,indent=2))
print('Live inference passed:',json.dumps(result),flush=True)

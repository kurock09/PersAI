import json, base64, re
from pathlib import Path
from urllib import request, parse
from http.cookiejar import CookieJar

def read_env(path):
    vals={}
    for line in Path(path).read_text(encoding='utf-8').splitlines():
        if '=' in line and not line.strip().startswith('#'):
            k,v=line.split('=',1)
            vals[k]=v
    return vals

def http_json(url, method='GET', headers=None, body=None, opener=None):
    data = None
    if body is not None:
        data = json.dumps(body).encode('utf-8')
    req = request.Request(url=url, data=data, method=method)
    for k,v in (headers or {}).items():
        req.add_header(k,v)
    op = opener.open if opener else request.urlopen
    with op(req, timeout=20) as resp:
        txt = resp.read().decode('utf-8')
        return resp.getcode(), txt, dict(resp.headers)

vals = read_env('apps/web/.env.local')
secret = vals['CLERK_SECRET_KEY']
pub = vals['NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY']
frontend = base64.b64decode(re.sub(r'^pk_(test|live)_','',pub)).decode().rstrip('$')

code, txt, _ = http_json('https://api.clerk.com/v1/users?limit=1', headers={'Authorization':f'Bearer {secret}'})
users = json.loads(txt)
user = users[0]
uid = user['id']
email = user['email_addresses'][0]['email_address']

code, txt, _ = http_json('https://api.clerk.com/v1/sign_in_tokens', method='POST', headers={'Authorization':f'Bearer {secret}','Content-Type':'application/json'}, body={'user_id':uid,'expires_in_seconds':3600})
if code != 200:
    print('sign_in_tokens failed', code, txt)
    raise SystemExit(1)
ticket = json.loads(txt)['token']

cj = CookieJar()
opener = request.build_opener(request.HTTPCookieProcessor(cj))

code, txt, _ = http_json(f'https://{frontend}/v1/client/sign_ins', method='POST', headers={'Content-Type':'application/json'}, body={'identifier':email}, opener=opener)
print('r1', code)
print(txt[:400])
obj = json.loads(txt)
sid = obj['response']['id']

code, txt, _ = http_json(f'https://{frontend}/v1/client/sign_ins/{sid}/attempt_first_factor', method='POST', headers={'Content-Type':'application/json'}, body={'strategy':'ticket','ticket':ticket}, opener=opener)
print('r2', code)
print(txt[:1200])

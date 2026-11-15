import urllib.request, urllib.error, http.cookiejar, json
base='http://localhost:3000'
def client(): return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
def req(c,path,data=None,origin='http://localhost:3000'):
 h={'Origin':origin}; raw=None
 if data is not None: h['Content-Type']='application/json';raw=json.dumps(data).encode()
 try:
  with c.open(urllib.request.Request(base+path,data=raw,headers=h),timeout=100) as r: return r.status,json.load(r)
 except urllib.error.HTTPError as e: return e.code,json.load(e)
guest=client(); staff=client(); manager=client(); admin=client()
assert req(guest,'/api/chat',{'action':'start','consent':True},'http://evil.test')[0]==403
assert req(guest,'/api/chat',{'action':'start','consent':False})[0]==400
assert req(guest,'/api/chat',{'action':'start','consent':True})[0]==200
assert req(guest,'/api/chat',{'action':'message','text':'hello'})[0]==503
assert req(guest,'/api/chat',{'action':'handoff'})[0]==200
assert req(guest,'/api/chat',{'action':'message','text':'I like mild food'})[0]==200
assert req(client(),'/api/ops/chat')[0]==401
for c,who in [(staff,'counter'),(manager,'manager'),(admin,'admin')]:
 status,data=req(c,'/api/staff/login',{'email':who+'@khanbaba.com.au','password':'KhanBaba2026!'})
 assert status==200,(who,status,data)
assert req(staff,'/api/ops/chat?archive=1')[0]==403
assert req(manager,'/api/ops/chat?archive=1')[0]==403
status,data=req(staff,'/api/ops/chat'); assert status==200 and len(data['chats'])==1,(status,data)
id=data['chats'][0]['id']
status,data=req(staff,'/api/ops/chat?id='+id);assert status==200 and data['messages'][0]['text']=='I like mild food',(status,data)
assert req(staff,'/api/ops/chat',{'id':id,'action':'reply','text':'We can help'})[0]==200
status,data=req(guest,'/api/chat'); assert any(m['text']=='We can help' for m in data['messages']),(status,data)
assert req(staff,'/api/ops/chat',{'id':id,'action':'close'})[0]==200
assert req(staff,'/api/ops/chat?id='+id)[0]==404
status,data=req(admin,'/api/ops/chat?archive=1&id='+id); assert status==200 and len(data['messages'])==2,(status,data)
print('Chat HTTP flow, origin and role checks passed')

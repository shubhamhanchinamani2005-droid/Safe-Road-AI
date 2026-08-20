import http.client
import json

conn = http.client.HTTPConnection("localhost", 5000)
payload = json.dumps({
    "lat": 28.6139,
    "lng": 77.2090,
    "damage_type": "Pothole",
    "severity": "High",
    "image_url": "http://example.com/test.jpg"
})
headers = {'Content-Type': 'application/json'}
conn.request("POST", "/api/reports", payload, headers)
res = conn.getresponse()
data = res.read()
print(res.status)
print(data.decode("utf-8"))

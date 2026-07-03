with open('/etc/nginx/sites-enabled/justsaysayforfun', 'r') as f:
    content = f.read()
with open('/tmp/q-dev-nginx.conf', 'r') as f:
    block = f.read()
content = content.replace('    location /q {', block + '    location /q {')
with open('/etc/nginx/sites-enabled/justsaysayforfun', 'w') as f:
    f.write(content)

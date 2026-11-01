import re,os
H=os.path.dirname(os.path.abspath(__file__))
src=lambda n: open(os.path.join(H,n),encoding='utf-8').read()
md=open('/Users/ryanchan/.claude/skills/prototype/PICKER.md').read()
css=[b for l,b in re.findall(r'```(\w+)\n([\s\S]*?)```',md) if l=='css'][0]
s=src('zen-c.html')
fx_css='\n'.join(src(n) for n in ['fx.css','side.css','unslop.css','home.css','settings.css'])
fx_js='\n'.join(src(n) for n in ['fx.js','top-api.js','texture.js','kit.js','beam.js','settings.js','side.js'])
nav=src('nav.html')
s=s.replace('<title>Zen C · Compact rail + workspaces</title>','<title>Falcon · prototype</title>',1)
i=s.rfind('</head>'); s=s[:i]+'<style>'+fx_css+'\n'+css+'</style>'+s[i:]
i=s.rfind('</body>'); s=s[:i]+nav+'<script>'+fx_js+'</script>'+s[i:]
open(os.path.join(H,'..','falcon.html'),'w',encoding='utf-8').write(s)

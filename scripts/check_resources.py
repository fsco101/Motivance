"""Check bilingual resource coverage/formatting and the critical theme contrast pairs."""
from datetime import datetime, timezone
import json
from pathlib import Path
import re
import xml.etree.ElementTree as ET

ROOT=Path(__file__).resolve().parents[1]

def main():
    def strings(folder):
        root=ET.parse(ROOT/'android/app/src/main/res'/folder/'strings.xml').getroot()
        result={}
        for e in root:
            if e.tag!='string': continue
            name=e.attrib['name']; assert name not in result, 'Duplicate resource '+name
            result[name]=''.join(e.itertext()); assert result[name].strip(), 'Empty resource '+name
        return result
    en,fil=strings('values'),strings('values-fil')
    assert en.keys()==fil.keys(), 'English/Filipino resource names differ'
    for name in en:
        assert sorted(re.findall(r'%\d+\$[dsf]',en[name]))==sorted(re.findall(r'%\d+\$[dsf]',fil[name])), 'Format mismatch '+name
    def luminance(color):
        values=[int(color[i:i+2],16)/255 for i in (0,2,4)]
        values=[v/12.92 if v<=.04045 else ((v+.055)/1.055)**2.4 for v in values]
        return sum(a*b for a,b in zip(values,[.2126,.7152,.0722]))
    pairs=[('002042','FFFFFF'),('006A61','FFFFFF'),('0B1C30','F8F9FF'),('43474F','E5EEFF'),('006A61','D6F7F0')]
    contrasts=[]
    for fg,bg in pairs:
        a,b=sorted([luminance(fg),luminance(bg)])
        ratio=(b+.05)/(a+.05);assert ratio>=4.5,(fg,bg,ratio)
        contrasts.append({'foreground':fg,'background':bg,'contrast_ratio':round(ratio,2)})
    report={'generated_at':datetime.now(timezone.utc).isoformat(),'strings_per_locale':len(en),'format_parity':True,'critical_contrasts':contrasts,'limitations':['Translation wording and TalkBack comprehension require deferred human review. Automated coverage does not establish linguistic or clinical approval.']}
    (ROOT/'docs/validation/sprint-04-resource-checks.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
    print(f'{len(en)} resources per language; format parity and {len(pairs)} critical contrast pairs passed.')

if __name__=='__main__': main()

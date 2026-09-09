#!/usr/bin/env python3
# 把 docs/手册.md 转成《说剑手札》网页 docs/手册.html。用法: python3 dev/build-manual.py
import re, html, sys, os

SRC = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'docs', '手册.md')
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'docs', '手册.html')

md = open(SRC, encoding='utf-8').read()

def inline(s):
    s = html.escape(s, quote=False)
    s = re.sub(r'\*\*(.+?)\*\*', r'<b>\1</b>', s)
    s = re.sub(r'`(.+?)`', r'<code>\1</code>', s)
    return s

# ── 分块 ──
lines = md.split('\n')
out = []
toc = []          # (level, id, text)
i = 0
sec_id = 0
in_vol = None     # 当前卷号（用于招式牌判断）
vol_count = 0

def slug():
    global sec_id
    sec_id += 1
    return 's%d' % sec_id

def table(rows):
    # rows: list of list of cell strings; first row header
    hdr = rows[0]; body = rows[1:]
    duo = len(hdr) == 2 and all(('留' in h or '杀' in h) for h in hdr)
    cls = ' class="duo"' if duo else ''
    h = ['<div class="tbl"><table%s><thead><tr>' % cls]
    for c in hdr: h.append('<th>%s</th>' % inline(c))
    h.append('</tr></thead><tbody>')
    for r in body:
        h.append('<tr>')
        for c in r: h.append('<td>%s</td>' % inline(c))
        h.append('</tr>')
    h.append('</tbody></table></div>')
    return ''.join(h)

para_buf = []
def flush_para():
    global para_buf
    if para_buf:
        txt = ' '.join(para_buf).strip()
        if txt:
            if txt.startswith('〔') and txt.endswith('〕'):
                out.append('<p class="nums">%s</p>' % inline(txt[1:-1]))
            else:
                out.append('<p>%s</p>' % inline(txt))
        para_buf = []

card_open = False
def close_card():
    global card_open
    if card_open:
        out.append('</section>'); card_open = False

while i < len(lines):
    ln = lines[i]
    if ln.startswith('# '):
        flush_para(); i += 1; continue                      # 总标题另画
    if ln.startswith('---'):
        flush_para(); close_card(); out.append('<div class="rule" aria-hidden="true"></div>'); i += 1; continue
    if ln.startswith('## '):
        flush_para(); close_card()
        t = ln[3:].strip()
        m = re.match(r'(卷[一二三四五六七八]|卷首|附录)\s*·?\s*(.*)', t)
        sid = slug()
        if m:
            vol, rest = m.group(1), m.group(2)
            in_vol = vol
            out.append('<header class="vol" id="%s"><div class="volmark"><span class="seal">%s</span></div><h2><span class="v">%s</span>%s</h2></header>' % (sid, inline(vol.replace('卷','') or '首'), inline(vol), ('<span class="t">%s</span>' % inline(rest)) if rest else ''))
            toc.append((2, sid, vol, rest))
        else:
            out.append('<header class="vol" id="%s"><h2>%s</h2></header>' % (sid, inline(t)))
            toc.append((2, sid, t, ''))
        i += 1; continue
    if ln.startswith('### '):
        flush_para(); close_card()
        t = ln[4:].strip()
        sid = slug()
        m = re.match(r'(.+?)（(.)）$', t)
        if in_vol == '卷六' and m:
            name, glyph = m.group(1), m.group(2)
            out.append('<section class="card tech" id="%s"><div class="glyph">%s</div><h3>%s</h3>' % (sid, inline(glyph), inline(name)))
            card_open = True
            toc.append((3, sid, name, ''))
        elif in_vol == '卷三' or in_vol == '卷七':
            m2 = re.match(r'(.+?)\s*·\s*(.+)$', t)
            sub = ('<span class="sub">%s</span>' % inline(m2.group(2))) if m2 else ''
            name = m2.group(1) if m2 else t
            out.append('<section class="card" id="%s"><h3>%s%s</h3>' % (sid, inline(name), sub))
            card_open = True
            toc.append((3, sid, name, ''))
        else:
            out.append('<h3 id="%s">%s</h3>' % (sid, inline(t)))
            toc.append((3, sid, t, ''))
        i += 1; continue
    if ln.startswith('> '):
        flush_para()
        q = []
        while i < len(lines) and lines[i].startswith('> '):
            q.append(lines[i][2:]); i += 1
        txt = ' '.join(q)
        if txt.startswith('校：'):
            out.append('<aside class="jiao"><span class="jmark">校</span>%s</aside>' % inline(txt[2:]))
        else:
            out.append('<blockquote>%s</blockquote>' % '<br>'.join(inline(x) for x in q))
        continue
    if ln.startswith('|'):
        flush_para()
        rows = []
        while i < len(lines) and lines[i].startswith('|'):
            if not re.match(r'^\|\s*-', lines[i]):
                rows.append([c.strip() for c in lines[i].strip().strip('|').split('|')])
            i += 1
        out.append(table(rows)); continue
    m = re.match(r'^(\d+)\. (.*)', ln)
    if m:
        flush_para()
        items = []
        while i < len(lines) and re.match(r'^\d+\. ', lines[i]):
            items.append(re.sub(r'^\d+\. ', '', lines[i])); i += 1
        out.append('<ol>%s</ol>' % ''.join('<li>%s</li>' % inline(x) for x in items)); continue
    if ln.startswith('- '):
        flush_para()
        items = []
        while i < len(lines) and lines[i].startswith('- '):
            items.append(lines[i][2:]); i += 1
        out.append('<ul>%s</ul>' % ''.join('<li>%s</li>' % inline(x) for x in items)); continue
    if ln.strip() == '':
        flush_para(); i += 1; continue
    para_buf.append(ln); i += 1
flush_para(); close_card()

body = '\n'.join(out)

# ── 目录 ──
nav = ['<nav class="rail" aria-label="目录"><a class="home" href="#top">说剑手札</a><ol>']
for lvl, sid, t, rest in toc:
    if lvl == 2:
        if t in ('卷首', '附录'):
            nav.append('<li><a href="#%s"><span class="n">%s</span></a></li>' % (sid, html.escape(t)))
        else:
            nav.append('<li><a href="#%s"><span class="n">%s</span>%s</a></li>' % (sid, html.escape(t.replace('卷','')), html.escape(rest)))
nav.append('</ol></nav>')
navh = ''.join(nav)

css = r'''
:root{--paper:#efe7d8;--paper2:#e2d7c1;--ink:#1b1a17;--ink2:#35322c;--ink3:#6f6a60;--feibai:rgba(27,26,23,.12);--cin:#b03a2b;--stone:#4a6f7c;--gamb:#c8a55b;
 --disp:"Ma Shan Zheng","Kaiti SC","STKaiti","KaiTi",serif;--body:"Noto Serif SC","Songti SC","STSong","SimSun",serif;}
html{scroll-behavior:smooth}
@media (prefers-reduced-motion:reduce){html{scroll-behavior:auto}}
body{margin:0;background:var(--paper);color:var(--ink2);font-family:var(--body);font-size:17px;line-height:1.95;-webkit-font-smoothing:antialiased}
b{color:var(--ink);font-weight:600}
code{font-family:var(--body);color:var(--ink3);font-size:.92em}
a{color:inherit}
.page{display:grid;grid-template-columns:1fr;max-width:1180px;margin:0 auto;padding:0 20px 120px}
@media (min-width:1100px){.page{grid-template-columns:150px 720px;column-gap:80px;justify-content:center}}
/* 目录竖排 */
.rail{display:none}
@media (min-width:1100px){.rail{display:block;position:sticky;top:0;align-self:start;height:100vh;padding-top:64px;box-sizing:border-box}
 .rail .home{display:block;font-family:var(--disp);font-size:30px;color:var(--ink);text-decoration:none;writing-mode:vertical-rl;letter-spacing:.18em;margin:0 0 28px 0;line-height:1}
 .rail ol{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:9px}
 .rail li a{text-decoration:none;color:var(--ink3);font-size:13px;letter-spacing:.12em;line-height:1.5;display:block;padding-left:10px;border-left:1.5px solid transparent}
 .rail li a .n{font-family:var(--disp);color:var(--ink);font-size:15px;margin-right:6px}
 .rail li a:hover,.rail li a:focus-visible{color:var(--cin);border-left-color:var(--cin);outline:none}}
main{min-width:0}
/* 扉页 */
.cover{padding:96px 0 40px;position:relative}
.cover h1{font-family:var(--disp);font-weight:400;font-size:88px;line-height:1;margin:0 0 18px;color:var(--ink);letter-spacing:.06em;text-wrap:balance}
.cover .dek{color:var(--ink3);font-size:15px;letter-spacing:.06em;margin:0}
.cover .stamp{position:absolute;right:8px;top:104px;width:64px;height:64px;border:2.5px solid var(--cin);color:var(--cin);font-family:var(--disp);font-size:26px;line-height:1;display:grid;place-items:center;transform:rotate(-6deg);border-radius:3px;opacity:.9;letter-spacing:.05em;writing-mode:vertical-rl}
canvas.stroke{display:block;width:100%;height:28px}
.rule{height:28px;margin:44px 0 20px}
/* 卷首 */
.vol{margin:56px 0 18px;display:flex;align-items:flex-end;gap:18px}
.vol .volmark .seal{display:inline-grid;place-items:center;width:44px;height:44px;border:2px solid var(--cin);color:var(--cin);font-family:var(--disp);font-size:24px;border-radius:2px;transform:rotate(-4deg)}
.vol h2{font-family:var(--disp);font-weight:400;font-size:40px;line-height:1.05;margin:0;color:var(--ink);letter-spacing:.05em;text-wrap:balance}
.vol h2 .v{font-size:18px;color:var(--ink3);letter-spacing:.3em;display:block;margin-bottom:6px;font-family:var(--body)}
h3{font-family:var(--disp);font-weight:400;font-size:27px;color:var(--ink);margin:38px 0 8px;letter-spacing:.04em;line-height:1.2}
h3 .sub{font-family:var(--body);font-size:13px;color:var(--ink3);letter-spacing:.25em;margin-left:14px;vertical-align:middle}
p{margin:0 0 16px;max-width:38em}
ul,ol{margin:0 0 18px;padding-left:1.4em;max-width:38em}
li{margin:4px 0}
blockquote{margin:0 0 18px;padding:12px 18px;border-left:2px solid var(--gamb);color:var(--ink);background:var(--paper2)}
/* 数字脚注：小字、淡墨、等宽数字 */
.nums{font-size:12.5px;color:var(--ink3);letter-spacing:.04em;font-variant-numeric:tabular-nums;margin:-6px 0 22px;padding-top:6px;border-top:1px solid var(--feibai);max-width:38em}
/* 校：眉批 */
.jiao{position:relative;margin:6px 0 22px;padding:10px 14px 10px 44px;color:var(--stone);font-size:14.5px;line-height:1.8;border-top:1px solid rgba(74,111,124,.25);border-bottom:1px solid rgba(74,111,124,.25);max-width:38em}
.jiao .jmark{position:absolute;left:0;top:10px;width:26px;height:26px;border:1.5px solid var(--cin);color:var(--cin);font-family:var(--disp);font-size:15px;display:grid;place-items:center;border-radius:2px;transform:rotate(-5deg)}
@media (min-width:1100px){.jiao{position:relative}}
/* 表格 */
.tbl{overflow-x:auto;margin:6px 0 22px}
table{border-collapse:collapse;width:100%;font-size:15px;line-height:1.7}
th{font-weight:500;color:var(--ink3);text-align:left;letter-spacing:.12em;font-size:13px;padding:6px 10px;border-bottom:1.5px solid var(--ink2)}
td{padding:8px 10px;vertical-align:top;border-bottom:1px solid var(--feibai)}
table.duo{table-layout:fixed}
table.duo th{color:var(--ink);font-family:var(--disp);font-size:20px;letter-spacing:.3em;border-bottom-color:var(--feibai)}
table.duo th:first-child{color:var(--stone)} table.duo th:last-child{color:var(--cin)}
table.duo td{background:var(--paper2);color:var(--ink);padding:14px 16px}
table.duo td:first-child{border-right:6px solid var(--paper)}
/* 牌 */
.card{margin:30px 0 8px;padding:6px 0 2px}
.card h3{margin-top:0}
.tech{position:relative;padding-left:82px;min-height:70px}
.tech .glyph{position:absolute;left:0;top:2px;width:58px;height:62px;display:grid;place-items:center;font-family:var(--disp);font-size:34px;color:var(--ink);border:2px solid var(--ink);border-radius:28% 30% 26% 30% / 34% 30% 34% 30%;background:var(--paper2);transform:rotate(-1.5deg)}
.tech p{margin-bottom:10px}
.tech .nums{margin-top:2px}
.foot{margin-top:80px;color:var(--ink3);font-size:13px;letter-spacing:.06em}
.foot .seal{display:inline-grid;place-items:center;width:52px;height:52px;border:2.5px solid var(--cin);color:var(--cin);font-family:var(--disp);font-size:22px;writing-mode:vertical-rl;border-radius:2px;transform:rotate(-6deg);margin-right:16px;vertical-align:middle}
'''

js = r'''
(function(){
 // 分隔线：程序化毛笔笔触（起收渐细 + 微抖 + 飞白断口），与游戏里 Ink.stroke 同一思路
 function stroke(cv){
  var W=cv.clientWidth||700, H=28; cv.width=W*2; cv.height=H*2; var g=cv.getContext('2d'); g.scale(2,2);
  var seed=Math.random()*1000; function r(n){ seed=(seed*9301+49297)%233280; return seed/233280*n; }
  var pts=[], n=40, x0=W*0.06+r(W*0.04), x1=W*0.94-r(W*0.04), y=H/2+2;
  for(var i=0;i<=n;i++){ var t=i/n; pts.push({x:x0+(x1-x0)*t, y:y+Math.sin(t*3.1+r(0.3))*1.6+ (r(2)-1)*0.8}); }
  g.fillStyle='rgba(27,26,23,0.78)'; g.beginPath();
  for(var i=0;i<=n;i++){ var t=i/n, w=(0.9+3.2*Math.sin(Math.PI*Math.pow(t,0.7)))*(t<0.08?t/0.08:1); if(t>0.97) w*=(1-t)/0.03; g.lineTo(pts[i].x, pts[i].y-w/2); }
  for(var i=n;i>=0;i--){ var t=i/n, w=(0.9+3.2*Math.sin(Math.PI*Math.pow(t,0.7)))*(t<0.08?t/0.08:1); if(t>0.97) w*=(1-t)/0.03; g.lineTo(pts[i].x, pts[i].y+w/2); }
  g.closePath(); g.fill();
  // 飞白：沿线擦掉两三段细缝
  g.globalCompositeOperation='destination-out'; g.fillStyle='rgba(0,0,0,0.9)';
  var gaps=2+Math.floor(r(2)); for(var k=0;k<gaps;k++){ var gx=x0+(x1-x0)*(0.25+r(0.5)); g.fillRect(gx, y-4, 1+r(2), 8); g.fillRect(gx+3+r(3), y-1, 1, 3); }
  g.globalCompositeOperation='source-over';
 }
 document.querySelectorAll('.rule').forEach(function(d){ var c=document.createElement('canvas'); c.className='stroke'; d.appendChild(c); stroke(c); });
 // 纸纹：一块 220×220 的淡噪点做底
 var pc=document.createElement('canvas'); pc.width=pc.height=220; var pg=pc.getContext('2d'); var im=pg.createImageData(220,220);
 for(var i=0;i<im.data.length;i+=4){ var v=Math.random(); im.data[i]=im.data[i+1]=im.data[i+2]= v<0.5?27:200; im.data[i+3]= v<0.5? 6 : (v>0.985? 14:0); }
 pg.putImageData(im,0,0); document.body.style.backgroundImage='url('+pc.toDataURL()+')';
})();
'''

page = '''<title>说剑手札</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Ma+Shan+Zheng&family=Noto+Serif+SC:wght@400;500;600&display=swap">
<style>%s</style>
<div class="page" id="top">
%s
<main>
<header class="cover">
 <h1>说剑手札</h1>
 <p class="dek">故事 · 人物 · 设定 · 十二招 · 图鉴 · 导览　　写给听完一遍的人</p>
 <div class="stamp" aria-hidden="true">无名</div>
</header>
<div class="rule" aria-hidden="true"></div>
%s
<footer class="foot"><span class="seal" aria-hidden="true">无名</span>不说了。</footer>
</main>
</div>
<script>%s</script>
''' % (css, navh, body, js)

os.makedirs(os.path.dirname(OUT), exist_ok=True)
open(OUT, 'w', encoding='utf-8').write(page)
print('wrote', OUT, len(page), 'bytes;', len(toc), 'toc entries')

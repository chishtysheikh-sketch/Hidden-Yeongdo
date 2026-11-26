#!/usr/bin/env python3
"""Replace every {{TOKEN}} in the site with the values from site-info.json.

Usage (from the project folder):  python3 tools/fill-info.py
It edits the files in place and fills only the fields that have a value, so
you can run it again after filling in more fields. It lists what is still missing.
"""
import html, json, pathlib, re, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
FILES = [*ROOT.glob("*.html"), ROOT / "js/main.js", ROOT / "sitemap.xml", ROOT / "robots.txt"]

info = json.loads((ROOT / "site-info.json").read_text(encoding="utf-8"))
missing = [k for k, v in info.items() if not k.startswith("_") and (not str(v).strip() or "__" in str(v))]
for k in missing:
    info[k] = ""
have = lambda k: bool(info.get(k, "").strip())

def digits(s):
    return re.sub(r"\D", "", s)

def won(s):
    n = int(digits(s))
    return n, "₩{:,}".format(n)

esc = lambda s: html.escape(s.strip(), quote=True)
t = {}
if have("email"):
    t["EMAIL"] = esc(info["email"])
if have("phone"):
    t["PHONE"] = esc(info["phone"])
    p = digits(info["phone"])
    t["PHONE_INTL"] = "+82" + p.lstrip("0") if not p.startswith("82") else "+" + p
if have("whatsapp"):
    t["WHATSAPP_DIGITS"] = digits(info["whatsapp"])
if have("naver_map_url"):
    t["NAVER_MAP_URL"] = esc(info["naver_map_url"])
if have("formspree_id"):
    t["FORMSPREE_ID"] = esc(info["formspree_id"].split("/")[-1])
for key in ("adult", "child", "student"):
    if have("price_" + key):
        n, label = won(info["price_" + key])
        t["PRICE_" + key.upper()] = label
        t["PRICE_" + key.upper() + "_NUM"] = str(n)
if have("departure_days"):
    t["DEPARTURE_DAYS"] = esc(info["departure_days"])
if have("min_group"):
    t["MIN_GROUP"] = str(int(digits(info["min_group"])))
if have("site_url"):
    url = info["site_url"].strip()
    t["SITE_URL"] = esc(url if url.endswith("/") else url + "/")
if have("kakao"):
    k = info["kakao"].strip()
    if k.startswith("http"):
        t["KAKAO_HTML"] = '<a href="%s" target="_blank" rel="noopener">KakaoTalk</a>' % esc(k)
        t["KAKAO_DETAIL"] = '<a href="%s" target="_blank" rel="noopener">Open chat on KakaoTalk</a>' % esc(k)
    else:
        # KakaoTalk IDs cannot be linked, so show the ID with a Copy button (js/main.js part 12)
        t["KAKAO_HTML"] = ('<span class="kakao">KakaoTalk ID: <strong>%s</strong> '
                           '<button type="button" class="copy-btn" data-copy="%s">Copy ID</button></span>') % (esc(k), esc(k))
        t["KAKAO_DETAIL"] = t["KAKAO_HTML"]

left = set()
for f in FILES:
    if not f.exists():
        continue
    text = f.read_text(encoding="utf-8")
    new = re.sub(r"\{\{([A-Z_]+)\}\}", lambda m: t.get(m.group(1), m.group(0)), text)
    left |= set(re.findall(r"\{\{[A-Z_]+\}\}", new))
    if new != text:
        f.write_text(new, encoding="utf-8")
        print("filled", f.relative_to(ROOT))
if missing:
    print("Still empty in site-info.json: " + ", ".join(missing))
if left:
    sys.exit("Placeholders still in the pages: " + ", ".join(sorted(left)))
print("Done – no placeholders left.")

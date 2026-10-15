# Service worker réel (http://localhost) : ouverture instantanée depuis la copie locale quand le réseau est lent ou absent,
# mise à jour en arrière-plan (nouvelle version à l'ouverture suivante), cas limites (POST, Range, 404, fichiers OCR).
# Usage : python3 build.py dist && python3 test_sw.py [dossier_dist]
import asyncio, functools, os, shutil, socket, sys, tempfile, threading, time
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from playwright.async_api import async_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
SDK = open(os.path.join(HERE, "fake_sdk.js"), encoding="utf-8").read()
MSG = "Nouvelle version prête"
LIMIT = 1.5  # secondes : l'appli doit s'afficher en moins de 1,5 s, même réseau lent ou absent
SLOW = 6.0   # secondes de retard du serveur pour simuler un réseau faible
# polices / Firebase externes : échec immédiat (pas d'accès Internet en test), pour la page comme pour le service worker
CHROME_ARGS = ["--host-resolver-rules=MAP fonts.googleapis.com ~NOTFOUND, MAP fonts.gstatic.com ~NOTFOUND, MAP www.gstatic.com ~NOTFOUND"]
FAILS = []
def ok(c, m):
    print(("OK   " if c else "FAIL ") + m)
    if not c: FAILS.append(m)


class Server:
    """Sert un dossier comme GitHub Pages (Cache-Control: max-age=600), avec retard réglable, panne simulée et Range."""
    def __init__(self, root):
        self.root, self.delay, self.down, self.active, self.log = root, 0.0, False, 0, []
        srv = self
        class H(SimpleHTTPRequestHandler):
            def log_message(self, *a): pass
            def end_headers(self):
                self.send_header("Cache-Control", "max-age=600"); super().end_headers()
            def do_GET(self):
                srv.active += 1
                try:
                    srv.log.append(self.path)
                    if srv.down: self.close_connection = True; return   # connexion fermée sans réponse = erreur réseau
                    if srv.delay: time.sleep(srv.delay)
                    rng = self.headers.get("Range"); p = self.translate_path(self.path)
                    if rng and rng.startswith("bytes=") and os.path.isfile(p):
                        data = open(p, "rb").read(); a, b = rng[6:].split("-"); a = int(a); b = int(b) if b else len(data) - 1
                        part = data[a:b + 1]
                        self.send_response(206); self.send_header("Content-Type", self.guess_type(p))
                        self.send_header("Content-Range", f"bytes {a}-{b}/{len(data)}"); self.send_header("Content-Length", str(len(part)))
                        self.end_headers(); self.wfile.write(part); return
                    super().do_GET()
                finally:
                    srv.active -= 1
        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(H, directory=root))
        self.httpd.daemon_threads = True
        self.port = self.httpd.server_address[1]
        assert self.port != 8772
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()
    async def idle(self, timeout=15):
        t = time.time()
        while self.active and time.time() - t < timeout: await asyncio.sleep(0.1)
        await asyncio.sleep(0.3)
    def stop(self): self.httpd.shutdown()


def edit(path, old, new):
    s = open(path, encoding="utf-8").read(); assert s.count(old) == 1, old; st = os.stat(path)
    open(path, "w", encoding="utf-8").write(s.replace(old, new))
    t = max(time.time(), st.st_mtime + 2); os.utime(path, (t, t))   # Last-Modified change toujours (résolution 1 s)


async def until(page, js, timeout, fail=True):
    """Attend qu'une expression soit vraie (page.evaluate passe par le protocole du navigateur : compatible avec la CSP stricte)."""
    t = time.time()
    while time.time() - t < timeout:
        try:
            if await page.evaluate(js): return True
        except Exception: pass   # page en cours de rechargement
        await asyncio.sleep(0.015)
    if fail: raise TimeoutError(js)
    return False


async def timed(page, url=None):
    """Ouvre (ou recharge) l'appli ; renvoie les secondes jusqu'à l'écran de l'appli dans le DOM, jusqu'à l'appli prête
    (session restaurée, voile de connexion retiré), et le premier affichage (FCP) mesuré par le navigateur."""
    t0 = time.perf_counter()
    if url: await page.goto(url, wait_until="commit", timeout=30000)
    else: await page.reload(wait_until="commit", timeout=30000)
    await page.wait_for_selector("#lgScrim", state="attached", timeout=30000)
    shell = time.perf_counter() - t0
    await until(page, "document.getElementById('lgScrim').hidden", 30)
    ready = time.perf_counter() - t0
    await until(page, "performance.getEntriesByName('first-contentful-paint').length>0", 30)
    nav = await page.evaluate("""(()=>{const n=performance.getEntriesByType('navigation')[0];
      return {fcp:performance.getEntriesByName('first-contentful-paint')[0].startTime/1000,sw:n.workerStart>0,resp:n.responseStart/1000}})()""")
    return {"shell": shell, "ready": ready, "fcp": nav["fcp"], "viaSW": nav["sw"]}

def fmt(t): return f"écran {t['shell']:.2f} s · prête {t['ready']:.2f} s · 1er affichage {t['fcp']:.2f} s · via SW {t['viaSW']}"

async def marker(page):
    return await page.evaluate("(document.querySelector('meta[name=als-marker]')||{}).content||'v1'")

async def cache_names(page):
    return await page.evaluate("caches.keys()")

async def login(page):
    await page.wait_for_selector("#lgForm:not([hidden])", timeout=10000)
    await page.fill("#lgMail", "a@x.fr"); await page.fill("#lgPass", "good"); await page.click("#lgGo")
    await until(page, 'document.getElementById("syncT").textContent==="Synchronisé"', 10)

async def wait_sw(page, timeout=20):
    t = time.time()
    while time.time() - t < timeout:
        if await page.evaluate("!!navigator.serviceWorker.controller&&caches.keys().then(ks=>Promise.all(ks.map(k=>caches.open(k).then(c=>c.match(location.origin+'/app.html'))))).then(l=>l.some(Boolean))"):
            return True
        await asyncio.sleep(0.2)
    return False


async def main(dist):
    tmp = tempfile.mkdtemp(prefix="als-sw-"); shutil.copytree(dist, tmp, dirs_exist_ok=True)
    os.makedirs(os.path.join(tmp, "ocr"), exist_ok=True)
    with open(os.path.join(tmp, "ocr", "fake-core.wasm"), "wb") as f: f.write(os.urandom(600_000))   # gros fichier OCR factice
    srv = Server(tmp); url = f"http://localhost:{srv.port}/app.html"; T = {}
    try:
        async with async_playwright() as pw:
            b = await pw.chromium.launch(args=CHROME_ARGS)
            ctx = await b.new_context(viewport={"width": 390, "height": 780})   # vraie CSP (pas de bypass)
            await ctx.add_init_script(SDK); await ctx.add_init_script("window.__ALS_SDK.sw=true")
            page = await ctx.new_page(); errs = []; csp = []
            page.on("pageerror", lambda e: errs.append(str(e)))
            page.on("console", lambda m: csp.append(m.text) if "Content Security Policy" in m.text else None)

            # 1. première ouverture, en ligne : la page enregistre elle-même le service worker et met l'appli de côté
            t0 = time.perf_counter(); await page.goto(url, wait_until="commit")
            await page.wait_for_selector("#lgForm:not([hidden])", timeout=10000)
            print(f"   1re ouverture (réseau, sans service worker) : formulaire de connexion en {time.perf_counter() - t0:.2f} s")
            await login(page)
            ok(await wait_sw(page), "la page enregistre le service worker et la copie locale contient app.html")
            sw0 = await cache_names(page); ok(len(sw0) == 1 and sw0[0].startswith("als-"), "un seul cache versionné : " + str(sw0))

            # 2. réouverture, réseau normal
            T["réseau normal"] = t = await timed(page); print("   réseau normal :", fmt(t))
            ok(t["viaSW"], "page servie par le service worker")

            # 3. réseau très lent (serveur : +6 s sur chaque requête)
            await srv.idle(); srv.delay = SLOW; n0 = len(srv.log)
            T["réseau lent (+6 s)"] = t = await timed(page); print("   réseau lent   :", fmt(t))
            ok(t["shell"] < LIMIT, f"réseau lent : écran de l'appli en {t['shell']:.2f} s (< {LIMIT} s)")
            ok(t["ready"] < LIMIT, f"réseau lent : appli prête en {t['ready']:.2f} s (< {LIMIT} s)")
            ok(t["fcp"] < LIMIT, f"réseau lent : premier affichage en {t['fcp']:.2f} s (< {LIMIT} s)")
            await asyncio.sleep(0.5)
            ok("/app.html" in srv.log[n0:], "réseau lent : app.html quand même redemandé en arrière-plan")
            await srv.idle(SLOW + 5); srv.delay = 0

            # 4. hors ligne (navigateur hors ligne + serveur qui coupe toute connexion)
            srv.down = True; await ctx.set_offline(True)
            T["hors ligne"] = t = await timed(page); print("   hors ligne    :", fmt(t))
            ok(t["shell"] < LIMIT and t["ready"] < LIMIT, f"hors ligne : appli affichée en {t['ready']:.2f} s (< {LIMIT} s)")
            r = await page.evaluate("fetch('ocr/fake-core.wasm').then(r=>r.status,()=>'erreur')")
            ok(r == "erreur", "hors ligne : fichier OCR jamais chargé -> erreur réseau propre (pas de fausse réponse)")
            await ctx.set_offline(False); srv.down = False

            # 5. nouvelle page sur le serveur (même service worker) : servie instantanément l'ancienne, nouvelle à l'ouverture suivante
            await srv.idle()
            edit(os.path.join(tmp, "app.html"), "</head>", '<meta name="als-marker" content="v2"></head>')
            T["après mise à jour du serveur"] = t = await timed(page); print("   page modifiée :", fmt(t))
            ok(await marker(page) == "v1", "1re ouverture après modification : copie locale (instantanée)")
            seen = await until(page, f"document.getElementById('toast').textContent.includes({MSG!r})", 10, fail=False)
            ok(seen, "message « " + MSG + " — elle s'affichera à la prochaine ouverture » affiché")
            await srv.idle()
            got = None
            for k in range(1, 5):
                await timed(page)
                if await marker(page) == "v2": got = k; break
                await srv.idle()
            ok(got == 1, f"nouvelle version servie à l'ouverture suivante (après {got} rechargement(s))")

            # 6. nouvelle construction (app.html + app-sw.js changent) : le service worker se met à jour, l'ancien cache est supprimé
            sw_path = os.path.join(tmp, "app-sw.js"); s = open(sw_path, encoding="utf-8").read()
            v_old = s.split('const V="', 1)[1].split('"', 1)[0]; v_new = v_old + "-b"
            edit(sw_path, f'const V="{v_old}"', f'const V="{v_new}"')
            edit(os.path.join(tmp, "app.html"), 'content="v2"', 'content="v3"')
            got = None
            for k in range(1, 6):
                await timed(page); await srv.idle(); await asyncio.sleep(1.5)
                if await marker(page) == "v3": got = k; break
            ok(got is not None and got <= 2, f"nouvelle construction affichée après {got} rechargement(s)")
            ks = await cache_names(page)
            ok(ks == [v_new], "ancien cache supprimé, nouveau cache seul : " + str(ks))
            srv.delay = SLOW
            t = await timed(page); print("   nouveau SW, réseau lent :", fmt(t))
            ok(await marker(page) == "v3" and t["ready"] < LIMIT, "nouveau service worker : ouverture instantanée et bonne version")
            await srv.idle(SLOW + 5); srv.delay = 0

            # 7. cas limites
            st = await page.evaluate("fetch('app.html',{method:'POST'}).then(r=>r.status)")
            ok(st == 501, f"POST ignoré par le service worker (réponse du serveur : {st})")
            r = await page.evaluate("fetch('als-512.png',{headers:{Range:'bytes=0-99'}}).then(async r=>[r.status,(await r.arrayBuffer()).byteLength])")
            ok(r == [206, 100], f"Range sur un fichier en cache : réponse partielle du réseau {r}")
            r = await page.evaluate("fetch('nope.txt').then(async r=>[r.status,!!(await caches.match(location.origin+'/nope.txt'))])")
            ok(r == [404, False], f"404 transmise et jamais mise en cache {r}")
            r = await page.evaluate("fetch('ocr/fake-core.wasm?v=1').then(async r=>[r.status,(await r.arrayBuffer()).byteLength])")
            ok(r == [200, 600000], f"fichier OCR chargé {r}")
            await srv.idle()
            r = await page.evaluate("caches.match(location.origin+'/ocr/fake-core.wasm').then(async r=>r?[r.status,(await r.arrayBuffer()).byteLength]:null)")
            ok(r == [200, 600000], f"fichier OCR mis en cache (copie complète) {r}")
            r = await page.evaluate("fetch('ocr/fake-core.wasm',{headers:{Range:'bytes=10-19'}}).then(async r=>[r.status,(await r.arrayBuffer()).byteLength])")
            ok(r == [206, 10], f"Range sur le fichier OCR non cassé {r}")
            n0 = len(srv.log); srv.down = True; await ctx.set_offline(True)
            r = await page.evaluate("fetch('ocr/fake-core.wasm').then(async r=>[r.status,(await r.arrayBuffer()).byteLength])")
            ok(r == [200, 600000], f"hors ligne : fichier OCR servi depuis la copie locale {r}")
            await ctx.set_offline(False); srv.down = False

            ok(not errs, "aucune erreur JavaScript" + ("" if not errs else " : " + errs[0][:200]))
            ok(not csp, "aucune violation CSP" + ("" if not csp else " : " + csp[0][:200]))
            await b.close()
    finally:
        srv.stop(); shutil.rmtree(tmp, ignore_errors=True)
    print("\nMESURES (secondes depuis le début du rechargement) :")
    for k, t in T.items(): print(f"  {k:30s} {fmt(t)}")
    print("\nRÉSULTAT :", "ÉCHEC (" + str(len(FAILS)) + ")" if FAILS else "TOUT PASSE")
    return 1 if FAILS else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main(sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "dist"))))

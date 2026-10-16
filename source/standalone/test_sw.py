# Service worker réel (http://localhost) : ouverture instantanée depuis la copie locale quand le réseau est lent ou absent,
# mise à jour en arrière-plan (nouvelle version à l'ouverture suivante), démarrage à froid hors ligne après installation et
# après mise à jour (Firebase gardé), installation ratée sans dégât, cas limites (POST, Range, 404, fichiers OCR).
# Usage : python3 build.py dist && python3 test_sw.py [dossier_dist]
#
# Firebase : le faux SDK (fake_sdk.js) est servi comme de vrais modules à https://www.gstatic.com/firebasejs/… par une route
# Playwright, pour la page comme pour le service worker (PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS=1, Chromium), pendant
# un 1er lancement du navigateur (1re installation). La page suit donc exactement le chemin de production (import() des
# modules, cache lib() du service worker, enregistrement du service worker par shim.js). Les modules sont servis en
# « no-store » : le cache HTTP de Chromium ne peut pas masquer une copie manquante dans le service worker. Ensuite, le
# navigateur est relancé sur le même profil sans interception : gstatic injoignable, Firebase doit venir du service worker.
import asyncio, functools, os, shutil, sys, tempfile, threading, time
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from playwright.async_api import async_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
SDK = open(os.path.join(HERE, "fake_sdk.js"), encoding="utf-8").read()
MSG = "Nouvelle version prête"
LIMIT = 1.5  # secondes : l'appli doit s'afficher en moins de 1,5 s, même réseau lent ou absent
SLOW = 6.0   # secondes de retard du serveur pour simuler un réseau faible
# polices externes : échec immédiat (pas d'accès Internet en test) ; gstatic est servi par la route avant toute résolution DNS
CHROME_ARGS = ["--host-resolver-rules=MAP fonts.googleapis.com ~NOTFOUND, MAP fonts.gstatic.com ~NOTFOUND, MAP www.gstatic.com ~NOTFOUND"]
FAILS = []
def ok(c, m):
    print(("OK   " if c else "FAIL ") + m)
    if not c: FAILS.append(m)


class Server:
    """Sert un dossier comme GitHub Pages (Cache-Control: max-age=600), avec retard réglable, panne simulée,
    fichiers en erreur 503 (fail) et Range."""
    def __init__(self, root):
        self.root, self.delay, self.down, self.active, self.log, self.fail = root, 0.0, False, 0, [], set()
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
                    if self.path.split("?")[0] in srv.fail: return self.send_error(503)
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


class Gstatic:
    """Faux https://www.gstatic.com/firebasejs/<v>/firebase-*.js : modules ES construits à partir de fake_sdk.js."""
    def __init__(self, names):
        exp = lambda g: "export const " + ",".join(f"{n}=S.{g}.{n}" for n in names[g]) + ";\n"
        other = lambda g: 'import "./firebase-app.js";\nconst S=window.__fakeFirebase;\n' + exp(g)
        self.mods = {   # window.__ALS_SDK retiré : la page se comporte comme en production
            "firebase-app.js": SDK + "\nconst S=window.__ALS_SDK;delete window.__ALS_SDK;window.__fakeFirebase=S;\n" + exp("A"),
            "firebase-auth.js": other("Au"), "firebase-firestore.js": other("F"), "firebase-messaging.js": other("M")}
        self.down, self.hits = False, []
    async def handle(self, route):
        name = route.request.url.rsplit("/", 1)[-1]; self.hits.append(name)
        if self.down or name not in self.mods: return await route.abort("internetdisconnected")
        await route.fulfill(status=200, body=self.mods[name], headers={
            "Content-Type": "text/javascript; charset=utf-8", "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store"})


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
      return {fcp:performance.getEntriesByName('first-contentful-paint')[0].startTime/1000,sw:n.workerStart>0}})()""")
    return {"shell": shell, "ready": ready, "fcp": nav["fcp"], "viaSW": nav["sw"]}

def fmt(t): return f"écran {t['shell']:.2f} s · prête {t['ready']:.2f} s · 1er affichage {t['fcp']:.2f} s · via SW {t['viaSW']}"

async def marker(page):
    return await page.evaluate("(document.querySelector('meta[name=als-marker]')||{}).content||'v1'")

async def versions(page):   # caches versionnés (als-<build>) ; le cache durable s'appelle alslib-…
    return [k for k in await page.evaluate("caches.keys()") if k.startswith("als-")]

async def in_lib(page, path):
    return await page.evaluate(f"caches.keys().then(ks=>ks.find(k=>k.startsWith('alslib-'))).then(k=>k&&caches.open(k)).then(c=>c&&c.match({path!r},{{ignoreSearch:true}})).then(r=>!!r)")

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

async def sw_update(page):
    """Demande une mise à jour du service worker et renvoie les états successifs du nouveau (installing… redundant/activated)."""
    return await page.evaluate("""() => new Promise(async res => {
      const st = []; setTimeout(() => res(st.concat('délai')), 15000);
      const r = navigator.serviceWorker && await navigator.serviceWorker.getRegistration();
      if (!r) return res(['pas de service worker']);
      r.addEventListener('updatefound', () => { const w = r.installing; st.push('installing');
        w.addEventListener('statechange', () => { st.push(w.state); if (w.state === 'redundant' || w.state === 'activated') res(st) }) });
      r.update().catch(e => st.push('update rejetée'));
      setTimeout(() => res(st.concat('délai')), 15000);
    })""")


async def main(dist):
    tmp = tempfile.mkdtemp(prefix="als-sw-"); shutil.copytree(dist, tmp, dirs_exist_ok=True)
    os.makedirs(os.path.join(tmp, "ocr"), exist_ok=True)
    with open(os.path.join(tmp, "ocr", "fake-core.wasm"), "wb") as f: f.write(os.urandom(600_000))   # gros fichier OCR factice
    srv = Server(tmp); url = f"http://localhost:{srv.port}/app.html"; T = {}
    errs, csp = [], []
    def watch(p):
        p.on("pageerror", lambda e: errs.append(str(e)))
        p.on("console", lambda m: csp.append(m.text) if "Content Security Policy" in m.text else None)
        return p
    profile = tempfile.mkdtemp(prefix="als-sw-profil-")   # profil Chromium conservé entre les deux lancements
    gs = None
    def tools(ctx):
        async def offline(on):
            srv.down = on
            if gs: gs.down = on
            await ctx.set_offline(on)
        async def cold_start(page):
            """Démarrage à froid : service worker arrêté (relancé depuis le disque), page fermée, nouvelle page."""
            cdp = await ctx.new_cdp_session(page)
            await cdp.send("ServiceWorker.enable"); await cdp.send("ServiceWorker.stopAllWorkers"); await cdp.detach()
            await page.close(); p = watch(await ctx.new_page()); t0 = time.perf_counter()
            try: await p.goto(url, wait_until="commit", timeout=15000)
            except Exception as e: return p, False, "navigation impossible : " + str(e)[:80], 0
            up = await until(p, "document.getElementById('lgScrim').hidden", 10, fail=False)
            why = "" if up else await p.evaluate("(document.getElementById('lgWaitT')||{}).textContent||''")
            return p, up, why, time.perf_counter() - t0
        return offline, cold_start
    try:
        # Lancement 1, avec interception des requêtes du service worker : la 1re installation charge Firebase depuis « gstatic ».
        os.environ["PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS"] = "1"   # lu au démarrage du pilote Playwright
        async with async_playwright() as pw:
            ctx = await pw.chromium.launch_persistent_context(profile, args=CHROME_ARGS, viewport={"width": 390, "height": 780})
            names = await ctx.pages[0].evaluate("() => {" + SDK + ";return Object.fromEntries(Object.entries(window.__ALS_SDK).map(([k,v])=>[k,Object.keys(v)]))}")
            gs = Gstatic(names)
            await ctx.route("https://www.gstatic.com/firebasejs/**", gs.handle)   # vraie CSP, aucun script injecté
            page = watch(await ctx.new_page()); offline, cold_start = tools(ctx)

            # 1. première ouverture, en ligne, sans service worker : shim.js l'enregistre ; Firebase est remis en copie locale
            t0 = time.perf_counter(); await page.goto(url, wait_until="commit")
            await page.wait_for_selector("#lgForm:not([hidden])", timeout=10000)
            print(f"   1re ouverture (réseau, sans service worker) : formulaire de connexion en {time.perf_counter() - t0:.2f} s")
            await login(page)
            ok(await wait_sw(page), "la page enregistre le service worker et la copie locale contient app.html")
            v0 = await versions(page); ok(len(v0) == 1, "un seul cache versionné : " + str(v0))
            t = time.time()
            while not all([await in_lib(page, f"https://www.gstatic.com/firebasejs/10.14.1/{m}") for m in ("firebase-app.js", "firebase-auth.js", "firebase-firestore.js")]) and time.time() - t < 10:
                await asyncio.sleep(0.2)
            ok(time.time() - t < 10, "dès la 1re installation, Firebase est en copie locale (cache durable)")

            # 1b. démarrage à froid hors ligne juste après la 1re installation
            await offline(True)
            page, up, why, dt = await cold_start(page)
            ok(up, f"hors ligne, démarrage à froid après la 1re installation : appli démarrée ({dt:.2f} s) {why}")
            await offline(False)
            await ctx.close()

        # Lancement 2, même profil, sans interception : Chromium redémarré (vrai démarrage à froid du navigateur) ; gstatic
        # est désormais injoignable, Firebase ne peut venir que de la copie du service worker. (Avec l'interception
        # expérimentale active, Chromium réinstallait le même service worker avant chaque navigation après une mise à jour
        # et la bloquait ~19 s : artefact de Playwright, absent sans elle ; voir le rapport.)
        del os.environ["PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS"]; gs = None
        async with async_playwright() as pw:
            ctx = await pw.chromium.launch_persistent_context(profile, args=CHROME_ARGS, viewport={"width": 390, "height": 780})
            offline, cold_start = tools(ctx)
            page = watch(ctx.pages[0])
            t = await timed(page, url); print("   après redémarrage du navigateur :", fmt(t))
            ok(t["viaSW"] and t["ready"] < LIMIT, "après redémarrage du navigateur : appli servie par le service worker, session gardée")

            # 2. réouverture, réseau normal ; un fichier OCR est chargé (va dans le cache durable)
            T["réseau normal"] = t = await timed(page); print("   réseau normal :", fmt(t))
            ok(t["viaSW"], "page servie par le service worker")
            r = await page.evaluate("fetch('ocr/fake-core.wasm?v=1').then(async r=>[r.status,(await r.arrayBuffer()).byteLength])")
            ok(r == [200, 600000], f"fichier OCR chargé {r}")
            await srv.idle()
            ok(await in_lib(page, f"http://localhost:{srv.port}/ocr/fake-core.wasm"), "fichier OCR mis dans le cache durable")

            # 3. réseau très lent (serveur : +6 s sur chaque requête)
            srv.delay = SLOW; n0 = len(srv.log)
            T["réseau lent (+6 s)"] = t = await timed(page); print("   réseau lent   :", fmt(t))
            ok(t["shell"] < LIMIT, f"réseau lent : écran de l'appli en {t['shell']:.2f} s (< {LIMIT} s)")
            ok(t["ready"] < LIMIT, f"réseau lent : appli prête en {t['ready']:.2f} s (< {LIMIT} s)")
            ok(t["fcp"] < LIMIT, f"réseau lent : premier affichage en {t['fcp']:.2f} s (< {LIMIT} s)")
            await asyncio.sleep(0.5)
            ok("/app.html" in srv.log[n0:], "réseau lent : app.html quand même redemandé en arrière-plan")
            await srv.idle(SLOW + 5); srv.delay = 0

            # 4. hors ligne (navigateur hors ligne + serveur qui coupe toute connexion + gstatic coupé)
            await offline(True)
            T["hors ligne"] = t = await timed(page); print("   hors ligne    :", fmt(t))
            ok(t["shell"] < LIMIT and t["ready"] < LIMIT, f"hors ligne : appli affichée en {t['ready']:.2f} s (< {LIMIT} s)")
            r = await page.evaluate("fetch('ocr/jamais-vu.wasm').then(r=>r.status,()=>'erreur')")
            ok(r == "erreur", "hors ligne : fichier jamais chargé -> erreur réseau propre (pas de fausse réponse)")
            await offline(False)

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

            # 6. nouvelle construction (app.html + app-sw.js changent) : le service worker se met à jour, l'ancien cache est
            #    supprimé, mais Firebase et l'OCR restent : démarrage à froid hors ligne possible, OCR pas retéléchargé
            sw_path = os.path.join(tmp, "app-sw.js"); s = open(sw_path, encoding="utf-8").read()
            v_old = s.split('const V="', 1)[1].split('"', 1)[0]; v_new = v_old + "-b"
            edit(sw_path, f'const V="{v_old}"', f'const V="{v_new}"')
            edit(os.path.join(tmp, "app.html"), 'content="v2"', 'content="v3"')
            n0 = len(srv.log); got = None
            for k in range(1, 6):
                await timed(page); await srv.idle(); await asyncio.sleep(1.5)
                if await marker(page) == "v3": got = k; break
            ok(got is not None and got <= 2, f"nouvelle construction affichée après {got} rechargement(s)")
            ks = await versions(page)
            ok(ks == [v_new], "ancien cache supprimé, nouveau cache seul : " + str(ks))
            ok(await in_lib(page, "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js"), "Firebase toujours en copie locale après la mise à jour")
            ok(await in_lib(page, f"http://localhost:{srv.port}/ocr/fake-core.wasm") and not any("/ocr/" in p for p in srv.log[n0:]),
               "OCR toujours en copie locale après la mise à jour, sans nouveau téléchargement")
            srv.delay = SLOW
            t = await timed(page); print("   nouveau SW, réseau lent :", fmt(t))
            ok(await marker(page) == "v3" and t["ready"] < LIMIT, "nouveau service worker : ouverture instantanée et bonne version")
            await srv.idle(SLOW + 5); srv.delay = 0
            await offline(True)
            page, up, why, dt = await cold_start(page)
            ok(up, f"hors ligne, démarrage à froid après mise à jour : appli démarrée ({dt:.2f} s) {why}")
            ok(up and await marker(page) == "v3", "… et c'est bien la nouvelle version")
            await offline(False)

            # 7. nouvelle construction dont app.html ne se télécharge pas : l'installation échoue, l'ancienne version reste
            await srv.idle()
            v_c = v_old + "-c"
            edit(sw_path, f'const V="{v_new}"', f'const V="{v_c}"')
            srv.fail.add("/app.html")
            st = await sw_update(page)
            ok("redundant" in st and "activated" not in st, f"app.html en erreur : nouveau service worker abandonné {st}")
            ks = await versions(page)
            ok(v_new in ks, f"l'ancienne version et sa copie restent en place {ks}")
            await offline(True)
            page, up, why, dt = await cold_start(page)
            ok(up and await marker(page) == "v3", f"hors ligne, démarrage à froid après l'échec : appli démarrée ({dt:.2f} s) {why}")
            await offline(False); srv.fail.clear(); await srv.idle()
            st = await sw_update(page)
            ok("activated" in st, f"app.html de nouveau disponible : la mise à jour passe {st}")
            await asyncio.sleep(0.5); ks = await versions(page)
            ok(ks == [v_c], f"puis seul le nouveau cache reste {ks}")

            # 8. cas limites
            st = await page.evaluate("fetch('app.html',{method:'POST'}).then(r=>r.status)")
            ok(st == 501, f"POST ignoré par le service worker (réponse du serveur : {st})")
            r = await page.evaluate("fetch('als-512.png',{headers:{Range:'bytes=0-99'}}).then(async r=>[r.status,(await r.arrayBuffer()).byteLength])")
            ok(r == [206, 100], f"Range sur un fichier en cache : réponse partielle du réseau {r}")
            r = await page.evaluate("fetch('nope.txt').then(async r=>[r.status,!!(await caches.match(location.origin+'/nope.txt'))])")
            ok(r == [404, False], f"404 transmise et jamais mise en cache {r}")
            r = await page.evaluate("caches.match(location.origin+'/ocr/fake-core.wasm',{ignoreSearch:true}).then(async r=>r?[r.status,(await r.arrayBuffer()).byteLength]:null)")
            ok(r == [200, 600000], f"fichier OCR en cache : copie complète {r}")
            r = await page.evaluate("fetch('ocr/fake-core.wasm',{headers:{Range:'bytes=10-19'}}).then(async r=>[r.status,(await r.arrayBuffer()).byteLength])")
            ok(r == [206, 10], f"Range sur le fichier OCR non cassé {r}")
            await offline(True)
            r = await page.evaluate("fetch('ocr/fake-core.wasm').then(async r=>[r.status,(await r.arrayBuffer()).byteLength])")
            ok(r == [200, 600000], f"hors ligne : fichier OCR servi depuis la copie locale {r}")
            await offline(False)

            ok(not errs, "aucune erreur JavaScript" + ("" if not errs else " : " + errs[0][:200]))
            ok(not csp, "aucune violation CSP" + ("" if not csp else " : " + csp[0][:200]))
            await ctx.close()
    except Exception as e:   # p. ex. appli qui ne démarre plus : échec du test, pas plantage muet
        import traceback; ln = [f for f in traceback.extract_tb(e.__traceback__) if f.name == "main"][-1].lineno
        ok(False, f"test interrompu ligne {ln} : {type(e).__name__} {str(e)[:150]}")
    finally:
        srv.stop(); shutil.rmtree(tmp, ignore_errors=True); shutil.rmtree(profile, ignore_errors=True)
    print("\nMESURES (secondes depuis le début du rechargement) :")
    for k, t in T.items(): print(f"  {k:30s} {fmt(t)}")
    print("\nRÉSULTAT :", "ÉCHEC (" + str(len(FAILS)) + ")" if FAILS else "TOUT PASSE")
    return 1 if FAILS else 0


async def run(dist):
    try: return await asyncio.wait_for(main(dist), 360)   # jamais de test bloqué indéfiniment
    except asyncio.TimeoutError:
        ok(False, "test bloqué plus de 6 min"); print("\nRÉSULTAT : ÉCHEC (" + str(len(FAILS)) + ")"); return 1


if __name__ == "__main__":
    sys.exit(asyncio.run(run(sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "dist"))))

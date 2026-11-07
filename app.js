(() => {
  "use strict";
  const E = window.ESAME;
  const $ = (id) => document.getElementById(id);
  const CHIAVE = "esame-stato-" + E.versione;
  const SEB = /SEB[\/ ]/i.test(navigator.userAgent);
  const FS_OK = !!(document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen);

  let S = null;              // stato persistente
  let X = null;              // esame decifrato (sigla, durata, testo…)
  let timerId = null;
  let fuori = null;          // {inizio, motivo, dizionario}
  let ultimoDizionario = null; // {nome, t}
  let ultimaLunghezza = 0;
  let salvaId = null;

  // ---------- utilità ----------
  const ora = () => new Date().toLocaleTimeString("it-IT", { hour12: false });
  const mmss = (ms) => { const s = Math.max(0, Math.round(ms / 1000)); return String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0"); };
  const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  const parole = (t) => (t.trim().match(/\S+/g) || []).length;
  const norm = (s) => s.trim().toUpperCase();

  function salva() { try { localStorage.setItem(CHIAVE, JSON.stringify(S)); } catch (e) {} }
  function salvaPresto() {
    $("stato-salvataggio").textContent = "Salvataggio…"; $("stato-salvataggio").classList.add("attesa");
    clearTimeout(salvaId);
    salvaId = setTimeout(() => { salva(); $("stato-salvataggio").textContent = "Salvato " + ora().slice(0, 5); $("stato-salvataggio").classList.remove("attesa"); }, 600);
  }
  function log(tipo, dettaglio, grave) {
    if (!S) return;
    const t = Date.now();
    S.log.push({ t, ora: ora(), min: mmss(t - S.inizio), tipo, dettaglio: dettaglio || "", grave: !!grave });
    if (grave) S.contatori.gravi++;
    salva();
  }
  function avviso(msg) {
    const a = $("avviso"); a.textContent = msg; a.hidden = false;
    clearTimeout(avviso._t); avviso._t = setTimeout(() => (a.hidden = true), 6000);
  }

  // ---------- cifratura ----------
  async function decifra(codice) {
    for (const c of E.pacchetti) {
      try { return await decifraUno(c, codice); } catch (e) {}
    }
    throw new Error("codice");
  }
  async function decifraUno(c, codice) {
    const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(norm(codice)), "PBKDF2", false, ["deriveKey"]);
    const key = await crypto.subtle.deriveKey({ name: "PBKDF2", salt: b64(c.salt), iterations: c.iterazioni, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
    const out = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64(c.iv) }, key, b64(c.dati));
    return JSON.parse(new TextDecoder().decode(out));
  }

  // ---------- schermo intero ----------
  function inFS() { return !!(document.fullscreenElement || document.webkitFullscreenElement); }
  async function chiediFS() {
    if (SEB || !FS_OK) return;
    const el = document.documentElement;
    try { await (el.requestFullscreen ? el.requestFullscreen({ navigationUI: "hide" }) : el.webkitRequestFullscreen()); } catch (e) {}
  }

  // ---------- avvio ----------
  function prepara() {
    document.title = E.titolo;
    $("titolo").textContent = E.titolo;
    $("corso").textContent = "Esame scritto";
    $("docente").textContent = E.docente;
    const nav = $("dizionari");
    E.dizionari.forEach((d) => {
      const a = document.createElement("a");
      a.href = d.url; a.textContent = d.nome; a.target = "_blank"; a.rel = "noopener";
      a.addEventListener("click", () => { ultimoDizionario = { nome: d.nome, t: Date.now() }; log("Dizionario aperto", d.nome); });
      nav.appendChild(a);
    });

    let salvato = null;
    try { salvato = JSON.parse(localStorage.getItem(CHIAVE)); } catch (e) {}
    if (salvato && salvato.consegna) { S = salvato; mostraFine(); if (!S.consegna.inviato) invia(); return; }
    if (salvato && salvato.inizio) {
      S = salvato;
      $("nome").value = S.nome; $("matricola").value = S.matricola; $("codice").value = S.codice; $("accetto").checked = true;
      $("btn-inizia").textContent = "Riprendi la prova";
      $("errore-inizio").textContent = "È stata trovata una prova già iniziata su questo dispositivo: la ripresa verrà registrata.";
    }
    $("form-inizio").addEventListener("submit", inizia);
  }

  async function inizia(ev) {
    ev.preventDefault();
    const nome = $("nome").value.trim(), matricola = $("matricola").value.trim(), codice = $("codice").value.trim();
    const err = $("errore-inizio");
    if (!nome || !matricola || !codice) { err.textContent = "Compila nome, matricola e codice d'esame."; return; }
    if (!$("accetto").checked) { err.textContent = "Per iniziare devi accettare le regole."; return; }
    const btn = $("btn-inizia"); btn.disabled = true; btn.textContent = "Verifica del codice…";
    let testo;
    try { testo = X = await decifra(codice); }
    catch (e) { err.textContent = "Codice d'esame non valido."; btn.disabled = false; btn.textContent = S ? "Riprendi la prova" : "Inizia la prova"; return; }
    await chiediFS();
    const ripresa = !!(S && S.inizio);
    if (!ripresa) {
      S = { nome, matricola, codice: norm(codice), esame: X.sigla + " – " + X.titolo, inizio: Date.now(), testo: "", log: [],
            contatori: { uscite: 0, gravi: 0, msFuori: 0, consultazioni: 0, msDizionari: 0, digitati: 0, incolla: 0, inserimentiLunghi: 0, ricariche: 0 } };
      log("Inizio prova", X.sigla + " (" + X.durataMinuti + " min)");
    } else {
      S.contatori.ricariche++;
      log("Ripresa dopo ricaricamento o chiusura della pagina", "", true);
    }
    avviaProva(testo);
  }

  function ambiente() {
    const ua = navigator.userAgent;
    const so = /iPad|Macintosh.*Mobile|Macintosh/.test(ua) && navigator.maxTouchPoints > 1 ? "iPadOS" : /Windows/.test(ua) ? "Windows" : /Mac OS X/.test(ua) ? "macOS" : /Android/.test(ua) ? "Android" : /iPhone/.test(ua) ? "iPhone" : /Linux/.test(ua) ? "Linux" : "altro";
    return [ "SEB: " + (SEB ? "sì" : "no"), "Sistema: " + so, "Schermo: " + screen.width + "x" + screen.height, "Touch: " + (navigator.maxTouchPoints > 0 ? "sì" : "no"), "UA: " + ua ].join(" | ");
  }

  function avviaProva(t) {
    $("schermo-inizio").hidden = true; $("schermo-prova").hidden = false;
    $("studente").textContent = S.nome + " · " + S.matricola;
    $("sigla").textContent = t.sigla + (t.nomeEsame ? " · " + t.nomeEsame : "");
    document.title = t.sigla + " – " + t.titolo;
    $("consegna").textContent = t.consegna;
    $("titolo-testo").textContent = t.titoloTesto;
    const box = $("testo"); box.innerHTML = "";
    t.testo.forEach((p) => {
      const tit = p.startsWith("##"), el = document.createElement(tit ? "h3" : "p");
      el.textContent = tit ? p.slice(2).trim() : p; box.appendChild(el);
    });
    $("fonte").textContent = t.fonte || "";
    const campo = $("campo"); campo.value = S.testo; ultimaLunghezza = campo.value.length;
    aggiornaContatori();
    collegaEventi();
    tick(); timerId = setInterval(tick, 1000);
    if (!SEB && FS_OK && !inFS()) mostraVelo("Per continuare la prova serve lo schermo intero.");
    if (!SEB && !FS_OK) log("Schermo intero non disponibile su questo dispositivo", "Controllo solo tramite registro uscite");
    campo.focus();
  }

  function tick() {
    const resta = S.inizio + X.durataMinuti * 60000 - Date.now();
    const el = $("timer"); el.textContent = mmss(resta);
    el.classList.toggle("poco", resta < 5 * 60000);
    if (resta <= 0) { clearInterval(timerId); log("Tempo scaduto", "Consegna automatica"); consegna(true); }
  }

  function aggiornaContatori() {
    $("parole").textContent = parole($("campo").value);
    $("uscite").textContent = S.contatori.uscite;
  }

  // ---------- controlli ----------
  let eventiCollegati = false;
  function collegaEventi() {
    if (eventiCollegati) return; eventiCollegati = true;
    const campo = $("campo");

    campo.addEventListener("beforeinput", (e) => {
      const tipo = e.inputType || "";
      if (tipo === "insertFromPaste" || tipo === "insertFromDrop" || tipo === "insertFromPasteAsQuotation") {
        e.preventDefault(); S.contatori.incolla++; log("Tentativo di incollare (bloccato)", "", true); avviso("Incollare non è consentito. Il tentativo è stato registrato."); return;
      }
      if (tipo === "insertReplacementText") { log("Sostituzione automatica del testo (correttore)", (e.data || "").slice(0, 60)); }
      if (tipo === "insertText" || tipo === "insertCompositionText") S.contatori.digitati += (e.data || "").length || 1;
    });
    campo.addEventListener("input", () => {
      const delta = campo.value.length - ultimaLunghezza;
      if (delta > 40) { S.contatori.inserimentiLunghi++; log("Inserimento di molti caratteri in un colpo solo", delta + " caratteri: «" + campo.value.slice(campo.selectionStart - Math.min(delta, 80), campo.selectionStart) + "»", true); }
      ultimaLunghezza = campo.value.length;
      S.testo = campo.value; aggiornaContatori(); salvaPresto();
    });
    ["paste", "drop"].forEach((n) => document.addEventListener(n, (e) => {
      e.preventDefault(); S.contatori.incolla++;
      log("Tentativo di " + (n === "paste" ? "incollare" : "trascinare testo") + " (bloccato)", "", true);
      avviso("Incollare non è consentito. Il tentativo è stato registrato.");
    }, true));
    ["copy", "cut"].forEach((n) => document.addEventListener(n, (e) => { e.preventDefault(); log("Tentativo di " + (n === "copy" ? "copiare" : "tagliare") + " (bloccato)", "", true); avviso("Copiare non è consentito. Il tentativo è stato registrato."); }, true));
    document.addEventListener("contextmenu", (e) => e.preventDefault());
    document.addEventListener("dragstart", (e) => e.preventDefault());
    document.addEventListener("selectstart", (e) => { if (!campo.contains(e.target)) e.preventDefault(); });

    document.addEventListener("keydown", (e) => {
      const k = (e.key || "").toLowerCase(), mod = e.ctrlKey || e.metaKey;
      if (mod && ["v", "c", "x"].includes(k)) { /* gestiti da paste/copy */ return; }
      if ((mod && ["p", "s", "u", "f", "g", "o", "n", "t"].includes(k)) || k === "f12" || (mod && e.shiftKey && ["i", "j", "c"].includes(k))) {
        e.preventDefault(); log("Scorciatoia bloccata", (e.metaKey ? "Cmd+" : "Ctrl+") + (e.shiftKey ? "Maiusc+" : "") + e.key, true);
      }
      if (k === "printscreen") log("Tasto Stamp premuto", "", true);
    }, true);

    // uscite
    const esce = (motivo) => {
      if (fuori || S.consegna) return;
      const diz = ultimoDizionario && Date.now() - ultimoDizionario.t < 4000 ? ultimoDizionario.nome : null;
      fuori = { inizio: Date.now(), motivo, dizionario: diz };
      if (!diz) { S.contatori.uscite++; aggiornaContatori(); }
      salva();
    };
    const rientra = () => {
      if (!fuori || S.consegna) return;
      const durata = Date.now() - fuori.inizio;
      if (fuori.dizionario) { S.contatori.consultazioni++; S.contatori.msDizionari += durata; const lunga = durata > 120000; log(lunga ? "Consultazione lunga (oltre 2 minuti), da verificare" : "Consultazione autorizzata", fuori.dizionario + " per " + mmss(durata), lunga); }
      else { S.contatori.msFuori += durata; log("USCITA NON AUTORIZZATA", fuori.motivo + ", fuori per " + mmss(durata), true); avviso("Sei uscito dalla prova per " + mmss(durata) + ". L'uscita è stata registrata."); }
      fuori = null; ultimoDizionario = null;
    };
    document.addEventListener("visibilitychange", () => (document.hidden ? esce("pagina nascosta (altra scheda/app o riduzione a icona)") : rientra()));
    window.addEventListener("blur", () => setTimeout(() => { if (!document.hasFocus()) esce("finestra non attiva (altra app o finestra)"); }, 150));
    window.addEventListener("focus", rientra);
    window.addEventListener("pagehide", () => { esce("pagina chiusa o ricaricata"); salva(); });

    const fsCambio = () => {
      if (S.consegna || SEB) return;
      if (!inFS()) {
        const diz = ultimoDizionario && Date.now() - ultimoDizionario.t < 4000;
        log("Uscita dallo schermo intero", diz ? "per consultare un dizionario" : "", !diz);
        mostraVelo(diz ? "Hai consultato un dizionario. Torna alla prova per continuare." : "Sei uscito dallo schermo intero. L'uscita è stata registrata.");
      } else $("velo").hidden = true;
    };
    document.addEventListener("fullscreenchange", fsCambio);
    document.addEventListener("webkitfullscreenchange", fsCambio);
    $("btn-rientra").addEventListener("click", async () => { await chiediFS(); $("velo").hidden = true; campo.focus(); });

    window.addEventListener("beforeunload", (e) => { if (!S.consegna) { e.preventDefault(); e.returnValue = ""; } });

    $("btn-consegna").addEventListener("click", () => { $("conferma").hidden = false; });
    $("btn-annulla").addEventListener("click", () => { $("conferma").hidden = true; campo.focus(); });
    $("btn-conferma").addEventListener("click", () => { $("conferma").hidden = true; consegna(false); });
  }

  function mostraVelo(msg) { $("velo-testo").textContent = msg; $("velo").hidden = false; }

  // ---------- consegna ----------
  async function hash(s) {
    const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
    return Array.from(new Uint8Array(h)).slice(0, 4).map((b) => b.toString(16).padStart(2, "0")).join("").toUpperCase();
  }

  async function consegna(automatica) {
    if (S.consegna) return;
    clearInterval(timerId);
    S.testo = $("campo").value;
    log(automatica ? "Consegna automatica (tempo scaduto)" : "Consegna da parte dello studente", parole(S.testo) + " parole");
    const fine = Date.now();
    const ricevuta = (await hash(S.matricola + "|" + S.testo + "|" + fine)).replace(/(.{4})/, "$1-");
    S.consegna = { fine, ricevuta, automatica, inviato: false, tentativi: 0 };
    salva();
    if (document.exitFullscreen && inFS()) document.exitFullscreen().catch(() => {});
    mostraFine(); invia();
  }

  function riepilogo() {
    const c = S.contatori, gravi = S.log.filter((x) => x.grave);
    const rapporto = S.testo.length ? Math.round((c.digitati / S.testo.length) * 100) : 100;
    return [
      "Ricevuta: " + S.consegna.ricevuta,
      "Esito controlli: " + (gravi.length ? "DA VERIFICARE (" + gravi.length + " eventi segnalati)" : "nessuna anomalia"),
      "Uscite non autorizzate: " + c.uscite + " (tempo fuori " + mmss(c.msFuori) + ")",
      "Consultazioni dizionari: " + c.consultazioni + " (tempo " + mmss(c.msDizionari) + ")",
      "Tentativi di incollare: " + c.incolla,
      "Inserimenti lunghi in un colpo: " + c.inserimentiLunghi,
      "Ripresa dopo ricaricamento: " + c.ricariche,
      "Caratteri digitati / caratteri nel testo: " + c.digitati + " / " + S.testo.length + " (" + rapporto + "%)",
      "Durata: " + mmss(S.consegna.fine - S.inizio) + (S.consegna.automatica ? " (consegna automatica)" : ""),
      "Parole: " + parole(S.testo),
    ].join("\n");
  }
  function registro() {
    let r = S.log.map((x) => (x.grave ? "[!] " : "    ") + x.ora + " (min " + x.min + ") " + x.tipo + (x.dettaglio ? " – " + x.dettaglio : "")).join("\n");
    if (r.length > 40000) r = r.slice(0, 40000) + "\n… registro troncato";
    return r;
  }

  async function invia() {
    $("btn-riprova").hidden = true;
    $("fine-titolo").textContent = "Consegna in corso…";
    $("fine-testo").textContent = "Non chiudere questa pagina.";
    const f = E.form, p = new URLSearchParams();
    p.append(f.nome, S.nome); p.append(f.matricola, S.matricola); p.append(f.codiceEsame, S.esame + " · codice " + S.codice);
    p.append(f.traduzione, S.testo || "(consegna vuota)"); p.append(f.registro, registro()); p.append(f.riepilogo, riepilogo());
    p.append(f.ambiente, ambiente());
    S.consegna.tentativi++; salva();
    try {
      await fetch(f.action, { method: "POST", mode: "no-cors", body: p });
      S.consegna.inviato = true; salva();
      $("fine-titolo").textContent = "Traduzione consegnata";
      $("fine-testo").textContent = "La consegna è arrivata alla docente. Conserva il codice di ricevuta qui sotto.";
      $("btn-esci").hidden = false;
    } catch (e) {
      $("fine-titolo").textContent = "Invio non riuscito";
      $("fine-testo").textContent = "Controlla la connessione e premi «Riprova l'invio». La traduzione è salvata su questo dispositivo: non chiudere la pagina e avvisa la docente.";
      $("btn-riprova").hidden = false;
      setTimeout(() => { if (!S.consegna.inviato) invia(); }, 15000);
    }
  }

  function mostraFine() {
    $("schermo-inizio").hidden = true; $("schermo-prova").hidden = true; $("velo").hidden = true; $("conferma").hidden = true;
    $("schermo-fine").hidden = false;
    $("ricevuta").hidden = false; $("ricevuta").textContent = "Ricevuta " + S.consegna.ricevuta;
    $("btn-scarica").hidden = false;
  }

  $("btn-scarica").addEventListener("click", () => {
    const testo = S.esame + "\n" + S.nome + " – " + S.matricola + "\n\n" + S.testo + "\n\n---\n" + riepilogo();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([testo], { type: "text/plain;charset=utf-8" }));
    a.download = "traduzione_" + S.matricola.replace(/\W+/g, "") + ".txt"; a.click();
  });
  $("btn-riprova").addEventListener("click", invia);

  if (/[?&]reset\b/.test(location.search)) { localStorage.removeItem(CHIAVE); history.replaceState(null, "", location.pathname); }
  prepara();
})();

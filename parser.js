/* =====================================================================
   Ekantik trade parser — parser.js
   ---------------------------------------------------------------------
   Converts a Discord chat export (the #imo-futures-trades HTML, or raw
   pasted text) into structured trade records, and computes edge stats.

   Pure, dependency-free. Exposed as window.EkantikParser and as a
   CommonJS module (for node-based tests).

   Message grammar (best-effort, human-logged):
     ENTRY   F1: s 6940 (half)      s/sell = short, b/buy = long, + price
     STOP    F1: sl6952             sl / stop / stp + price
     TARGET  F1: tp6901             tp + price
     RESULT  F1: +8  /  -7  /  25 points (12.5)  /  wash
     NOTRADE F14: no trade          excluded from counts
   Labels:  F# = pre-launch operator history; S# = live public sample.
   ===================================================================== */
(function (root) {
  "use strict";

  var MONTHS = { Jan:1,Feb:2,Mar:3,Apr:4,May:5,Jun:6,Jul:7,Aug:8,Sep:9,Oct:10,Nov:11,Dec:12 };

  var RE = {
    li:    /<li[^>]*>[\s\S]*?<\/li>/g,
    time:  /class="time">([^<]+)<\/span>/,
    pTag:  /<p[^>]*>([\s\S]*?)<\/p>/g,
    tag:   /<[^>]+>/g,
    ts:    /\w+\s+(\w+)\s+(\d+)\s+(\d+)\s+(\d+):(\d+):(\d+)/,
    label: /^([FfSs])\s*0*(\d+)\s*:?/,
    size:  /(\d+\s*m?es)|(\bH\d\b)|(\bh\d\b)|(half)/i,
    price: /(\d{4}(?:\.\d+)?)/,
    sl:    /\b(?:sl|stp|stop)\s*(\d{3,5}(?:\.\d+)?)/i,
    tp:    /\btp\s*(\d{3,5}(?:\.\d+)?)/i,
    entry: /^(sell|buy|s|b)\b/i,
    result:/^\s*([+-]?\s*\d+(?:\.\d+)?)/
  };

  function decode(s) {
    return s.replace(/&amp;/g,"&").replace(/&lt;/g,"<").replace(/&gt;/g,">")
            .replace(/&#39;/g,"'").replace(/&quot;/g,'"').replace(/&nbsp;/g," ");
  }

  function parseTs(ts) {
    var m = RE.ts.exec(ts);
    if (!m) return { date: null, time: null };
    var mo = MONTHS[m[1]], d = parseInt(m[2],10), y = m[3];
    var date = y + "-" + pad(mo) + "-" + pad(d);
    return { date: date, time: date + "T" + m[4] + ":" + m[5] + ":" + m[6] };
  }
  function pad(n){ return (n<10?"0":"")+n; }

  /* Extract [{ts, line}] messages from a Discord HTML export. */
  function extractFromHTML(html) {
    var msgs = [], li;
    RE.li.lastIndex = 0;
    while ((li = RE.li.exec(html))) {
      var block = li[0];
      var tm = RE.time.exec(block);
      var ts = tm ? tm[1] : "";
      var ps = [], pm;
      RE.pTag.lastIndex = 0;
      while ((pm = RE.pTag.exec(block))) ps.push(pm[1]);
      if (!ps.length) continue;
      var content = decode(ps[ps.length-1].replace(RE.tag,"")).trim();
      content.split("\n").forEach(function (ln) {
        ln = ln.trim();
        if (ln) msgs.push({ ts: ts, line: ln });
      });
    }
    return msgs;
  }

  /* Plain-text fallback: "timestamp | message" per line, or bare messages. */
  function extractFromText(text) {
    return text.split("\n").map(function (ln) { return ln.trim(); })
      .filter(Boolean)
      .map(function (ln) {
        var parts = ln.split("|");
        if (parts.length >= 2 && RE.ts.test(parts[0])) {
          return { ts: parts[0].trim(), line: parts.slice(1).join("|").trim() };
        }
        return { ts: "", line: ln };
      });
  }

  function classify(rest) {
    var r = rest.trim(), low = r.toLowerCase();
    if (low.indexOf("no trade") !== -1) return { kind: "notrade" };
    if (low.indexOf("wash") !== -1)     return { kind: "result", value: 0 };
    var dirm = RE.entry.exec(low);
    var pm = RE.price.exec(r);
    if (dirm && pm) {
      var dir = (dirm[1] === "s" || dirm[1] === "sell") ? "short" : "long";
      return { kind: "entry", direction: dir, price: parseFloat(pm[1]) };
    }
    var rm = RE.result.exec(r);
    if (rm) {
      var val = parseFloat(rm[1].replace(/\s/g,""));
      if (Math.abs(val) < 200) return { kind: "result", value: val };
    }
    return { kind: "other" };
  }

  /* Main: returns array of trade records (incl. no-trade/unresolved, flagged). */
  function parseMessages(msgs) {
    var trades = [], openByLabel = {}, order = 0;
    msgs.forEach(function (m) {
      var t = parseTs(m.ts);
      var lm = RE.label.exec(m.line);
      if (!lm) return; // unlabeled (Exit/exit) — informational only
      var label = lm[1].toUpperCase() + lm[2];
      var rest = m.line.slice(lm[0].length).trim();
      var c = classify(rest);
      var sm = RE.size.exec(rest); var size = sm ? sm[0].trim() : null;
      var slm = RE.sl.exec(rest); var tpm = RE.tp.exec(rest);
      var cur = openByLabel[label];

      if (c.kind === "entry") {
        if (cur && cur.points == null && cur.status !== "no-trade") {
          (cur.adds = cur.adds || []).push(c.price); // scale-in
        } else {
          order++;
          cur = { id: label, seq: order,
                  series: label[0] === "S" ? "live" : "historical",
                  direction: c.direction, entry: c.price, stop: null, target: null,
                  points: null, size: size, date: t.date, time: t.time,
                  status: null, review: false, raw: [] };
          openByLabel[label] = cur; trades.push(cur);
        }
        if (slm) cur.stop = parseFloat(slm[1]);
        if (tpm) cur.target = parseFloat(tpm[1]);
        if (size && !cur.size) cur.size = size;
        cur.raw.push(m.line);
      } else if (c.kind === "result" || c.kind === "notrade") {
        if (!cur) {
          order++;
          cur = { id: label, seq: order,
                  series: label[0] === "S" ? "live" : "historical",
                  direction: null, entry: null, stop: null, target: null,
                  points: null, size: size, date: t.date, time: t.time,
                  status: null, review: true, raw: [] };
          openByLabel[label] = cur; trades.push(cur);
        }
        if (c.kind === "notrade") {
          cur.status = "no-trade"; cur.points = null; cur.review = true;
        } else {
          cur.points = c.value;
          // Size (half / 5mes / 2es …) is captured explicitly in cur.size and is
          // NOT treated as ambiguous — the logged points stand as recorded.
        }
        cur.raw.push(m.line);
        openByLabel[label] = null;
      } else {
        if (cur) {
          if (slm) cur.stop = parseFloat(slm[1]);
          if (tpm) cur.target = parseFloat(tpm[1]);
          cur.raw.push(m.line);
        }
      }
    });

    trades.forEach(function (t) {
      if (t.status === "no-trade") { t.raw = t.raw.join(" | "); return; }
      if (t.points == null) { t.status = "unresolved"; t.review = true; }
      else if (t.points > 0) t.status = "win";
      else if (t.points < 0) t.status = "loss";
      else t.status = "scratch";
      t.raw = t.raw.join(" | ");
    });
    return trades;
  }

  function parse(input) {
    var msgs = /<li[\s>]/.test(input) ? extractFromHTML(input) : extractFromText(input);
    return parseMessages(msgs);
  }

  /* Edge statistics over countable trades (excludes no-trade & unresolved).
     opts:
       series       legacy filter ("historical"|"live") — kept for compat
       window       "7d"|"30d"|"90d"|"mtd"|"ytd"|"all"   (date filter)
       asOf         ISO date the window is measured back from (default: today
                    or the latest trade date, whichever is later)
       pointValue   $ per index point (default 50 = one ES contract)
       workingUnit  $ account/working unit for drawdown % (default 5000)
       maxRiskPts   ignore stop distances larger than this as typos (default 50)
  */
  function computeStats(trades, opts) {
    opts = opts || {};
    var pv = opts.pointValue != null ? opts.pointValue : 50;
    var wu = opts.workingUnit != null ? opts.workingUnit : 5000;
    var maxRiskPts = opts.maxRiskPts != null ? opts.maxRiskPts : 50;

    var countable = trades.filter(function (t) {
      if (opts.series && t.series !== opts.series) return false;
      return t.status === "win" || t.status === "loss" || t.status === "scratch";
    });
    var list = filterWindow(countable, opts.window, opts.asOf);

    var wins = list.filter(function (t){ return t.status === "win"; });
    var losses = list.filter(function (t){ return t.status === "loss"; });
    var scratch = list.filter(function (t){ return t.status === "scratch"; });
    var wl = wins.length + losses.length;                 // win/loss count (excl. scratch)
    var gp = sum(wins.map(function(t){return t.points;}));
    var gl = sum(losses.map(function(t){return -t.points;}));
    var net = sum(list.map(function(t){return t.points;}));

    var ordered = list.slice().sort(function(a,b){ return a.seq - b.seq; });

    // Size-aware per-trade dollar P&L. ES = pv/pt × contracts; MES = (pv/10)/pt
    // × micros; half = pv/2; untagged or unrecognised tag = 1 ES (pv).
    function d$(t){ return t.points * dollarPerPoint(t.size, pv); }

    var equity = [], runPts = 0, run$ = 0;
    ordered.forEach(function (t) {
      runPts += t.points; run$ += d$(t);
      equity.push({ id: t.id, date: t.date, series: t.series, points: t.points,
                    cum: round(runPts), pnl$: round(d$(t)), cum$: round(run$) });
    });

    var gp$ = sum(wins.map(d$));
    var gl$ = sum(losses.map(function(t){return -d$(t);}));
    var net$ = sum(list.map(d$));

    var best = list.length ? Math.max.apply(null, list.map(function(t){return t.points;})) : 0;
    var worst = list.length ? Math.min.apply(null, list.map(function(t){return t.points;})) : 0;
    var best$ = list.length ? Math.max.apply(null, list.map(d$)) : 0;
    var worst$ = list.length ? Math.min.apply(null, list.map(d$)) : 0;
    // durability: remove the three biggest dollar winners
    var top3 = list.slice().sort(function(a,b){ return d$(b) - d$(a); }).slice(0,3);
    var top3$ = sum(top3.map(d$));
    var top3pts = sum(top3.map(function(t){return t.points;}));

    // R model: per-trade risk = |entry - stop| in points (guard against typos).
    // R-expectancy is size-neutral (points/riskPts); avg risk $ is size-aware.
    var riskList = [], risk$List = [], rMults = [];
    ordered.forEach(function (t) {
      if (t.entry != null && t.stop != null) {
        var rp = Math.abs(t.entry - t.stop);
        if (rp > 0 && rp <= maxRiskPts) {
          riskList.push(rp);
          risk$List.push(rp * dollarPerPoint(t.size, pv));
          if (t.status === "win" || t.status === "loss") rMults.push(t.points / rp);
        }
      }
    });
    var avgRiskPts = riskList.length ? mean(riskList) : null;
    var avgRisk$ = risk$List.length ? mean(risk$List) : null;
    var rExpectancy = rMults.length ? mean(rMults) : null;

    // Annualised R + monthly trade rate from the realised rate over the window's span.
    var span = spanDays(ordered);
    var annualTrades = (span > 0) ? wl * 365 / span : null;
    var annualR = (rExpectancy != null && annualTrades != null) ? rExpectancy * annualTrades : null;
    var tradesPerMonth = (span > 0) ? wl * 30.4375 / span : null;

    var ddPts = maxDD(equity, "cum");
    var dd$ = maxDD(equity, "cum$");

    return {
      // counts
      count: wl + scratch.length,        // total countable
      tradeCount: wl,                    // win+loss (matches "N trades" headline)
      wins: wins.length, losses: losses.length, scratch: scratch.length,
      historical: list.filter(function(t){return t.series==="historical";}).length,
      live: list.filter(function(t){return t.series==="live";}).length,
      winRate: wl ? wins.length / wl : 0,
      // dollars (size-aware) — the primary economic view
      pointValue: pv, workingUnit: wu,
      profitFactor: gl$ ? round(gp$ / gl$) : null,
      net$: round(net$),
      ev$: wl ? round(net$ / wl) : 0,
      grossProfit$: round(gp$), grossLoss$: round(gl$),
      avgWin$: wins.length ? round(gp$ / wins.length) : 0,
      avgLoss$: losses.length ? round(gl$ / losses.length) : 0,
      best$: round(best$), worst$: round(worst$),
      maxDrawdown$: round(dd$),
      maxDrawdownPct: wu ? round(dd$ / wu * 1000) / 10 : null,   // % of working unit
      avgRisk$: avgRisk$ != null ? round(avgRisk$) : null,
      // points (reference / size-neutral)
      grossProfit: round(gp), grossLoss: round(gl), net: round(net),
      expectancy: wl ? round(net / wl) : 0,             // points per trade
      avgWin: wins.length ? round(gp / wins.length) : 0,
      avgLoss: losses.length ? round(gl / losses.length) : 0,
      best: round(best), worst: round(worst),
      maxDrawdown: round(ddPts),
      // R-multiples (size-neutral)
      avgRiskPts: avgRiskPts != null ? round(avgRiskPts) : null,
      rExpectancy: rExpectancy != null ? round(rExpectancy) : null,
      annualR: annualR != null ? Math.round(annualR) : null,
      annualTrades: annualTrades != null ? Math.round(annualTrades) : null,
      tradesPerMonth: tradesPerMonth != null ? round(tradesPerMonth) : null,
      months: span > 0 ? round(span / 30.4375) : null,
      // behaviour
      maxLossStreak: maxStreak(ordered, "loss"),
      recovery: recoveryTrades(equity, "cum$"),
      spanDays: span,
      // series / equity / durability
      equity: equity,
      durability: {
        removedTop3: top3.map(function(t){ return { id: t.id, points: t.points, usd: round(d$(t)) }; }),
        netExTop3$: round(net$ - top3$),
        pfExTop3: gl$ ? round((gp$ - top3$) / gl$) : null,
        netExTop3: round(net - top3pts)
      }
    };
  }

  /* Dollar value of one point for a trade's size tag.
       ES (default / "2es")   -> basePV per point × contracts
       MES ("5mes","2mes"…)   -> (basePV/10) per point × micros
       half                   -> basePV/2
       unrecognised / none    -> basePV (one ES) */
  function dollarPerPoint(size, basePV) {
    if (!size) return basePV;
    var s = String(size).toLowerCase(), m;
    if ((m = s.match(/(\d+(?:\.\d+)?)\s*mes/))) return parseFloat(m[1]) * (basePV / 10);
    if (s.indexOf("half") !== -1) return basePV / 2;
    if ((m = s.match(/(\d+(?:\.\d+)?)\s*es/))) return parseFloat(m[1]) * basePV;
    return basePV;
  }

  /* Filter a countable list by a trailing/anchored window. */
  function filterWindow(list, window, asOf) {
    if (!window || window === "all") return list;
    var dates = list.filter(function(t){return t.date;}).map(function(t){return t.date;}).sort();
    var anchor = asOf ? new Date(asOf + "T00:00:00") : new Date();
    if (dates.length) {
      var last = new Date(dates[dates.length-1] + "T00:00:00");
      if (last > anchor) anchor = last;
    }
    var from;
    if (window === "mtd") from = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    else if (window === "ytd") from = new Date(anchor.getFullYear(), 0, 1);
    else {
      var days = parseInt(window, 10);
      if (isNaN(days)) return list;
      from = new Date(anchor.getTime() - days * 86400000);
    }
    return list.filter(function (t) {
      if (!t.date) return false;
      return new Date(t.date + "T00:00:00") >= from;
    });
  }

  function spanDays(ordered){
    var dated = ordered.filter(function(t){return t.date;});
    if (dated.length < 2) return dated.length ? 1 : 0;
    var a = new Date(dated[0].date + "T00:00:00"), b = new Date(dated[dated.length-1].date + "T00:00:00");
    return Math.max(1, Math.round((b - a) / 86400000));
  }
  function maxStreak(ordered, status){ var m=0,c=0; ordered.forEach(function(t){ if(t.status===status){c++; if(c>m)m=c;} else c=0; }); return m; }
  function recoveryTrades(equity, key){
    key = key || "cum";
    // trades from the max-drawdown trough until equity first regains the prior peak
    var peak=-Infinity, peakIdx=0, troughIdx=0, dd=0, foundPeak=0;
    for (var i=0;i<equity.length;i++){ if(equity[i][key]>peak){peak=equity[i][key];foundPeak=i;} var d=peak-equity[i][key]; if(d>dd){dd=d;troughIdx=i;peakIdx=foundPeak;} }
    if (dd<=0) return 0;
    var target = equity[peakIdx][key];
    for (var j=troughIdx+1;j<equity.length;j++){ if(equity[j][key]>=target) return j-troughIdx; }
    return null; // not yet recovered
  }
  function maxDD(equity, key){ key = key || "cum"; var peak=-Infinity,dd=0; equity.forEach(function(p){ if(p[key]>peak)peak=p[key]; var d=peak-p[key]; if(d>dd)dd=d; }); return dd; }
  function sum(a){ return a.reduce(function(s,x){return s+x;},0); }
  function mean(a){ return a.length ? sum(a)/a.length : 0; }
  function round(x){ return Math.round(x*100)/100; }

  var api = { parse: parse, parseMessages: parseMessages, extractFromHTML: extractFromHTML,
              extractFromText: extractFromText, computeStats: computeStats, filterWindow: filterWindow };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.EkantikParser = api;
})(typeof window !== "undefined" ? window : this);

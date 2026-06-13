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
    // IMPORTANT: R-multiples are only defined for trades with a usable logged
    // stop, so the R-model runs on a SUBSAMPLE of the win/loss record. We track
    // winners and losers in R separately, plus the subsample's own win rate, so
    // the figure is internally auditable (expectancy = pR·avgWinR + (1−pR)·avgLossR)
    // and never silently conflated with the full-record win rate.
    var costPerContract = opts.costPerContract != null ? opts.costPerContract : null; // round-trip $ per ES-equivalent
    var riskList = [], risk$List = [], rMults = [], rWinMults = [], rLossMults = [], rCostMults = [];
    var cost$List = [];   // modeled cost per win/loss trade, size-aware (for net EV$)
    ordered.forEach(function (t) {
      var isWL = (t.status === "win" || t.status === "loss");
      var dpp = dollarPerPoint(t.size, pv);
      if (isWL && costPerContract != null) cost$List.push(costPerContract * (dpp / pv));
      if (t.entry != null && t.stop != null) {
        var rp = Math.abs(t.entry - t.stop);
        if (rp > 0 && rp <= maxRiskPts) {
          riskList.push(rp);
          risk$List.push(rp * dpp);
          if (isWL) {
            var rm = t.points / rp;
            rMults.push(rm);
            if (t.status === "win") rWinMults.push(rm); else rLossMults.push(rm);
            // cost in R is size-independent: costPerContract*(dpp/pv) / (rp*dpp) = costPerContract/(pv*rp)
            if (costPerContract != null) rCostMults.push(costPerContract / (pv * rp));
          }
        }
      }
    });
    var avgRiskPts = riskList.length ? mean(riskList) : null;
    var avgRisk$ = risk$List.length ? mean(risk$List) : null;
    var rExpectancy = rMults.length ? mean(rMults) : null;
    var rSampleN = rMults.length;                                  // win/loss trades with a usable stop
    var rWins = rWinMults.length, rLosses = rLossMults.length;
    var rWinRate = rSampleN ? rWins / rSampleN : null;             // win rate WITHIN the R subsample
    var avgWinR = rWins ? mean(rWinMults) : null;                  // > 0
    var avgLossR = rLosses ? mean(rLossMults) : null;              // < 0 (loss points are negative)
    var payoffR = (avgWinR != null && avgLossR != null && avgLossR !== 0)
      ? avgWinR / Math.abs(avgLossR) : null;
    var rUncovered = wl - rSampleN;                                // win/loss trades with no usable stop
    // Net-of-cost views (only when a cost assumption is supplied)
    var avgCostR = rCostMults.length ? mean(rCostMults) : null;
    var rExpectancyNet = (rExpectancy != null && avgCostR != null) ? rExpectancy - avgCostR : null;
    var avgCost$ = cost$List.length ? mean(cost$List) : null;

    // Annualised R + monthly trade rate from the realised rate over the window's span.
    var span = spanDays(ordered);
    var annualTrades = (span > 0) ? wl * 365 / span : null;
    var annualR = (rExpectancy != null && annualTrades != null) ? rExpectancy * annualTrades : null;
    var tradesPerMonth = (span > 0) ? wl * 30.4375 / span : null;

    var ddPts = maxDD(equity, "cum");
    var dd$ = maxDD(equity, "cum$");
    // Full drawdown profile (size-aware $): depth, the run down to the trough,
    // trades to recover, total underwater span, and the longest time the curve
    // spent below a prior high anywhere in the record. Duration matters for
    // sizing as much as depth — a shallow-but-long drawdown still tests nerve.
    var ddProf = drawdownProfile(equity, "cum$");
    var longestUW = longestUnderwater(equity, "cum$");
    // Expected longest losing run for this sample size & loss rate — a sanity
    // check on the observed streak (Schilling's approximation).
    var lossRate = wl ? losses.length / wl : 0;
    var expMaxLossStreak = (wl > 0 && lossRate > 0 && lossRate < 1)
      ? Math.round(Math.log(wl * (1 - lossRate)) / Math.log(1 / lossRate)) : null;

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
      maxDDToTrough: ddProf.toTrough,        // trades from prior peak down to the trough
      maxDDRecover: ddProf.toRecover,        // trades from trough back to the prior peak (null = not yet)
      maxDDDuration: ddProf.duration,        // total trades underwater for the deepest drawdown
      longestUnderwater: longestUW,          // longest stretch below any prior high, in trades
      avgRisk$: avgRisk$ != null ? round(avgRisk$) : null,
      avgCost$: avgCost$ != null ? round(avgCost$) : null,
      evNet$: (avgCost$ != null && wl) ? round(net$ / wl - avgCost$) : null,
      // points (reference / size-neutral)
      grossProfit: round(gp), grossLoss: round(gl), net: round(net),
      expectancy: wl ? round(net / wl) : 0,             // points per trade
      avgWin: wins.length ? round(gp / wins.length) : 0,
      avgLoss: losses.length ? round(gl / losses.length) : 0,
      best: round(best), worst: round(worst),
      maxDrawdown: round(ddPts),
      // R-multiples (size-neutral) — computed ONLY over win/loss trades that
      // carry a usable logged stop; the subsample (rSampleN) and its own win
      // rate (rWinRate) are exposed so the figure can't be read against the
      // full-record win rate. rExpectancy is GROSS; rExpectancyNet subtracts a
      // supplied round-trip cost assumption (null when none is configured).
      avgRiskPts: avgRiskPts != null ? round(avgRiskPts) : null,
      rExpectancy: rExpectancy != null ? round(rExpectancy) : null,
      rExpectancyNet: rExpectancyNet != null ? round(rExpectancyNet) : null,
      avgWinR: avgWinR != null ? round(avgWinR) : null,
      avgLossR: avgLossR != null ? round(avgLossR) : null,
      payoffR: payoffR != null ? round(payoffR) : null,
      rSampleN: rSampleN, rWins: rWins, rLosses: rLosses,
      rWinRate: rWinRate != null ? round(rWinRate) : null,
      rUncovered: rUncovered,
      avgCostR: avgCostR != null ? round(avgCostR) : null,
      costPerContract: costPerContract,
      annualR: annualR != null ? Math.round(annualR) : null,
      annualTrades: annualTrades != null ? Math.round(annualTrades) : null,
      tradesPerMonth: tradesPerMonth != null ? round(tradesPerMonth) : null,
      months: span > 0 ? round(span / 30.4375) : null,
      // behaviour
      maxLossStreak: maxStreak(ordered, "loss"),
      expMaxLossStreak: expMaxLossStreak,
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

  /* Per-calendar-month breakdown (size-aware $). Returns rows oldest→newest:
     { month:"YYYY-MM", trades, wins, losses, winRate, net$, ev$, best$, worst$ }
     trades = wins+losses (scratch excluded from the count; its $0 doesn't move net). */
  function monthlyBreakdown(trades, opts) {
    opts = opts || {};
    var pv = opts.pointValue != null ? opts.pointValue : 50;
    var by = {};
    trades.forEach(function (t) {
      if (t.status !== "win" && t.status !== "loss" && t.status !== "scratch") return;
      var mo = (t.date || "").slice(0, 7); if (!mo) return;
      if (!by[mo]) by[mo] = { month: mo, wins: 0, losses: 0, net: 0, best: -Infinity, worst: Infinity };
      var pnl = t.points * dollarPerPoint(t.size, pv);
      by[mo].net += pnl;
      if (pnl > by[mo].best) by[mo].best = pnl;
      if (pnl < by[mo].worst) by[mo].worst = pnl;
      if (t.status === "win") by[mo].wins++; else if (t.status === "loss") by[mo].losses++;
    });
    return Object.keys(by).sort().map(function (mo) {
      var o = by[mo], wl = o.wins + o.losses;
      return {
        month: mo, trades: wl, wins: o.wins, losses: o.losses,
        winRate: wl ? o.wins / wl : 0,
        "net$": round(o.net), "ev$": wl ? round(o.net / wl) : 0,
        "best$": round(o.best === -Infinity ? 0 : o.best),
        "worst$": round(o.worst === Infinity ? 0 : o.worst)
      };
    });
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
  /* Profile of the single deepest drawdown: depth, the prior-peak index, the
     trough index, the recovery index, and the three durations (peak→trough,
     trough→recovery, peak→recovery). Durations are in trades. */
  function drawdownProfile(equity, key){
    key = key || "cum";
    var peak=-Infinity, peakIdx=0, dd=0, troughIdx=0, ddPeakIdx=0;
    for (var i=0;i<equity.length;i++){ var v=equity[i][key];
      if(v>peak){peak=v;peakIdx=i;} var d=peak-v;
      if(d>dd){dd=d;troughIdx=i;ddPeakIdx=peakIdx;} }
    if (dd<=0) return { depth:0, toTrough:0, toRecover:0, duration:0 };
    var target=equity[ddPeakIdx][key], recoverIdx=null;
    for (var j=troughIdx+1;j<equity.length;j++){ if(equity[j][key]>=target){recoverIdx=j;break;} }
    return { depth:dd, toTrough:troughIdx-ddPeakIdx,
             toRecover: recoverIdx==null?null:recoverIdx-troughIdx,
             duration: recoverIdx==null?null:recoverIdx-ddPeakIdx };
  }
  /* Longest run (in trades) the curve spent below a prior high anywhere — the
     worst time-underwater, independent of the deepest drawdown's depth. */
  function longestUnderwater(equity, key){
    key = key || "cum"; var peak=-Infinity, peakIdx=0, longest=0;
    for (var i=0;i<equity.length;i++){ if(equity[i][key]>=peak){peak=equity[i][key];peakIdx=i;}
      var len=i-peakIdx; if(len>longest)longest=len; }
    return longest;
  }
  function sum(a){ return a.reduce(function(s,x){return s+x;},0); }
  function mean(a){ return a.length ? sum(a)/a.length : 0; }
  function round(x){ return Math.round(x*100)/100; }

  /* =====================================================================
     Edge-sustainability battery — eight independent robustness tests on a
     vector of per-trade P&L (size-aware dollars; wins > 0, losses < 0,
     scratch = 0). Pure and deterministic: the bootstrap uses a seeded PRNG
     so the same sample always yields the same numbers (honest re-runs).

     Returns raw numbers only; the page owns thresholds + formatting.
     ===================================================================== */
  function battery(pnl, opts) {
    opts = opts || {};
    var B = opts.bootstrap != null ? opts.bootstrap : 2000;
    var pnlArr = (pnl || []).filter(function (x) { return typeof x === "number" && isFinite(x); });
    var n = pnlArr.length;
    if (!n) return null;

    var mean = sum(pnlArr) / n;
    var variance = n > 1 ? sum(pnlArr.map(function (x) { return (x - mean) * (x - mean); })) / (n - 1) : 0;
    var sd = Math.sqrt(variance);
    var se = n > 0 ? sd / Math.sqrt(n) : 0;

    // 1 · one-sample, two-sided t/z test that the mean edge differs from 0
    var tStat = se > 0 ? mean / se : 0;
    var pValue = 2 * (1 - normalCdf(Math.abs(tStat)));   // two-sided
    if (pValue < 0) pValue = 0; if (pValue > 1) pValue = 1;

    // 2 · 95% confidence interval on mean per-trade $
    var ciLow = mean - 1.96 * se, ciHigh = mean + 1.96 * se;

    // win/loss decomposition
    var wins = pnlArr.filter(function (x) { return x > 0; });
    var losses = pnlArr.filter(function (x) { return x < 0; });
    var wl = wins.length + losses.length;
    var gp = sum(wins), gl = -sum(losses), net = sum(pnlArr);
    var avgWin = wins.length ? gp / wins.length : 0;
    var avgLoss = losses.length ? gl / losses.length : 0;
    var winRate = wl ? wins.length / wl : 0;

    // 3 · profit factor
    var profitFactor = gl > 0 ? gp / gl : null;

    // 4 · outlier independence — net after deleting the three biggest winners
    var top3 = wins.slice().sort(function (a, b) { return b - a; }).slice(0, 3);
    var netExTop3 = net - sum(top3);

    // 5 · R-expectancy — expected $ per trade expressed in average-loss units (1R)
    var ev = wl ? net / wl : 0;
    var rExpectancy = avgLoss > 0 ? ev / avgLoss : null;

    // 6 · breakeven buffer — actual win rate over the win rate PF=1 demands, in pp
    var breakevenWR = (avgWin + avgLoss) > 0 ? avgLoss / (avgWin + avgLoss) : null;
    var breakevenBufferPp = breakevenWR != null ? (winRate - breakevenWR) * 100 : null;

    // 7 · streak resilience — longest run of consecutive losses, in order
    var maxLossStreak = 0, run = 0;
    pnlArr.forEach(function (x) { if (x < 0) { run++; if (run > maxLossStreak) maxLossStreak = run; } else run = 0; });

    // 8 · bootstrap P(profit) — share of seeded resamples whose total is positive
    var rng = mulberry32(opts.seed != null ? opts.seed : 0x9E3779B9);
    var profitable = 0;
    for (var b = 0; b < B; b++) {
      var s = 0;
      for (var i = 0; i < n; i++) s += pnlArr[(rng() * n) | 0];
      if (s > 0) profitable++;
    }
    var bootstrapPProfit = B ? (profitable / B) * 100 : null;

    return {
      n: n, wl: wl, wins: wins.length, losses: losses.length,
      mean: mean, sd: sd, se: se, tStat: tStat,
      pValue: pValue, ciLow: ciLow, ciHigh: ciHigh,
      profitFactor: profitFactor, grossProfit: gp, grossLoss: gl,
      net: net, netExTop3: netExTop3, top3Sum: sum(top3),
      winRate: winRate, avgWin: avgWin, avgLoss: avgLoss, ev: ev,
      rExpectancy: rExpectancy, breakevenWR: breakevenWR, breakevenBufferPp: breakevenBufferPp,
      maxLossStreak: maxLossStreak,
      bootstrapPProfit: bootstrapPProfit, bootstrapProfitable: profitable, bootstrapB: B
    };
  }

  /* Reservation / position-sizing math — pure, node-testable like battery().
     Maps a chosen fraction of the Kelly criterion to a contract count and the
     drawdown that sizing has historically REQUIRED. Returns sizing + risk only;
     it never computes or returns an expected return, profit, or EV.

       stats  a computeStats() result (reads winRate, avgWin$, avgLoss$,
              avgRiskPts, maxDrawdown, recovery, tradesPerMonth, pointValue)
       opts   { riskCapital, kellyFraction, capContracts? (default 500) }

     Formulas:
       b   = avgWin$ / avgLoss$                 payoff ratio
       f*  = p - (1 - p) / b                    full-Kelly fraction (a ceiling)
       riskPct = kellyFraction * f*             fraction of capital risked / trade
       oneR_perContract = avgRiskPts * pointValue
       N   = clamp(floor(riskCapital * riskPct / oneR_perContract), 0, cap)
       ddR = maxDrawdown / avgRiskPts           worst drawdown ALREADY LIVED, in R
     Guards return { valid:false } rather than throwing. */
  function sizing(stats, opts) {
    opts = opts || {};
    var cap = opts.capContracts != null ? opts.capContracts : 500;
    var riskCapital = +opts.riskCapital;
    var kf = +opts.kellyFraction;
    var p = stats ? stats.winRate : NaN;
    var aw = stats ? stats["avgWin$"] : NaN;
    var al = stats ? stats["avgLoss$"] : NaN;
    var arp = stats ? stats.avgRiskPts : null;
    var pv = stats && stats.pointValue != null ? stats.pointValue : NaN;

    var invalid = function (extra) {
      var base = { valid: false, p: p, b: null, fStar: null, kellyFraction: kf,
                   riskPct: 0, oneR_perContract: null, N: 0, oneR_dollars: 0,
                   ddR: null, drawdown_dollars: 0, drawdown_pct: null,
                   recoveryTrades: stats ? stats.recovery : null, recoveryMonths: null,
                   capContracts: cap, capShare: 0, riskCapital: riskCapital };
      if (extra) for (var k in extra) base[k] = extra[k];
      return base;
    };

    if (!isFinite(riskCapital) || riskCapital <= 0) return invalid();
    if (!isFinite(aw) || aw <= 0 || !isFinite(al) || al <= 0) return invalid();
    if (arp == null || !(arp > 0) || !isFinite(pv) || !(pv > 0)) return invalid();
    if (!isFinite(kf) || kf <= 0) return invalid();

    var b = aw / al;
    if (!(b > 0)) return invalid();
    var fStar = p - (1 - p) / b;
    var oneR_perContract = arp * pv;
    // No positive-edge sizing: report f* but no allocation.
    if (!(fStar > 0)) return invalid({ b: b, fStar: fStar, oneR_perContract: oneR_perContract });

    var riskPct = kf * fStar;
    var N = Math.floor(riskCapital * riskPct / oneR_perContract);
    if (N < 0) N = 0; if (N > cap) N = cap;
    var oneR_dollars = N * oneR_perContract;
    var ddR = stats.maxDrawdown != null && arp > 0 ? stats.maxDrawdown / arp : null;
    var drawdown_dollars = ddR != null ? ddR * oneR_dollars : 0;
    var drawdown_pct = ddR != null ? drawdown_dollars / riskCapital : null;
    var recoveryTrades = stats.recovery != null ? stats.recovery : null;
    var recoveryMonths = (recoveryTrades != null && stats.tradesPerMonth)
      ? recoveryTrades / stats.tradesPerMonth : null;

    return {
      valid: true, p: p, b: b, fStar: fStar, kellyFraction: kf, riskPct: riskPct,
      oneR_perContract: oneR_perContract, N: N, oneR_dollars: oneR_dollars,
      ddR: ddR, drawdown_dollars: drawdown_dollars, drawdown_pct: drawdown_pct,
      recoveryTrades: recoveryTrades, recoveryMonths: recoveryMonths,
      capContracts: cap, capShare: N / cap, riskCapital: riskCapital
    };
  }

  /* Standard-normal CDF via Abramowitz–Stegun 7.1.26 erf approximation. */
  function normalCdf(z) {
    var s = z < 0 ? -1 : 1, x = Math.abs(z) / Math.SQRT2;
    var t = 1 / (1 + 0.3275911 * x);
    var y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
    return 0.5 * (1 + s * y);
  }
  /* Seeded PRNG (mulberry32) → deterministic bootstrap. */
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* Extract a per-trade P&L vector from free-form pasted/uploaded text:
     one trade per line, taking the last signed number on each line
     (so "2026-02-03, ES short, +45" → 45). Blank/headerless lines ignored. */
  function pnlFromText(text) {
    var out = [];
    String(text || "").split(/[\r\n]+/).forEach(function (ln) {
      var m = ln.match(/-?\d+(?:\.\d+)?/g);
      if (!m || !m.length) return;
      var v = parseFloat(m[m.length - 1]);
      if (isFinite(v)) out.push(v);
    });
    return out;
  }

  var api = { parse: parse, parseMessages: parseMessages, extractFromHTML: extractFromHTML,
              extractFromText: extractFromText, computeStats: computeStats, filterWindow: filterWindow,
              monthlyBreakdown: monthlyBreakdown, battery: battery, sizing: sizing,
              dollarPerPoint: dollarPerPoint, pnlFromText: pnlFromText };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.EkantikParser = api;
})(typeof window !== "undefined" ? window : this);

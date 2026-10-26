// Kernlogica: haalt officiële KNWU-uitslagen op (de publieke databron achter mijn.knwu.nl)
// en werkt de app-data {U, R, K} bij. Geen invoer met de hand, geen schattingen.
// Werkt in Node (scripts/update.mjs) én in een browser (voor testen).

const API = "https://api.foys.io/cycling/public-api/v1/";
const FED = "2e38d9ea-84bb-452a-b58b-669352b0a2c6"; // KNWU (publiek, zoals mijn.knwu.nl het meestuurt)
const SITE = "https://mijn.knwu.nl/";
const CLUB = /arckel/i;
const DISC = { cross: 7, mtb: 2 };
const SEASON_START = { cross: "2026-08-01", mtb: "2026-01-01" };
// Klassementen van het lopende crossseizoen (jaar 2027). LJC 2026 is definitief en blijft staan.
const COMPETITIONS = [
  { id: 10, year: 2027, discipline: "cross", season: "2026–2027" },
  { id: 11, year: 2027, discipline: "cross", season: "2026–2027" },
  { id: 12, year: 2027, discipline: "cross", season: "2026–2027" },
  { id: 13, year: 2027, discipline: "cross", season: "2026–2027" },
  { id: 14, year: 2027, discipline: "cross", season: "2026–2027" },
  { id: 15, year: 2027, discipline: "cross", season: "2026–2027" },
  { id: 16, year: 2027, discipline: "cross", season: "2026–2027" },
  { id: 24, year: 2027, discipline: "cross", season: "2026–2027" },
  { id: 21, year: 2027, discipline: "cross", season: "2026–2027" },
];
const RECHECK_DAYS = 10; // recente evenementen opnieuw nalopen (late of gecorrigeerde uitslagen)

function makeApi(fetchFn) {
  const headers = { "X-FederationID": FED, "X-OrganisationId": FED, Accept: "application/json" };
  return async function get(path) {
    for (let attempt = 1; ; attempt++) {
      try {
        const r = await fetchFn(API + path, { headers });
        if (!r.ok) throw new Error(`HTTP ${r.status} voor ${path}`);
        return await r.json();
      } catch (e) {
        if (attempt >= 3) throw e;
        await new Promise(res => setTimeout(res, 1500 * attempt));
      }
    }
  };
}

async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); }
  }));
  return out;
}

const iso = s => String(s || "").slice(0, 10);
const addDays = (d, n) => { const t = new Date(d + "T12:00:00Z"); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const slug = s => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const sexOf = g => g === "Male" ? "M" : g === "Female" ? "V" : null;
const isNum = p => p != null && /^\d+$/.test(String(p).trim());

function fmtMs(ms) {
  if (ms == null || ms === "" || isNaN(+ms)) return "";
  const t = Math.floor(+ms / 100); // tienden
  const h = Math.floor(t / 36000), m = Math.floor(t % 36000 / 600), s = Math.floor(t % 600 / 10), d = t % 10;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${d}`;
}
function fmtGap(g) { const m = String(g || "").match(/(\d+)\s*Ronde/i); return m ? `+ ${m[1]} Ronde` : ""; }
function fmtStatus(s) { return { DNF: "Opgegeven", DNS: "Niet gestart", DSQ: "Gediskwalificeerd", DQ: "Gediskwalificeerd", OTL: "Buiten tijd" }[s] || (s && s !== "Valid" ? s : ""); }
const ageOf = name => { const m = String(name).match(/U(\d+)/); return m ? +m[1] : null; };

// Binnen scope: jeugd t/m U15 (jongens en meisjes), nieuwelingen M (U16/U17), junioren V (U18/U19).
function inScope(catName, sex) {
  const a = ageOf(catName);
  if (a == null) return false;
  if (a <= 15) return true;
  if (a <= 17) return sex === "M";
  if (a <= 19) return sex === "V";
  return false;
}
function raceLabel(race) {
  const cats = (race.raceCategories || []).map(c => ({ a: ageOf(c.categoryName), s: sexOf(c.categoryGender), n: c.categoryName }));
  if (cats.length && cats.every(c => c.a != null && c.a <= 15)) {
    const seen = new Set();
    return cats.sort((x, y) => x.a - y.a || (x.s === "M" ? -1 : 1))
      .map(c => `${c.s === "V" ? "V" : "M"}U${c.a}`).filter(l => !seen.has(l) && seen.add(l)).join(" / ");
  }
  if (cats.length && cats.every(c => c.a != null && c.a >= 16 && c.a <= 17 && c.s === "M")) return "Nieuwelingen M";
  return String(race.name || "").replace(/^Jeugd\s*-\s*/i, "").trim();
}
// "U16 (1e jaars nwl)" -> "U16, 1e-jaars"; "U19 (2e jaars Junior)" -> "U19, 2e-jaars junior"
const cleanCat = c => String(c || "").replace(/\s*\((\d)e[\s-]*jaars\s*(nwl)?\s*(junior)?\s*\)/i, (_, n, _nwl, jr) => `, ${n}e-jaars${jr ? " junior" : ""}`).trim();
const cleanEvent = n => String(n || "").replace(/\s+20\d\d(\s*[-/]\s*20\d\d)?\s*$/, "").trim();

async function listEvents(get, discipline, fromDate) {
  const out = [];
  for (let skip = 0; skip < 3000; skip += 50) {
    const r = await get(`events?skipCount=${skip}&maxResultCount=50&isRaceResult=true&isHistoric=true&sorting=startDate+desc&raceDisciplineIds[0].value=${DISC[discipline]}&raceClassificationNamesString=`);
    const items = r.items || [];
    for (const e of items) if (iso(e.startDate) >= fromDate) out.push(e);
    if (!items.length || iso(items[items.length - 1].startDate) < fromDate) break;
  }
  return out;
}

// Verwerkt één race: geeft {u:[...], r} terug als er clubrenners in scope zijn, anders null.
async function processRace(get, raceStub, ev, discipline, keep) {
  let results = await get(`races/race-results?raceId=${raceStub.id}&sorting=!pos.HasValue,+pos+asc`);
  if (!Array.isArray(results)) results = results.items || [];
  const club = results.filter(x => CLUB.test(x.personLicenseOrganisationName || ""));
  if (!club.length) return null;
  const race = await get(`races/${raceStub.id}?id=${raceStub.id}`);
  // geslacht + categorie per renner via het categoriefilter (zoals op de racepagina)
  const info = new Map();
  for (const c of race.raceCategories || []) {
    let list = await get(`races/race-results?raceId=${raceStub.id}&sorting=!pos.HasValue,+pos+asc&categoryIds[0].value=${c.categoryId}`);
    if (!Array.isArray(list)) list = list.items || [];
    for (const x of list) info.set(x.personId, { sex: sexOf(c.categoryGender), cat: c.categoryName });
  }
  const finishers = results.filter(x => isNum(x.pos)).sort((a, b) => +a.pos - +b.pos);
  if (!finishers.length) return null; // b.v. techniekonderdelen zonder plaatsen
  const sexP = x => (info.get(x.personId) || {}).sex || null;
  const boys = finishers.filter(x => sexP(x) === "M").length, girls = finishers.filter(x => sexP(x) === "V").length;
  const unknownSex = finishers.length - boys - girls;
  const date = iso(race.date || ev.startDate);
  const prev = keep.get(raceStub.id);
  const place = prev ? prev.place : (race.eventAddress && race.eventAddress.city) || ev.addressCity || "";
  const eventName = prev ? prev.eventName : cleanEvent(race.eventName || ev.name);
  const label = prev ? prev.race : raceLabel(race);
  const sourceUrl = `${SITE}calendar/races/${raceStub.id}`;
  const row = (x, i) => ({ idx: i + 1, pos: String(x.pos), name: x.personFullName, club: x.personLicenseOrganisationName || "", time: fmtMs(x.time), gap: fmtGap(x.gapToFirstPosition), sex: sexP(x) });

  const U = [], idxs = new Set();
  for (const x of club) {
    const inf = info.get(x.personId) || {};
    const sex = inf.sex || null;
    if (inf.cat ? !inScope(inf.cat, sex) : !(race.raceCategories || []).every(c => inScope(c.categoryName, sexOf(c.categoryGender)))) continue;
    const fin = isNum(x.pos);
    const fi = fin ? finishers.indexOf(x) : -1;
    if (fi >= 0) for (let k = Math.max(0, fi - 2); k <= Math.min(finishers.length - 1, fi + 2); k++) idxs.add(k);
    const sexPos = fin && sex ? finishers.filter(y => sexP(y) === sex && +y.pos <= +x.pos).length : null;
    const e = {
      id: `${date.replace(/-/g, "")}-${slug(place)}-${slug(x.personFullName)}-${raceStub.id}`,
      discipline, date, place, eventName, race: label,
      total: finishers.length, boys, girls,
      name: x.personFullName, nr: isNum(x.bib || x.startNumber) ? +(x.bib || x.startNumber) : (x.bib || x.startNumber || null),
      cat: inf.cat ? `${sex === "V" ? "V" : "M"}${cleanCat(inf.cat)}` : "",
      sex: sex || "", pos: fin ? +x.pos : null, sexPos,
      status: fin ? "" : fmtStatus(x.status),
      sourceUrl,
    };
    if (unknownSex) e.unknownSex = unknownSex;
    U.push(e);
  }
  if (!U.length) return null;
  const w = finishers[0];
  const R = {
    total: finishers.length, sourceUrl,
    rows: [...idxs].sort((a, b) => a - b).map(k => row(finishers[k], k)),
    winner: { name: w.personFullName, club: w.personLicenseOrganisationName || "", time: fmtMs(w.time), sex: sexP(w) },
  };
  return { raceId: String(raceStub.id), U, R };
}

async function updateResults(get, data, log, opts = {}) {
  const added = [];
  for (const discipline of opts.disciplines || ["cross"]) {
    const mine = data.U.filter(u => u.discipline === discipline);
    const last = mine.reduce((m, u) => u.date > m ? u.date : m, SEASON_START[discipline]);
    const from = opts.from || (mine.length ? addDays(last, -RECHECK_DAYS) : SEASON_START[discipline]);
    let events = await listEvents(get, discipline, from);
    if (discipline === "mtb") events = events.filter(e => /LJC/i.test(e.name));
    log(`${discipline}: ${events.length} evenementen sinds ${from}`);
    const keep = new Map();
    for (const u of data.U) keep.set(+u.sourceUrl.split("/").pop(), u);
    const lists = await pool(events, 4, async ev => {
      let races = await get(`races?maxResultCount=999&eventId=${ev.id}&sorting=date`);
      races = races.items || races;
      return (await pool(races, 3, rs => processRace(get, rs, ev, discipline, keep).catch(e => { log(`race ${rs.id}: ${e.message}`); return { error: true }; })))
        .filter(Boolean);
    });
    for (const res of lists.flat()) {
      if (res.error) { added.errors = (added.errors || 0) + 1; continue; }
      const had = new Set(data.U.filter(u => u.sourceUrl.endsWith("/" + res.raceId)).map(u => u.id));
      data.U = data.U.filter(u => !u.sourceUrl.endsWith("/" + res.raceId));
      data.U.push(...res.U);
      data.R[res.raceId] = res.R;
      for (const u of res.U) if (!had.has(u.id)) added.push(u);
    }
  }
  data.U.sort((a, b) => a.date.localeCompare(b.date) || a.place.localeCompare(b.place) || a.name.localeCompare(b.name));
  return added;
}

async function updateStandings(get, data, log) {
  const changed = [];
  for (const c of COMPETITIONS) {
    try {
      const comp = await get(`competitions/${c.id}?id=${c.id}`);
      const rankings = await get(`rankings/lookup?competitionId=${c.id}`);
      const rk = (rankings || []).find(r => r.competitionId === c.id && /algemeen/i.test(r.name)) || (rankings || []).find(r => r.competitionId === c.id);
      if (!rk) { log(`klassement ${c.id}: geen ranking`); continue; }
      const rankingId = rk.id != null ? rk.id : c.id;
      const races = await get(`competitions/races/lookup?year=${c.year}&competitionId=${c.id}&rankingId=${rankingId}`);
      if (!races || !races.length) continue;
      const latest = races[0];
      const res = await get(`ranking-results/ranking-results?rankingId=${rankingId}&raceId=${latest.id}&maxResultCount=1000&sorting=position&onlyWithPoints=true`);
      const items = (res.items || []).slice().sort((a, b) => +a.position - +b.position);
      if (!items.length) continue;
      const clubIdx = items.map((x, i) => CLUB.test(x.personClubName || "") ? i : -1).filter(i => i >= 0);
      const id = `comp-${c.id}`;
      const existing = data.K.find(k => k.id === id);
      if (!clubIdx.length && !existing) continue;
      const race = await get(`races/${latest.id}?id=${latest.id}`);
      const idxs = new Set();
      for (const i of clubIdx) for (let k = Math.max(0, i - 2); k <= Math.min(items.length - 1, i + 2); k++) idxs.add(k);
      const row = (x, i) => ({ pos: +x.position, idx: i + 1, name: x.personFullName, club: x.personClubName || "", points: x.points, sex: sexOf(x.personGender) });
      const k = {
        id, discipline: c.discipline, title: comp.name, season: c.season,
        updatedAfter: race.eventName || "", updatedDate: iso(race.date),
        total: res.totalCount || items.length, sourceUrl: `${SITE}competitions/${c.id}`,
        riders: clubIdx.map(i => items[i].personFullName),
        rows: [...idxs].sort((a, b) => a - b).map(i => row(items[i], i)),
        leader: (({ name, club, points, sex }) => ({ name, club, points, sex }))(row(items[0], 0)),
      };
      if (!clubIdx.length) { log(`klassement ${c.id}: geen clubrenners meer, oude stand blijft`); continue; }
      if (!existing || JSON.stringify(existing) !== JSON.stringify(k)) {
        data.K = data.K.filter(x => x.id !== id).concat(k);
        changed.push(k.title);
      }
    } catch (e) { log(`klassement ${c.id}: ${e.message}`); }
  }
  return changed;
}

async function runUpdate(data, fetchFn, log = () => {}, opts = {}) {
  const get = makeApi(fetchFn);
  const added = await updateResults(get, data, log, opts);
  const standings = opts.skipStandings ? [] : await updateStandings(get, data, log);
  return { added, standings, errors: added.errors || 0 };
}

if (typeof module !== "undefined") module.exports = { runUpdate, fmtMs, raceLabel, inScope };

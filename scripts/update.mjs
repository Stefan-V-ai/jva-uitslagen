// Dagelijkse update: haalt nieuwe officiële KNWU-uitslagen en klassementen op en schrijft data.json bij.
// Gebruik: node scripts/update.mjs [--from=YYYY-MM-DD] [--mtb]
import { readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { createRequire } from "node:module";
const { runUpdate } = createRequire(import.meta.url)("./core.js");

const args = Object.fromEntries(process.argv.slice(2).map(a => a.replace(/^--/, "").split("=")).map(([k, v]) => [k, v ?? true]));
const before = readFileSync("data.json", "utf8");
const data = JSON.parse(before);

const res = await runUpdate(data, fetch, m => console.log(m), {
  from: typeof args.from === "string" ? args.from : undefined,
  disciplines: args.mtb ? ["cross", "mtb"] : ["cross"],
});

const after = JSON.stringify(data);
const changed = after !== JSON.stringify(JSON.parse(before));
if (changed) writeFileSync("data.json", after + "\n");

const lines = [];
for (const u of res.added) {
  const plek = u.pos ? `${u.pos}e van ${u.total}${u.sexPos ? ` (${u.sexPos}e ${u.sex === "V" ? "meisje" : "jongen"})` : ""}` : u.status;
  lines.push(`- ${u.date} ${u.place}: ${u.name} (${u.cat}) – ${plek}`);
}
const summary = [
  changed ? "Data bijgewerkt." : "Geen wijzigingen.",
  res.added.length ? `Nieuwe uitslagen (${res.added.length}):\n${lines.join("\n")}` : "",
  res.standings.length ? `Klassementen bijgewerkt: ${res.standings.join(", ")}` : "",
  res.errors ? `Let op: ${res.errors} race(s) konden niet worden opgehaald.` : "",
].filter(Boolean).join("\n\n");
console.log(summary);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary + "\n");
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `changed=${changed}\nadded=${res.added.length}\n`);

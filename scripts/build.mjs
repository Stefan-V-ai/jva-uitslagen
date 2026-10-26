// Bouwt index.html uit src/template.html + data.json, met eigen app-icoon en manifest.
import { readFileSync, writeFileSync } from "node:fs";

const tpl = readFileSync("src/template.html", "utf8").replace(/<meta name="claude:[^>]*>\n?/g, "");
const data = readFileSync("data.json", "utf8").trim().replace(/<\//g, "<\\/");
const cut = tpl.indexOf("</style>") + "</style>".length;
const headPart = tpl.slice(0, cut), bodyPart = tpl.slice(cut).replace("__DATA__", () => data);

const head = `<!doctype html>
<html lang="nl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="JvA Uitslagen">
<link rel="apple-touch-icon" href="icons/apple-touch-icon.png">
<link rel="icon" type="image/png" sizes="192x192" href="icons/icon-192.png">
<link rel="manifest" href="manifest.webmanifest">
${headPart}
</head>
<body>`;

writeFileSync("index.html", `${head}\n${bodyPart.trim()}\n</body>\n</html>\n`);
console.log("index.html gebouwd");

import Anthropic from "@anthropic-ai/sdk";
import Parser from "rss-parser";
import { readFile, writeFile } from "fs/promises";
import path from "path";

const NOTES_PATH = path.join(process.cwd(), "data", "notes.json");
const MAX_NEW_NOTES_PER_RUN = 4;
const LOOKBACK_DAYS = 3;

const FEEDS = [
  { name: "EFF", url: "https://deeplinks.eff.org/rss" },
  { name: "EPIC", url: "https://epic.org/feed" },
  { name: "Privacy International", url: "https://privacyinternational.org/rss.xml" },
  { name: "Access Now", url: "https://www.accessnow.org/feed" },
  { name: "The Markup", url: "https://themarkup.org/feed/rss" },
  { name: "Freedom House", url: "https://freedomhouse.org/rss.xml" }
];

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

const parser = new Parser({
  timeout: 15000,
  headers: { "User-Agent": "jorjorwel-notes-bot/1.0" }
});

function isRecent(pubDate) {
  if (!pubDate) return false;
  const cutoff = Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000;
  const t = new Date(pubDate).getTime();
  return !Number.isNaN(t) && t >= cutoff;
}

async function fetchCandidates() {
  const items = [];
  for (const feed of FEEDS) {
    try {
      const parsed = await parser.parseURL(feed.url);
      for (const entry of parsed.items || []) {
        if (!isRecent(entry.pubDate && entry.isoDate)) continue;
        items.push({
          source_name: feed.name,
          source_url: entry.link,
          title: entry.title || "",
          summary: (entry.contentSnippet || entry.content || "").slice(0, 1200),
          pubDate: entry.isoDate || entry.pubDate
        });
      }
    } catch (err) {
      console.error(`Feed failed: ${feed.name} (${feed.url}) — ${err.message}`);
    }
  }
  return items;
}

async function loadExistingNotes() {
  try {
    const raw = await readFile(NOTES_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function alreadyCovered(existingNotes, candidate) {
  return existingNotes.some((n) => n.source_url === candidate.source_url);
}

async function classifyAndWrite(candidate) {
  const systemPrompt = `You write short, dated "Surveillance Notes" dispatches for a nonpartisan literary site (jorjorwel.com) that links real-world surveillance, censorship, and propaganda developments to dystopian fiction (1984, Brave New World, etc).

Rules:
- Stay strictly nonpartisan. Scrutinize any actor — government, company, platform — equally, regardless of political direction.
- Do NOT cover ordinary partisan political disputes, elections, or culture-war content unrelated to surveillance/censorship/propaganda mechanisms.
- Only write a note if the source item genuinely describes a surveillance, censorship, propaganda, or data-control development — not general privacy commentary or opinion pieces.
- Output ONLY valid JSON, no markdown fences, no preamble.
- If the item does not qualify, output exactly: {"skip": true}
- If it qualifies, output exactly this shape:
  {"skip": false, "text": "<one or two sentence dispatch, factual, no hyperbole, plain language>", "tag": "<one short uppercase tag like SURVEILLANCE, CENSORSHIP, PROPAGANDA, DATA>"}
- The "text" field may bold at most one key phrase using <b></b> tags, never more.
- Never fabricate details not present in the summary provided.`;

  const userPrompt = `Source: ${candidate.source_name}
Title: ${candidate.title}
Summary: ${candidate.summary}`;

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 400,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }]
  });

  const raw = response.content
    .map((block) => (block.type === "text" ? block.text : ""))
    .join("")
    .trim();

  let parsed;
  try {
    parsed = JSON.parse(raw.replace(/```json|```/g, "").trim());
  } catch {
    return null;
  }

  if (!parsed || parsed.skip) return null;
  if (!parsed.text || !parsed.tag) return null;

  return {
    date: (candidate.pubDate ? new Date(candidate.pubDate) : new Date())
      .toISOString()
      .slice(0, 10),
    text: parsed.text,
    tag: parsed.tag,
    source_name: candidate.source_name,
    source_url: candidate.source_url
  };
}

async function main() {
  const existingNotes = await loadExistingNotes();
  const candidates = await fetchCandidates();

  const fresh = candidates.filter((c) => !alreadyCovered(existingNotes, c));
  console.log(`Found ${fresh.length} new candidate items across ${FEEDS.length} feeds.`);

  const newNotes = [];
  for (const candidate of fresh) {
    if (newNotes.length >= MAX_NEW_NOTES_PER_RUN) break;
    try {
      const note = await classifyAndWrite(candidate);
      if (note) newNotes.push(note);
    } catch (err) {
      console.error(`Classification failed for "${candidate.title}": ${err.message}`);
    }
  }

  if (newNotes.length === 0) {
    console.log("No qualifying new notes this run.");
    return;
  }

  const merged = [...newNotes, ...existingNotes];
  await writeFile(NOTES_PATH, JSON.stringify(merged, null, 2) + "\n", "utf-8");
  console.log(`Added ${newNotes.length} new note(s) to ${NOTES_PATH}.`);
}

main().catch((err) => {
  console.error("Pipeline failed:", err);
  process.exitCode = 1;
});

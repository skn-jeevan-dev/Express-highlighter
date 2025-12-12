const axios = require("axios");
const fs = require("fs").promises;
const path = require("path");
const { pathToFileURL } = require("url");

// Polyfill DOM APIs for pdfjs-dist in Node.js
if (typeof globalThis.DOMMatrix === 'undefined') {
  globalThis.DOMMatrix = class DOMMatrix {
    constructor() {
      this.m = [1, 0, 0, 1, 0, 0];
    }
  };
}

if (typeof globalThis.Path2D === 'undefined') {
  globalThis.Path2D = class Path2D {};
}

// Polyfill Canvas for pdfjs-dist
const { createCanvas } = require('canvas');
if (typeof globalThis.document === 'undefined') {
  globalThis.document = {
    createElement: (tag) => {
      if (tag === 'canvas') {
        return createCanvas(200, 200);
      }
      return {};
    }
  };
}

// Dynamic import for pdfjs-dist (ES Module)
let pdfjsLib = null;

async function initPdfJs() {
  if (!pdfjsLib) {
    pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const workerPath = require.resolve("pdfjs-dist/legacy/build/pdf.worker.mjs");
    pdfjsLib.GlobalWorkerOptions.workerSrc = pathToFileURL(workerPath).toString();
  }
  return pdfjsLib;
}

class TrieNode {
  constructor() {
    this.children = new Map();
    this.isWord = false;
    this.word = null;
  }
}

function buildTrie(words) {
  const root = new TrieNode();
  words.forEach((word) => {
    let node = root;
    for (const char of word.toLowerCase()) {
      if (!node.children.has(char)) {
        node.children.set(char, new TrieNode());
      }
      node = node.children.get(char);
    }
    node.isWord = true;
    node.word = word.toLowerCase();
  });
  return root;
}

function isWordChar(ch) {
  return /\p{L}|\p{N}/u.test(ch);
}

function findWordsInText(text, trie) {
  const matches = [];
  const lowerText = text.toLowerCase();
  const len = lowerText.length;

  for (let i = 0; i < len; i++) {
    if (i > 0 && isWordChar(lowerText[i - 1])) continue;

    let node = trie;
    let j = i;

    while (j < len && node.children.has(lowerText[j])) {
      node = node.children.get(lowerText[j++]);
      if (node.isWord && (j >= len || !isWordChar(lowerText[j]))) {
        matches.push({
          word: text.substring(i, j),
          start: i,
          end: j,
          key: node.word,
        });
      }
    }
  }
  return matches;
}

async function extractTextFromPDF(pdfUrl) {
  try {
    
    const pdfjs = await initPdfJs();

    const response = await axios.get(pdfUrl, {
      responseType: "arraybuffer",
      timeout: 30000,
      maxContentLength: 75 * 1024 * 1024,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    const pdfData = new Uint8Array(response.data);

    const loadingTask = pdfjs.getDocument({ data: pdfData });
    const pdf = await loadingTask.promise;

    let fullText = "";

    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const textContent = await page.getTextContent();
      const pageText = textContent.items.map((item) => item.str).join(" ");
      fullText += " " + pageText;
    }

    return fullText.trim();
  } catch (error) {
    console.error("PDF extraction error:", error.message);
    throw new Error(`Failed to extract text from PDF: ${error.message}`);
  }
}

let WORD_DATA_MAP = new Map();
let TRIE_ROOT = null;

async function loadSkillsData() {
  try {
    const dataPath = path.join(__dirname, "public", "skills-output.json");
    const rawData = await fs.readFile(dataPath, "utf-8");
    const skills = JSON.parse(rawData);

    skills.forEach((item) => {
      if (item.name) {
        WORD_DATA_MAP.set(item.name.toLowerCase(), item);
      }
    });

    TRIE_ROOT = buildTrie([...WORD_DATA_MAP.keys()]);
  } catch (error) {
    console.error("Failed to load skills data:", error);
    throw error;
  }
}

async function processPDFForSkills(pdfUrl) {
  const startTime = Date.now();

  try {
    // Extract text
    const pdfText = await extractTextFromPDF(pdfUrl);

    if (!pdfText || pdfText.trim().length === 0) {
      return {
        success: true,
        matches: [],
        totalMatches: 0,
        message: "No text found in PDF",
        processingTime: `${Date.now() - startTime}ms`,
      };
    }

    // Find matches
    const allMatches = findWordsInText(pdfText, TRIE_ROOT);
    
    // Deduplicate and count occurrences
    const uniqueSkills = new Map();
    allMatches.forEach((match) => {
      if (!uniqueSkills.has(match.key)) {
        const skillData = WORD_DATA_MAP.get(match.key);
        if (skillData) {
          uniqueSkills.set(match.key, {
            name: skillData.name,
            description: skillData.description,
            skillType: skillData.skillType,
          });
        }
      }
    });

    const matchesArray = Array.from(uniqueSkills.values());

    const processingTime = Date.now() - startTime;
    console.log(`Found ${matchesArray.length} unique skills`);
    console.log(`Processing time: ${processingTime}ms`);

    return {
      success: true,
      matches: matchesArray,
      totalMatches: matchesArray.length,
      processingTime: `${processingTime}ms`,
    };
  } catch (error) {
    const processingTime = Date.now() - startTime;
    console.error("PDF processing error:", error);

    return {
      success: false,
      error: error.message || "Failed to process PDF",
      processingTime: `${processingTime}ms`,
    };
  }
}

module.exports = {
  loadSkillsData,
  processPDFForSkills,
};

const axios = require("axios");

const cache = new Map();
const CACHE_TTL_MS = 60 * 60 * 1000;

function normalizeProteinName(name) {
  const normalized = String(name || "")
    .replace(/^HLA[-\s]?DQ/i, "HLA-DQ")
    .replace(/\s+/g, " ")
    .trim();
  const match = normalized.match(/HLA-DQ\s*(\d+)(?:[.-](\d+))?/i);
  return match
    ? `HLA-DQ${match[1]}${match[2] ? `.${match[2]}` : ""}`
    : normalized;
}

async function findReferenceStructure(proteinName) {
  const normalizedName = normalizeProteinName(proteinName);
  if (!normalizedName) throw new Error("A protein name is required for RCSB lookup");

  const cached = cache.get(normalizedName);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const searchTerms = [
    normalizedName,
    normalizedName.replace("HLA-DQ", "HLA DQ"),
    normalizedName.replace("HLA-DQ", "DQ"),
  ];
  const familyMatch = normalizedName.match(/^HLA-DQ(\d+)/i);
  if (familyMatch) searchTerms.push(`HLA DQ${familyMatch[1]}`);
  let searchResults = [];
  for (const searchTerm of searchTerms) {
    const searchResponse = await axios.post(
    "https://search.rcsb.org/rcsbsearch/v2/query",
    {
      query: {
        type: "terminal",
        service: "full_text",
        parameters: { value: searchTerm },
      },
      return_type: "entry",
      request_options: {
        paginate: { start: 0, rows: 10 },
        results_content_type: ["experimental"],
      },
    },
      { timeout: 10000 }
    );
    searchResults.push(...(searchResponse.data?.result_set || []));
    if (searchResults.length) break;
  }

  const candidates = searchResults
    .map((result) => String(result.identifier || "").toUpperCase())
    .filter((identifier) => /^[0-9A-Z]{4}$/.test(identifier));
  if (!candidates.length) return null;

  const entries = await Promise.all(candidates.map(async (pdbId) => {
    try {
      const response = await axios.get(
        `https://data.rcsb.org/rest/v1/core/entry/${pdbId}`,
        { timeout: 10000 }
      );
      const entry = response.data || {};
      const exptl = entry.exptl?.[0] || {};
      const resolution = entry.refine?.[0]?.ls_d_res_high
        || entry.reflns?.[0]?.d_resolution_high
        || null;
      return {
        pdbId,
        title: entry.struct?.title || "RCSB crystal structure",
        experimentalMethod: exptl.method || "Experimental",
        resolution,
        rcsbUrl: `https://www.rcsb.org/structure/${pdbId}`,
        viewerUrl: `https://www.rcsb.org/3d-view/${pdbId}`,
      };
    } catch (_) {
      return null;
    }
  }));

  const value = entries
    .filter(Boolean)
    .sort((a, b) => (a.resolution || 999) - (b.resolution || 999))[0] || null;
  cache.set(normalizedName, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  return value;
}

module.exports = { findReferenceStructure };

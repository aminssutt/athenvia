/**
 * Bundled marks for the launch catalogue.
 *
 * The database's `logoUrl` stays the source of truth: these local assets only
 * fill the gap while curated logo URLs are still being collected (#87), so a
 * university the map does not know keeps its monogram fallback. Keys are
 * normalized names — lowercase, diacritics stripped, alphanumerics only — so
 * "ETH Zürich", "ETH Zurich" and "eth zurich" all resolve to the same file.
 * Aliases cover the short forms marketing copy uses (EPFL, UCL, UC Berkeley).
 */
const LOGO_BY_NORMALIZED_NAME: Record<string, string> = {
  columbiauniversity: "columbia",
  cornelltech: "cornell-tech",
  ecolepolytechnique: "polytechnique",
  ecolepolytechniquefederaledelausanne: "epfl",
  epfl: "epfl",
  ethzurich: "eth-zurich",
  hecparis: "hec-paris",
  hku: "hku",
  hkust: "hkust",
  hongkonguniversityofscienceandtechnology: "hkust",
  imperialcollegelondon: "imperial",
  kaist: "kaist",
  koreaadvancedinstituteofscienceandtechnology: "kaist",
  massachusettsinstituteoftechnology: "mit",
  mit: "mit",
  nanyangtechnologicaluniversity: "ntu",
  nationaluniversityofsingapore: "nus",
  nus: "nus",
  seoulnationaluniversity: "snu",
  singaporemanagementuniversity: "smu",
  thehongkonguniversityofscienceandtechnology: "hkust",
  theuniversityofhongkong: "hku",
  tsinghuauniversity: "tsinghua",
  ucberkeley: "berkeley",
  ucl: "ucl",
  ucla: "ucla",
  universitycollegelondon: "ucl",
  universityofcaliforniaberkeley: "berkeley",
  universityofcalifornialosangeles: "ucla",
  universityofcambridge: "cambridge",
  universityofhongkong: "hku",
  universityofoxford: "oxford",
};

function normalizeUniversityName(universityName: string): string {
  return universityName
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/gu, "");
}

/** Public path of the bundled logo for a university, or null when unknown. */
export function getUniversityLogoAsset(universityName: string): string | null {
  const slug = LOGO_BY_NORMALIZED_NAME[normalizeUniversityName(universityName)];
  return slug ? `/university-logos/${slug}.png` : null;
}
